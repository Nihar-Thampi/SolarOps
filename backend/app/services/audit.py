"""Audit trail: who did what, when, to which record, and whether it was allowed.

How it fits together:
- Route handlers describe the action they performed with `record(...)`
  (action name, the record it touched, a readable summary, and before/after changes).
- `audit_middleware` writes one entry per request after the response is ready: every
  request that changes data, every request a handler described, and every request that was
  refused (401/403), even when the handler never ran.
- Entries are append-only (database triggers reject UPDATE and DELETE) and hash-chained per
  tenant: each entry's hash covers its content plus the previous entry's hash, so any edit,
  deletion or reordering breaks the chain and `verify_chain` reports where.
"""
import hashlib
import json
import logging
import threading
import time
import uuid
from contextvars import ContextVar
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any

from fastapi import Request
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import AuditLog

logger = logging.getLogger(__name__)

# Serializes chain writes so two concurrent requests can't both extend the same entry.
_chain_lock = threading.Lock()

# Fields that must never appear in the log, even as "changed".
_SECRET_FIELDS = {"password", "password_hash", "feedback_token", "token"}


# Per-request scratchpad the middleware opens; handlers (even in worker threads) write into it.
_current: ContextVar[dict | None] = ContextVar("audit_request", default=None)


def actor_from_user(user) -> dict:
    return {
        "user_id": user.id,
        "email": user.email,
        "name": user.full_name,
        "role": user.role.value,
        "tenant_id": user.tenant_id,
    }


def set_actor(actor: dict) -> None:
    """Attribute the current request to this actor (no-op outside a request)."""
    store = _current.get()
    if store is not None:
        store["actor"] = actor


def record(
    action: str,
    summary: str,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    entity_label: str | None = None,
    changes: dict | None = None,
    tenant_id: str | None = None,
) -> None:
    """Describe the action this request performed; the middleware writes it."""
    store = _current.get()
    if store is None:
        return
    store["audit"] = {
        "action": action,
        "summary": summary,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_label": entity_label,
        "changes": changes or None,
        "tenant_id": tenant_id,
    }


def _plain(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def snapshot(obj, fields: list[str]) -> dict:
    return {f: _plain(getattr(obj, f, None)) for f in fields}


def diff(before: dict, after: dict) -> dict:
    """{field: [old, new]} for fields that changed. Secret fields are reported, never shown."""
    out = {}
    for key in sorted(set(before) | set(after)):
        old, new = _plain(before.get(key)), _plain(after.get(key))
        if old != new:
            out[key] = ["(hidden)", "(changed)"] if key in _SECRET_FIELDS else [old, new]
    return out


# ---- Writing and verifying the chain ----

def _entry_hash(e: AuditLog) -> str:
    payload = json.dumps(
        {
            "prev": e.prev_hash,
            "tenant": e.tenant_id,
            "user": e.user_id,
            "email": e.user_email,
            "role": e.user_role,
            "action": e.action,
            "entity": [e.entity_type, e.entity_id, e.entity_label],
            "summary": e.summary,
            "changes": e.changes,
            "request": [e.method, e.path, e.status_code, e.ip_address, e.user_agent, e.request_id],
            "at": e.created_at.astimezone(timezone.utc).isoformat(),
        },
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _last_hash(db: Session, tenant_id: str | None) -> str:
    stmt = select(AuditLog.hash).order_by(AuditLog.id.desc()).limit(1)
    stmt = stmt.where(AuditLog.tenant_id == tenant_id) if tenant_id else stmt.where(AuditLog.tenant_id.is_(None))
    return db.scalar(stmt) or "0" * 64


def append(db: Session, entry: AuditLog) -> AuditLog:
    """Add an entry to the end of its tenant's chain and commit it."""
    with _chain_lock:
        entry.created_at = entry.created_at or datetime.now(timezone.utc)
        entry.prev_hash = _last_hash(db, entry.tenant_id)
        entry.hash = _entry_hash(entry)
        db.add(entry)
        db.commit()
    return entry


def verify_chain(db: Session, tenant_id: str) -> dict:
    """Recompute every hash in the tenant's chain, oldest first."""
    expected_prev = "0" * 64
    count = 0
    for e in db.scalars(select(AuditLog).where(AuditLog.tenant_id == tenant_id).order_by(AuditLog.id)):
        if e.prev_hash != expected_prev or _entry_hash(e) != e.hash:
            return {"valid": False, "entries_checked": count, "broken_at_id": e.id, "broken_at": e.created_at}
        expected_prev = e.hash
        count += 1
    return {"valid": True, "entries_checked": count, "broken_at_id": None, "broken_at": None}


# ---- Middleware ----

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_SKIP_PATHS = {"/api/health"}


def _client_ip(request: Request) -> str | None:
    # Behind a reverse proxy (or the Vite dev proxy) the browser's address is in X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _default_action(request: Request, status: int) -> tuple[str, str]:
    route = request.scope.get("route")
    template = getattr(route, "path", request.url.path)
    if status in (401, 403):
        what = "Not signed in" if status == 401 else "Permission denied"
        return "access.denied", f"{what}: {request.method} {template}"
    return f"request.{request.method.lower()}", f"{request.method} {template}"


async def audit_middleware(request: Request, call_next):
    if not request.url.path.startswith("/api") or request.url.path in _SKIP_PATHS:
        return await call_next(request)

    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    started = time.perf_counter()
    status = 500
    store: dict = {}
    token = _current.set(store)
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        _current.reset(token)
        described = store.get("audit")
        if described or request.method in _WRITE_METHODS or status in (401, 403):
            try:
                await run_in_threadpool(
                    _write_request_entry, request, request_id, status, described, store.get("actor") or {}, started
                )
            except Exception:  # the audit trail must never take the API down
                logger.exception("Failed to write audit entry for %s %s", request.method, request.url.path)


def _write_request_entry(
    request: Request, request_id: str, status: int, described: dict | None, actor: dict, started: float
):
    if described:
        # What the handler said it did; marked failed if the request then errored.
        details = dict(described)
        if status >= 400:
            if not details["action"].endswith("_failed"):
                details["summary"] += " (failed)"
            details["changes"] = None
    else:
        # Nothing described (e.g. refused before the handler ran): log the raw request.
        action, summary = _default_action(request, status)
        details = {"action": action, "summary": summary}
    tenant_id = details.get("tenant_id") or actor.get("tenant_id")

    entry = AuditLog(
        tenant_id=tenant_id,
        user_id=actor.get("user_id"),
        user_email=actor.get("email"),
        user_name=actor.get("name"),
        user_role=actor.get("role"),
        action=details["action"],
        summary=details["summary"],
        entity_type=details.get("entity_type"),
        entity_id=details.get("entity_id"),
        entity_label=details.get("entity_label"),
        changes=details.get("changes"),
        method=request.method,
        path=request.url.path,
        status_code=status,
        ip_address=_client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
        request_id=request_id,
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    with SessionLocal() as db:
        append(db, entry)

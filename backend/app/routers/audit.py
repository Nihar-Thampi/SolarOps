"""The audit trail, for admins only. Viewing and exporting it are themselves recorded."""
import csv
import io
import json
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.models import AuditLog, Role, User
from app.services.audit import record, verify_chain

router = APIRouter(prefix="/audit", tags=["audit"])
admin_only = require_roles(Role.admin)


class AuditEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    user_id: str | None
    user_email: str | None
    user_name: str | None
    user_role: str | None
    action: str
    summary: str
    entity_type: str | None
    entity_id: str | None
    entity_label: str | None
    changes: dict | None
    method: str
    path: str
    status_code: int
    ip_address: str | None
    user_agent: str | None
    request_id: str | None
    duration_ms: int
    hash: str


class AuditPage(BaseModel):
    items: list[AuditEntryOut]
    total: int


class VerifyOut(BaseModel):
    valid: bool
    entries_checked: int
    broken_at_id: int | None
    broken_at: datetime | None


class FacetsOut(BaseModel):
    actions: list[str]
    entity_types: list[str]


def _filtered(
    admin: User,
    user_id: str | None,
    action: str | None,
    entity_type: str | None,
    entity_id: str | None,
    outcome: str | None,
    date_from: date | None,
    date_to: date | None,
    q: str | None,
) -> Select:
    stmt = select(AuditLog).where(AuditLog.tenant_id == admin.tenant_id)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if action:
        # "job" matches every job.* action; "job.assign" matches exactly.
        stmt = stmt.where(AuditLog.action == action if "." in action else AuditLog.action.like(f"{action}.%"))
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if outcome == "denied":
        stmt = stmt.where(AuditLog.status_code.in_((401, 403)))
    elif outcome == "failed":
        stmt = stmt.where(AuditLog.status_code >= 400)
    elif outcome == "success":
        stmt = stmt.where(AuditLog.status_code < 400)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        stmt = stmt.where(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                AuditLog.summary.ilike(like),
                AuditLog.entity_label.ilike(like),
                AuditLog.user_email.ilike(like),
                AuditLog.ip_address.ilike(like),
                AuditLog.request_id.ilike(like),
            )
        )
    return stmt


def _filters(
    user_id: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    outcome: str | None = Query(None, pattern="^(success|failed|denied)$"),
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
) -> dict:
    return dict(
        user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id,
        outcome=outcome, date_from=date_from, date_to=date_to, q=q,
    )


@router.get("", response_model=AuditPage)
def list_entries(
    filters: dict = Depends(_filters),
    limit: int = Query(50, le=200),
    offset: int = 0,
    admin: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    if offset == 0:  # one entry per search, not per page turned
        used = ", ".join(f"{k}={v}" for k, v in filters.items() if v)
        record("audit.view", f"Viewed the audit trail{f' ({used})' if used else ''}")
    stmt = _filtered(admin, **filters)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(AuditLog.id.desc()).limit(limit).offset(offset)).all()
    return {"items": items, "total": total}


@router.get("/facets", response_model=FacetsOut)
def facets(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    base = select(AuditLog).where(AuditLog.tenant_id == admin.tenant_id).subquery()
    actions = db.scalars(select(base.c.action).distinct().order_by(base.c.action)).all()
    types = db.scalars(select(base.c.entity_type).where(base.c.entity_type.isnot(None)).distinct().order_by(base.c.entity_type)).all()
    return {"actions": actions, "entity_types": types}


@router.get("/verify", response_model=VerifyOut)
def verify(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Recompute the hash chain to prove no entry was altered, removed or reordered."""
    result = verify_chain(db, admin.tenant_id)
    record(
        "audit.verify",
        f"Verified audit trail integrity: {'intact' if result['valid'] else 'BROKEN at entry ' + str(result['broken_at_id'])}"
        f" ({result['entries_checked']} entries checked)",
    )
    return result


@router.get("/export")
def export_csv(
    filters: dict = Depends(_filters),
    admin: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    stmt = _filtered(admin, **filters).order_by(AuditLog.id)
    rows = db.scalars(stmt.limit(50_000)).all()
    record("audit.export", f"Exported {len(rows)} audit entries as CSV")

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "time_utc", "user", "role", "action", "summary", "entity_type", "entity",
                     "changes", "method", "path", "status", "ip", "user_agent", "request_id", "hash"])
    for e in rows:
        writer.writerow([
            e.id, e.created_at.isoformat(), e.user_email or "", e.user_role or "", e.action, e.summary,
            e.entity_type or "", e.entity_label or "", json.dumps(e.changes, ensure_ascii=False) if e.changes else "",
            e.method, e.path, e.status_code, e.ip_address or "", e.user_agent or "", e.request_id or "", e.hash,
        ])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="audit-log-{stamp}.csv"'},
    )

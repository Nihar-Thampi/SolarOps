from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import schemas
from app.ai.client import provider_status
from app.ai.intake import draft_job
from app.db import get_db
from app.deps import MANAGE, Scope, get_scope, require_roles
from app.models import AIRequest, Client
from app.services.audit import record

router = APIRouter(prefix="/ai", tags=["ai"])
manager = require_roles(*MANAGE)


@router.get("/status", response_model=schemas.AIStatusOut)
def ai_status(_: Scope = Depends(get_scope)):
    provider, model = provider_status()
    return {"provider": provider, "model": model, "is_demo": provider == "demo"}


@router.post("/intake", response_model=schemas.IntakeDraft)
def intake(body: schemas.IntakeIn, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    """Draft a job from a customer's message. Nothing is saved until the user creates the job."""
    clients = db.scalars(scope.apply(select(Client), Client).order_by(Client.name).limit(300)).unique().all()
    result = draft_job(db, scope.tenant_id, scope.user.id, body.text, list(clients))
    db.commit()  # keep the AI log entry
    record("ai.intake", f"Drafted a job from a customer message with AI ({result.provider}): {result.data['title']}")
    return {**result.data, "provider": result.provider, "model": result.model}


@router.get("/requests", response_model=schemas.Page[schemas.AIRequestOut])
def ai_requests(
    feature: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    scope: Scope = Depends(get_scope),
    _=Depends(manager),
    db: Session = Depends(get_db),
):
    """The AI activity log. Admins see every call in the tenant; managers see their own
    (prompts can include client details from regions they don't cover)."""
    stmt = select(AIRequest).where(AIRequest.tenant_id == scope.tenant_id)
    if scope.region_ids is not None:
        stmt = stmt.where(AIRequest.user_id == scope.user.id)
    if feature:
        stmt = stmt.where(AIRequest.feature == feature)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(AIRequest.created_at.desc()).limit(limit).offset(offset)).all()
    return {"items": items, "total": total}

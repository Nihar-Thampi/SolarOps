"""Customer feedback: the public form customers reach by link, and the internal insights."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas
from app.ai.feedback import THEMES, analyze_feedback, summarize_feedback
from app.db import get_db
from app.deps import MANAGE, Scope, get_scope, region_param, require_roles
from app.models import Feedback, Job, JobStatus, Sentiment, Tenant
from app.services.audit import record, set_actor
from app.services.jobs import add_event
from app.services.serializers import feedback_out

router = APIRouter(tags=["feedback"])
manager = require_roles(*MANAGE)


@router.get("/feedback", response_model=schemas.Page[schemas.FeedbackOut])
def list_feedback(
    sentiment: Sentiment | None = None,
    theme: str | None = None,
    min_rating: int | None = Query(None, ge=1, le=5),
    max_rating: int | None = Query(None, ge=1, le=5),
    region_id: str | None = Depends(region_param),
    limit: int = Query(50, le=200),
    offset: int = 0,
    scope: Scope = Depends(get_scope),
    db: Session = Depends(get_db),
):
    stmt = scope.apply(select(Feedback), Feedback, region_id)
    if sentiment:
        stmt = stmt.where(Feedback.sentiment == sentiment)
    if min_rating:
        stmt = stmt.where(Feedback.rating >= min_rating)
    if max_rating:
        stmt = stmt.where(Feedback.rating <= max_rating)
    items = db.scalars(stmt.order_by(Feedback.created_at.desc())).unique().all()
    if theme:  # themes is a JSON list; filter in Python to stay portable across SQLite/Postgres
        items = [f for f in items if theme in (f.themes or [])]
    return {"items": [feedback_out(f) for f in items[offset : offset + limit]], "total": len(items)}


@router.get("/feedback/themes", response_model=list[str])
def list_themes(_: Scope = Depends(get_scope)):
    return THEMES


@router.post("/feedback/analyze", response_model=dict)
def analyze_pending(scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    """Run sentiment/theme analysis on any feedback that hasn't been analyzed yet."""
    pending = db.scalars(
        scope.apply(select(Feedback), Feedback).where(Feedback.analyzed_at.is_(None)).limit(500)
    ).unique().all()
    if pending:
        analyze_feedback(db, scope.tenant_id, scope.user.id, pending)
        now = datetime.now(timezone.utc)
        for f in pending:
            f.analyzed_at = now
        db.commit()
    record("feedback.analyze", f"Ran AI analysis on {len(pending)} unanalyzed reviews")
    return {"analyzed": len(pending)}


@router.post("/feedback/insights", response_model=schemas.InsightsOut)
def feedback_insights(
    days: int = Query(90, ge=7, le=730),
    region_id: str | None = Depends(region_param),
    scope: Scope = Depends(get_scope),
    _=Depends(manager),
    db: Session = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    items = db.scalars(
        scope.apply(select(Feedback), Feedback, region_id)
        .where(Feedback.created_at >= since)
        .order_by(Feedback.created_at.desc())
        .limit(200)
    ).unique().all()
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No feedback in this period yet.")
    result = summarize_feedback(db, scope.tenant_id, scope.user.id, items)
    db.commit()
    record("feedback.insights", f"Generated AI feedback insights from {len(items)} reviews (last {days} days)")
    return {
        **result.data,
        "feedback_count": len(items),
        "provider": result.provider,
        "model": result.model,
        "generated_at": datetime.now(timezone.utc),
    }


# ---- Public: the customer's feedback link (no login; the token is the credential) ----

def _job_for_token(db: Session, token: str) -> Job:
    job = db.scalar(select(Job).where(Job.feedback_token == token))
    if job is None or job.status != JobStatus.completed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This feedback link is not valid.")
    return job


@router.get("/public/feedback/{token}", response_model=schemas.PublicFeedbackJob)
def public_feedback_job(token: str, db: Session = Depends(get_db)):
    job = _job_for_token(db, token)
    return {
        "company_name": db.get(Tenant, job.tenant_id).name,
        "job_number": job.number,
        "title": job.title,
        "site_name": job.site.name if job.site else None,
        "completed_at": job.completed_at,
        "already_submitted": job.feedback is not None,
    }


@router.post("/public/feedback/{token}", status_code=201)
def public_feedback_submit(token: str, body: schemas.PublicFeedbackIn, db: Session = Depends(get_db)):
    job = _job_for_token(db, token)
    # No login here: the customer, via the job's private link.
    set_actor({"email": None, "name": f"Customer ({job.client.name})", "role": "customer", "tenant_id": job.tenant_id})
    record("feedback.submit", f"Customer left {body.rating}/5 feedback on {job.number}", entity_type="job",
           entity_id=job.id, entity_label=f"{job.number} · {job.title}")
    if job.feedback is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Thanks — feedback for this visit was already received.")
    feedback = Feedback(
        tenant_id=job.tenant_id,
        job_id=job.id,
        client_id=job.client_id,
        region_id=job.region_id,
        rating=body.rating,
        comment=body.comment.strip(),
    )
    db.add(feedback)
    db.flush()
    feedback.job = job
    analyze_feedback(db, job.tenant_id, None, [feedback])
    feedback.analyzed_at = datetime.now(timezone.utc)
    add_event(db, job, None, "feedback", f"Customer left {body.rating}/5 feedback")
    db.commit()
    return {"ok": True}

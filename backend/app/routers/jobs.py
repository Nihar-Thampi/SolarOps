"""Jobs: the work tracker, plus assignment, status, notes and service reports."""
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import schemas
from app.ai.reports import draft_report
from app.db import get_db
from app.deps import MANAGE, Scope, get_scope, get_scoped, region_param, require_roles
from app.models import (
    OPEN_STATUSES,
    Client,
    Job,
    JobSource,
    JobStatus,
    Priority,
    ReportStatus,
    Role,
    ServiceReport,
    ServiceSchedule,
    ServiceType,
    Site,
    User,
)
from app.services.jobs import (
    PRIORITY_ORDER,
    add_event,
    check_assignee,
    label,
    next_job_number,
    set_assignee,
    set_status,
    suggested_assignees,
)
from app.services.audit import diff, record, snapshot
from app.services.serializers import job_detail, job_list_item

JOB_FIELDS = ["title", "description", "service_type", "priority", "site_id", "scheduled_date", "due_date"]
REPORT_FIELDS = ["technician_notes", "summary", "work_performed", "findings", "recommendations", "readings"]


def _audit_job(action: str, summary: str, job: Job, changes: dict | None = None) -> None:
    record(action, summary, entity_type="job", entity_id=job.id, entity_label=f"{job.number} · {job.title}", changes=changes)

router = APIRouter(tags=["jobs"])
manager = require_roles(*MANAGE)



def _can_work(job: Job, user: User) -> bool:
    return user.role in MANAGE or job.assignee_id == user.id


def _require_work(job: Job, user: User) -> None:
    if not _can_work(job, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the assigned technician or a manager can do that.")


@router.get("/jobs", response_model=schemas.Page[schemas.JobListItem])
def list_jobs(
    view: Literal["open", "completed", "all"] = "open",
    status_: JobStatus | None = Query(None, alias="status"),
    assignee: str | None = Query(None, description="'me', 'unassigned' or a user id"),
    priority: Priority | None = None,
    service_type: ServiceType | None = None,
    client_id: str | None = None,
    site_id: str | None = None,
    overdue: bool = False,
    q: str | None = None,
    sort: Literal["priority", "due", "newest", "updated"] = "priority",
    region_id: str | None = Depends(region_param),
    limit: int = Query(50, le=200),
    offset: int = 0,
    scope: Scope = Depends(get_scope),
    db: Session = Depends(get_db),
):
    stmt = scope.apply(select(Job), Job, region_id)
    if status_:
        stmt = stmt.where(Job.status == status_)
    elif view == "open":
        stmt = stmt.where(Job.status.in_(OPEN_STATUSES))
    elif view == "completed":
        stmt = stmt.where(Job.status == JobStatus.completed)
    if assignee == "me":
        stmt = stmt.where(Job.assignee_id == scope.user.id)
    elif assignee == "unassigned":
        stmt = stmt.where(Job.assignee_id.is_(None))
    elif assignee:
        stmt = stmt.where(Job.assignee_id == assignee)
    if priority:
        stmt = stmt.where(Job.priority == priority)
    if service_type:
        stmt = stmt.where(Job.service_type == service_type)
    if client_id:
        stmt = stmt.where(Job.client_id == client_id)
    if site_id:
        stmt = stmt.where(Job.site_id == site_id)
    if overdue:
        stmt = stmt.where(Job.status.in_(OPEN_STATUSES), Job.due_date < date.today())
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.join(Client, Client.id == Job.client_id).where(
            or_(Job.title.ilike(like), Job.number.ilike(like), Client.name.ilike(like))
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    order = {
        "priority": (PRIORITY_ORDER, Job.due_date.is_(None), Job.due_date, Job.created_at.desc()),
        "due": (Job.due_date.is_(None), Job.due_date, PRIORITY_ORDER),
        "newest": (Job.created_at.desc(),),
        "updated": (Job.updated_at.desc(),),
    }[sort]
    jobs = db.scalars(stmt.order_by(*order).limit(limit).offset(offset)).unique().all()
    return {"items": [job_list_item(j) for j in jobs], "total": total}


def _detail(db: Session, job: Job) -> schemas.JobDetail:
    return job_detail(job, suggested_assignees(db, job))


@router.get("/jobs/{job_id}", response_model=schemas.JobDetail)
def get_job(job_id: str, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    return _detail(db, get_scoped(db, Job, job_id, scope))


@router.post("/jobs", response_model=schemas.JobDetail, status_code=201)
def create_job(body: schemas.JobIn, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    client = get_scoped(db, Client, body.client_id, scope)
    if body.site_id:
        site = get_scoped(db, Site, body.site_id, scope)
        if site.client_id != client.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That site belongs to another client.")
    if body.schedule_id:
        schedule = db.get(ServiceSchedule, body.schedule_id)
        if schedule is None or schedule.tenant_id != scope.tenant_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown service schedule.")

    job = Job(
        tenant_id=scope.tenant_id,
        number=next_job_number(db, scope.tenant_id),
        region_id=client.region_id,
        created_by_id=scope.user.id,
        **body.model_dump(exclude={"assignee_id"}),
    )
    job.region = client.region
    db.add(job)
    db.flush()
    source = " by AI intake" if body.source == JobSource.ai_intake else " from a service schedule" if body.source == JobSource.schedule else ""
    add_event(db, job, scope.user, "created", f"Job created{source}")
    set_assignee(db, job, check_assignee(db, job, body.assignee_id), scope.user)
    db.commit()
    db.refresh(job)
    _audit_job(
        "job.create",
        f"Created {job.number}{source} for {job.client.name}"
        + (f", assigned to {job.assignee.full_name}" if job.assignee else ", unassigned"),
        job,
        diff({}, {**snapshot(job, JOB_FIELDS), "assignee": job.assignee.full_name if job.assignee else None}),
    )
    return _detail(db, job)


@router.post("/schedules/{schedule_id}/job", response_model=schemas.JobDetail, status_code=201)
def create_job_from_schedule(schedule_id: str, scope: Scope = Depends(get_scope), user=Depends(manager), db: Session = Depends(get_db)):
    """Raise a job for a required service (one open job per schedule)."""
    schedule = db.get(ServiceSchedule, schedule_id)
    if schedule is None or schedule.tenant_id != scope.tenant_id or not scope.can_see_region(schedule.site.region_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    existing = db.scalar(select(Job).where(Job.schedule_id == schedule.id, Job.status.in_(OPEN_STATUSES)))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{existing.number} is already open for this service.")
    site = schedule.site
    body = schemas.JobIn(
        client_id=site.client_id,
        site_id=site.id,
        title=f"{label(schedule.service_type).capitalize()} – {site.name}",
        description=f"Scheduled {label(schedule.service_type)} (every {schedule.interval_days} days).",
        service_type=schedule.service_type,
        priority=Priority.medium if schedule.next_due_date >= date.today() else Priority.high,
        due_date=max(schedule.next_due_date, date.today()),
        source=JobSource.schedule,
        schedule_id=schedule.id,
    )
    return create_job(body, scope, user, db)


@router.patch("/jobs/{job_id}", response_model=schemas.JobDetail)
def update_job(job_id: str, body: schemas.JobUpdate, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    job = get_scoped(db, Job, job_id, scope)
    data = body.model_dump(exclude_unset=True)
    if data.get("site_id"):
        site = get_scoped(db, Site, data["site_id"], scope)
        if site.client_id != job.client_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That site belongs to another client.")
    before = snapshot(job, JOB_FIELDS)
    changes = []
    for key, value in data.items():
        if getattr(job, key) != value:
            changes.append(key.replace("_", " "))
            setattr(job, key, value)
    if changes:
        add_event(db, job, scope.user, "updated", f"Updated {', '.join(changes)}")
    _audit_job("job.update", f"Edited {job.number}", job, diff(before, snapshot(job, JOB_FIELDS)))
    db.commit()
    db.refresh(job)
    return _detail(db, job)


@router.post("/jobs/{job_id}/assign", response_model=schemas.JobDetail)
def assign_job(job_id: str, body: schemas.AssignIn, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    """Managers assign anyone (or unassign); technicians can only pick up an unassigned job themselves."""
    job = get_scoped(db, Job, job_id, scope)
    user = scope.user
    if user.role == Role.technician:
        claiming = job.assignee_id is None and body.assignee_id == user.id
        releasing = job.assignee_id == user.id and body.assignee_id is None
        if not (claiming or releasing):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Technicians can only pick up or release their own jobs.")
    if job.status in (JobStatus.completed, JobStatus.cancelled):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This job is closed.")
    before = job.assignee.full_name if job.assignee else None
    set_assignee(db, job, check_assignee(db, job, body.assignee_id), user)
    after = job.assignee.full_name if job.assignee else None
    _audit_job(
        "job.unassign" if after is None else "job.assign",
        f"Unassigned {job.number}" if after is None else f"Assigned {job.number} to {after}",
        job,
        diff({"assignee": before}, {"assignee": after}),
    )
    db.commit()
    db.refresh(job)
    return _detail(db, job)


@router.post("/jobs/{job_id}/status", response_model=schemas.JobDetail)
def change_status(job_id: str, body: schemas.StatusIn, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    job = get_scoped(db, Job, job_id, scope)
    _require_work(job, scope.user)
    if body.status == JobStatus.cancelled and scope.user.role not in MANAGE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a manager can cancel a job.")
    if body.status == JobStatus.completed and (job.report is None or job.report.status != ReportStatus.final):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Finalize the service report before completing the job.")
    before = job.status
    set_status(db, job, body.status, scope.user, body.note)
    _audit_job(f"job.{'cancel' if body.status == JobStatus.cancelled else 'status'}",
               f"Changed {job.number} from {label(before)} to {label(body.status)}", job,
               diff({"status": before}, {"status": body.status}))
    db.commit()
    db.refresh(job)
    return _detail(db, job)


@router.post("/jobs/{job_id}/notes", response_model=schemas.JobDetail)
def add_note(job_id: str, body: schemas.NoteIn, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    job = get_scoped(db, Job, job_id, scope)
    add_event(db, job, scope.user, "note", body.message.strip())
    _audit_job("job.note", f"Added a note to {job.number}", job, {"note": [None, body.message.strip()]})
    job.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return _detail(db, job)


# ---- Service reports ----

def _report_for(db: Session, job: Job, user: User) -> ServiceReport:
    if job.report is None:
        job.report = ServiceReport(tenant_id=job.tenant_id, author_id=user.id)
        db.flush()
    if job.report.status == ReportStatus.final:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This report is final. Reopen it to make changes.")
    return job.report


@router.post("/jobs/{job_id}/report/draft", response_model=schemas.JobDetail)
def generate_report(job_id: str, body: schemas.ReportDraftIn, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    """AI drafts the report from the technician's notes; the draft stays editable."""
    job = get_scoped(db, Job, job_id, scope)
    _require_work(job, scope.user)
    report = _report_for(db, job, scope.user)
    result = draft_report(db, scope.tenant_id, scope.user.id, job, body.technician_notes, body.readings)
    report.technician_notes = body.technician_notes
    report.readings = body.readings
    report.summary = result.data["summary"]
    report.work_performed = result.data["work_performed"]
    report.findings = result.data["findings"]
    report.recommendations = result.data["recommendations"]
    report.ai_generated = True
    report.author_id = scope.user.id
    add_event(db, job, scope.user, "report", "Service report drafted with AI")
    _audit_job("report.ai_draft", f"Drafted the service report for {job.number} with AI ({result.provider})", job)
    db.commit()
    db.refresh(job)
    return _detail(db, job)


@router.patch("/jobs/{job_id}/report", response_model=schemas.JobDetail)
def update_report(job_id: str, body: schemas.ReportUpdate, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    job = get_scoped(db, Job, job_id, scope)
    _require_work(job, scope.user)
    report = _report_for(db, job, scope.user)
    before = snapshot(report, REPORT_FIELDS)
    for key, value in body.model_dump(exclude_unset=True).items():
        if isinstance(value, list):
            value = [v.strip() for v in value if v.strip()]
        setattr(report, key, value)
    _audit_job("report.update", f"Edited the service report for {job.number}", job,
               diff(before, snapshot(report, REPORT_FIELDS)))
    db.commit()
    db.refresh(job)
    return _detail(db, job)


@router.post("/jobs/{job_id}/report/finalize", response_model=schemas.JobDetail)
def finalize_report(job_id: str, complete_job: bool = True, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    """Lock the report as the maintenance record and (by default) complete the job."""
    job = get_scoped(db, Job, job_id, scope)
    _require_work(job, scope.user)
    report = job.report
    if report is None or not report.summary.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Write or generate the report first.")
    report.status = ReportStatus.final
    report.finalized_at = datetime.now(timezone.utc)
    add_event(db, job, scope.user, "report", "Service report finalized")
    _audit_job("report.finalize", f"Finalized the service report for {job.number}"
               + (" and completed the job" if complete_job and job.status != JobStatus.completed else ""), job)
    if complete_job and job.status != JobStatus.completed:
        set_status(db, job, JobStatus.completed, scope.user)
    db.commit()
    db.refresh(job)
    return _detail(db, job)


@router.post("/jobs/{job_id}/report/reopen", response_model=schemas.JobDetail)
def reopen_report(job_id: str, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    job = get_scoped(db, Job, job_id, scope)
    if job.report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No report yet.")
    job.report.status = ReportStatus.draft
    job.report.finalized_at = None
    add_event(db, job, scope.user, "report", "Service report reopened for editing")
    _audit_job("report.reopen", f"Reopened the final service report for {job.number}", job)
    db.commit()
    db.refresh(job)
    return _detail(db, job)


# ---- Maintenance history ----

@router.get("/sites/{site_id}/history", response_model=list[schemas.JobDetail])
def site_history(site_id: str, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    """Completed jobs with final reports at a site: its maintenance record, newest first."""
    get_scoped(db, Site, site_id, scope)
    jobs = db.scalars(
        select(Job)
        .where(Job.site_id == site_id, Job.status == JobStatus.completed)
        .order_by(Job.completed_at.desc())
        .limit(100)
    ).unique()
    return [job_detail(j, []) for j in jobs]


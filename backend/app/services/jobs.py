"""Job rules shared by the routes and the seed script."""
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import (
    OPEN_STATUSES,
    Job,
    JobEvent,
    JobStatus,
    Priority,
    Role,
    ServiceSchedule,
    Tenant,
    User,
)


# Sort key: urgent first.
PRIORITY_ORDER = case(
    {Priority.urgent: 0, Priority.high: 1, Priority.medium: 2, Priority.low: 3}, value=Job.priority
)


def next_job_number(db: Session, tenant_id: str) -> str:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id).with_for_update()).scalar_one()
    number = tenant.next_job_number
    tenant.next_job_number = number + 1
    return f"JOB-{number}"


def add_event(db: Session, job: Job, user: User | None, kind: str, message: str, at: datetime | None = None) -> None:
    event = JobEvent(job=job, user_id=user.id if user else None, kind=kind, message=message)
    if at:
        event.created_at = at
    db.add(event)


def label(value) -> str:
    return value.value.replace("_", " ")


def check_assignee(db: Session, job: Job, assignee_id: str | None) -> User | None:
    """An assignee must be an active user of this tenant who works in the job's region."""
    if assignee_id is None:
        return None
    user = db.get(User, assignee_id)
    if user is None or user.tenant_id != job.tenant_id or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That person can't be assigned.")
    if user.role != Role.admin and job.region_id not in {r.id for r in user.regions}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{user.full_name} doesn't cover the {job.region.name} region.")
    return user


def set_assignee(db: Session, job: Job, assignee: User | None, actor: User) -> None:
    if (assignee.id if assignee else None) == job.assignee_id:
        return
    job.assignee_id = assignee.id if assignee else None
    job.assignee = assignee
    if assignee:
        add_event(db, job, actor, "assigned", f"Assigned to {assignee.full_name}")
        if job.status == JobStatus.new and job.scheduled_date:
            job.status = JobStatus.scheduled
    else:
        add_event(db, job, actor, "assigned", "Marked unassigned")


def set_status(db: Session, job: Job, new: JobStatus, actor: User, note: str | None = None) -> None:
    if new == job.status:
        return
    old = job.status
    job.status = new
    message = f"Status changed from {label(old)} to {label(new)}"
    if note:
        message += f": {note}"
    add_event(db, job, actor, "status", message)

    if new == JobStatus.completed:
        job.completed_at = datetime.now(timezone.utc)
        job.feedback_token = job.feedback_token or secrets.token_urlsafe(24)
        if job.schedule_id:
            roll_schedule_forward(db, job.schedule_id, job.completed_at.date())
    elif old == JobStatus.completed:
        job.completed_at = None


def roll_schedule_forward(db: Session, schedule_id: str, done_on: date) -> None:
    schedule = db.get(ServiceSchedule, schedule_id)
    if schedule:
        schedule.last_done_date = done_on
        schedule.next_due_date = done_on + timedelta(days=schedule.interval_days)


def is_overdue(job: Job, today: date | None = None) -> bool:
    today = today or date.today()
    return job.status in OPEN_STATUSES and job.due_date is not None and job.due_date < today


def suggested_assignees(db: Session, job: Job, limit: int = 3) -> list[User]:
    """Technicians in the job's region: matching skill first, then the lightest open workload."""
    techs = db.scalars(
        select(User).where(
            User.tenant_id == job.tenant_id,
            User.role == Role.technician,
            User.is_active.is_(True),
            User.regions.any(id=job.region_id),
        )
    ).all()
    if not techs:
        return []
    load = dict(
        db.execute(
            select(Job.assignee_id, func.count())
            .where(Job.assignee_id.in_([t.id for t in techs]), Job.status.in_(OPEN_STATUSES))
            .group_by(Job.assignee_id)
        ).all()
    )
    service = job.service_type.value
    techs = sorted(techs, key=lambda t: (service not in (t.skills or []), load.get(t.id, 0), t.full_name))
    return [t for t in techs if t.id != job.assignee_id][:limit]

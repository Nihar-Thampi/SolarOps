"""Everything the dashboard shows, in one request, for the regions the user can see."""
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import Scope, get_scope, region_param
from app.models import (
    OPEN_STATUSES,
    Feedback,
    Priority,
    Job,
    JobStatus,
    Region,
    Role,
    Sentiment,
    ServiceSchedule,
    Site,
    User,
)
from app import schemas
from app.services.jobs import PRIORITY_ORDER
from app.services.serializers import feedback_out, job_list_item, schedule_out

router = APIRouter(tags=["dashboard"])


class Kpis(BaseModel):
    open_jobs: int
    unassigned_jobs: int
    overdue_jobs: int
    urgent_jobs: int
    services_due: int
    completed_30d: int
    completed_prev_30d: int
    avg_rating_90d: float | None
    feedback_90d: int


class CountRow(BaseModel):
    key: str
    label: str
    count: int


class RegionRow(BaseModel):
    region_id: str
    region: str
    open: int
    unassigned: int
    overdue: int
    completed_30d: int


class WeekRow(BaseModel):
    week_start: date
    completed: int
    created: int


class WorkloadRow(BaseModel):
    user_id: str
    name: str
    open: int
    in_progress: int


class ThemeRow(BaseModel):
    theme: str
    positive: int
    neutral: int
    negative: int


class DashboardOut(BaseModel):
    kpis: Kpis
    jobs_by_status: list[CountRow]
    jobs_by_service: list[CountRow]
    regions: list[RegionRow]
    weekly: list[WeekRow]
    workload: list[WorkloadRow]
    sentiment: list[CountRow]
    themes: list[ThemeRow]
    unassigned: list[schemas.JobListItem]
    due_services: list[schemas.ScheduleOut]
    recent_negative: list[schemas.FeedbackOut]


def _label(v: str) -> str:
    return v.replace("_", " ").capitalize()


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(region_id: str | None = Depends(region_param), scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    today = date.today()
    now = datetime.now(timezone.utc)
    jobs_q = scope.apply(select(Job), Job, region_id)
    open_q = jobs_q.where(Job.status.in_(OPEN_STATUSES))

    def count(stmt) -> int:
        return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    completed_30 = jobs_q.where(Job.status == JobStatus.completed, Job.completed_at >= now - timedelta(days=30))
    completed_prev = jobs_q.where(
        Job.status == JobStatus.completed,
        Job.completed_at >= now - timedelta(days=60),
        Job.completed_at < now - timedelta(days=30),
    )

    fb_q = scope.apply(select(Feedback), Feedback, region_id).where(Feedback.created_at >= now - timedelta(days=90))
    feedback = db.scalars(fb_q.order_by(Feedback.created_at.desc())).unique().all()

    schedules_q = (
        scope.apply(select(ServiceSchedule).join(Site), Site, region_id)
        .where(ServiceSchedule.is_active.is_(True), ServiceSchedule.next_due_date <= today + timedelta(days=14))
        .order_by(ServiceSchedule.next_due_date)
    )
    schedules = db.scalars(schedules_q).unique().all()
    open_by_schedule = {
        j.schedule_id: j
        for j in db.scalars(
            select(Job).where(Job.schedule_id.in_([s.id for s in schedules]), Job.status.in_(OPEN_STATUSES))
        ).unique()
    }
    # A due service needs action only if no open job covers it yet.
    needing_job = [s for s in schedules if s.id not in open_by_schedule]

    kpis = Kpis(
        open_jobs=count(open_q),
        unassigned_jobs=count(open_q.where(Job.assignee_id.is_(None))),
        overdue_jobs=count(open_q.where(Job.due_date < today)),
        urgent_jobs=count(open_q.where(Job.priority == Priority.urgent)),
        services_due=len(needing_job),
        completed_30d=count(completed_30),
        completed_prev_30d=count(completed_prev),
        avg_rating_90d=round(sum(f.rating for f in feedback) / len(feedback), 2) if feedback else None,
        feedback_90d=len(feedback),
    )

    open_jobs = db.scalars(open_q).unique().all()
    status_counts = Counter(j.status for j in open_jobs)
    jobs_by_status = [CountRow(key=s.value, label=_label(s.value), count=status_counts.get(s, 0)) for s in OPEN_STATUSES]
    service_counts = Counter(j.service_type.value for j in open_jobs)
    jobs_by_service = [CountRow(key=k, label=_label(k), count=v) for k, v in service_counts.most_common()]

    # Per-region table.
    regions_stmt = select(Region).where(Region.tenant_id == scope.tenant_id).order_by(Region.name)
    if scope.region_ids is not None:
        regions_stmt = regions_stmt.where(Region.id.in_(scope.region_ids))
    if region_id:
        regions_stmt = regions_stmt.where(Region.id == region_id)
    completed_recent = db.scalars(completed_30).unique().all()
    regions = [
        RegionRow(
            region_id=r.id,
            region=r.name,
            open=sum(1 for j in open_jobs if j.region_id == r.id),
            unassigned=sum(1 for j in open_jobs if j.region_id == r.id and j.assignee_id is None),
            overdue=sum(1 for j in open_jobs if j.region_id == r.id and j.due_date and j.due_date < today),
            completed_30d=sum(1 for j in completed_recent if j.region_id == r.id),
        )
        for r in db.scalars(regions_stmt)
    ]

    # Created vs completed per week, last 12 weeks (weeks start Monday).
    start = today - timedelta(days=today.weekday()) - timedelta(weeks=11)
    since = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    recent = db.scalars(jobs_q.where((Job.created_at >= since) | (Job.completed_at >= since))).unique().all()
    weeks = {start + timedelta(weeks=i): [0, 0] for i in range(12)}

    def week_of(dt: datetime) -> date:
        d = dt.date()
        return d - timedelta(days=d.weekday())

    for j in recent:
        if j.created_at and week_of(j.created_at) in weeks:
            weeks[week_of(j.created_at)][1] += 1
        if j.completed_at and week_of(j.completed_at) in weeks:
            weeks[week_of(j.completed_at)][0] += 1
    weekly = [WeekRow(week_start=w, completed=c, created=n) for w, (c, n) in weeks.items()]

    # Technician workload.
    tech_stmt = select(User).where(User.tenant_id == scope.tenant_id, User.role == Role.technician, User.is_active.is_(True))
    if scope.region_ids is not None:
        tech_stmt = tech_stmt.where(User.regions.any(Region.id.in_(scope.region_ids)))
    if region_id:
        tech_stmt = tech_stmt.where(User.regions.any(id=region_id))
    workload = sorted(
        (
            WorkloadRow(
                user_id=t.id,
                name=t.full_name,
                open=sum(1 for j in open_jobs if j.assignee_id == t.id),
                in_progress=sum(1 for j in open_jobs if j.assignee_id == t.id and j.status == JobStatus.in_progress),
            )
            for t in db.scalars(tech_stmt).unique()
        ),
        key=lambda w: -w.open,
    )

    sentiment_counts = Counter(f.sentiment for f in feedback if f.sentiment)
    sentiment = [CountRow(key=s.value, label=s.value.capitalize(), count=sentiment_counts.get(s, 0)) for s in Sentiment]
    theme_counts: dict[str, Counter] = {}
    for f in feedback:
        for t in f.themes or []:
            theme_counts.setdefault(t, Counter())[f.sentiment] += 1
    themes = sorted(
        (
            ThemeRow(
                theme=t,
                positive=c[Sentiment.positive],
                neutral=c[Sentiment.neutral],
                negative=c[Sentiment.negative],
            )
            for t, c in theme_counts.items()
        ),
        key=lambda r: -(r.positive + r.neutral + r.negative),
    )

    unassigned = db.scalars(
        open_q.where(Job.assignee_id.is_(None)).order_by(PRIORITY_ORDER, Job.created_at).limit(6)
    ).unique().all()

    return DashboardOut(
        kpis=kpis,
        jobs_by_status=jobs_by_status,
        jobs_by_service=jobs_by_service,
        regions=regions,
        weekly=weekly,
        workload=workload,
        sentiment=sentiment,
        themes=themes,
        unassigned=[job_list_item(j) for j in unassigned],
        due_services=[schedule_out(s, None) for s in needing_job[:8]],
        recent_negative=[feedback_out(f) for f in feedback if f.sentiment == Sentiment.negative][:5],
    )

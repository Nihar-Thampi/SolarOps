from datetime import date, datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import (
    ClientType,
    JobSource,
    JobStatus,
    Priority,
    ReportStatus,
    Role,
    Sentiment,
    ServiceType,
)


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- Auth / users / regions ----

class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RegionOut(ORM):
    id: str
    name: str
    code: str


class RegionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=20)


class UserBrief(ORM):
    id: str
    full_name: str
    role: Role


class UserOut(ORM):
    id: str
    email: str
    full_name: str
    role: Role
    phone: str | None
    skills: list[str]
    is_active: bool
    regions: list[RegionOut]


class UserIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    role: Role
    phone: str | None = None
    skills: list[str] = []
    region_ids: list[str] = []
    password: str | None = Field(None, min_length=8)


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: Role | None = None
    phone: str | None = None
    skills: list[str] | None = None
    region_ids: list[str] | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8)


class TenantOut(ORM):
    id: str
    name: str
    slug: str


class MeOut(BaseModel):
    user: UserOut
    tenant: TenantOut
    # Regions this user can see (all of the tenant's for admins).
    visible_regions: list[RegionOut]


class LoginOut(MeOut):
    token: str


# ---- Clients / sites ----

class ClientIn(BaseModel):
    region_id: str
    name: str = Field(min_length=1, max_length=200)
    client_type: ClientType
    contact_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    address: str | None = None
    notes: str | None = None


class ClientOut(ORM):
    id: str
    region: RegionOut
    name: str
    client_type: ClientType
    contact_name: str | None
    email: str | None
    phone: str | None
    address: str | None
    notes: str | None
    created_at: datetime


class ClientListItem(ClientOut):
    site_count: int = 0
    open_jobs: int = 0


class SiteIn(BaseModel):
    client_id: str
    name: str = Field(min_length=1, max_length=200)
    address: str | None = None
    system_size_kw: float | None = Field(None, ge=0)
    panel_count: int | None = Field(None, ge=0)
    panel_model: str | None = None
    inverter_model: str | None = None
    has_battery: bool = False
    install_date: date | None = None


class SiteBrief(ORM):
    id: str
    name: str
    address: str | None


class SiteOut(ORM):
    id: str
    client_id: str
    client_name: str
    region: RegionOut
    name: str
    address: str | None
    system_size_kw: float | None
    panel_count: int | None
    panel_model: str | None
    inverter_model: str | None
    has_battery: bool
    install_date: date | None


# ---- Service schedules (required services) ----

class ScheduleIn(BaseModel):
    site_id: str
    service_type: ServiceType
    interval_days: int = Field(ge=1, le=3650)
    next_due_date: date
    last_done_date: date | None = None


class ScheduleUpdate(BaseModel):
    interval_days: int | None = Field(None, ge=1, le=3650)
    next_due_date: date | None = None
    is_active: bool | None = None


class ScheduleOut(ORM):
    id: str
    site_id: str
    site_name: str
    client_id: str
    client_name: str
    region: RegionOut
    service_type: ServiceType
    interval_days: int
    last_done_date: date | None
    next_due_date: date
    is_active: bool
    days_until_due: int
    # The open job already raised for this schedule, if any.
    open_job_id: str | None = None
    open_job_number: str | None = None


# ---- Jobs ----

class JobIn(BaseModel):
    client_id: str
    site_id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    service_type: ServiceType
    priority: Priority = Priority.medium
    assignee_id: str | None = None
    scheduled_date: date | None = None
    due_date: date | None = None
    source: JobSource = JobSource.manual
    schedule_id: str | None = None


class JobUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    service_type: ServiceType | None = None
    priority: Priority | None = None
    site_id: str | None = None
    scheduled_date: date | None = None
    due_date: date | None = None


class AssignIn(BaseModel):
    # null = unassign.
    assignee_id: str | None


class StatusIn(BaseModel):
    status: JobStatus
    note: str | None = None


class NoteIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class JobEventOut(ORM):
    id: str
    kind: str
    message: str
    created_at: datetime
    user: UserBrief | None


class JobListItem(ORM):
    id: str
    number: str
    title: str
    service_type: ServiceType
    priority: Priority
    status: JobStatus
    source: JobSource
    region: RegionOut
    client_id: str
    client_name: str
    site: SiteBrief | None
    assignee: UserBrief | None
    scheduled_date: date | None
    due_date: date | None
    completed_at: datetime | None
    created_at: datetime
    is_overdue: bool


class ReportOut(ORM):
    id: str
    technician_notes: str
    summary: str
    work_performed: list[str]
    findings: list[str]
    recommendations: list[str]
    readings: dict[str, str]
    status: ReportStatus
    ai_generated: bool
    finalized_at: datetime | None
    author: UserBrief | None
    updated_at: datetime


class FeedbackOut(ORM):
    id: str
    job_id: str
    job_number: str
    client_id: str
    client_name: str
    region: RegionOut
    rating: int
    comment: str
    sentiment: Sentiment | None
    sentiment_score: float | None
    themes: list[str]
    created_at: datetime


class JobDetail(JobListItem):
    description: str | None
    client: ClientOut
    site_detail: SiteOut | None
    schedule_id: str | None
    events: list[JobEventOut]
    report: ReportOut | None
    feedback: FeedbackOut | None
    feedback_url: str | None
    # Technicians suggested for this job: right region, matching skill, lightest load.
    suggested_assignees: list[UserBrief]


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int


# ---- Reports ----

class ReportDraftIn(BaseModel):
    technician_notes: str = Field(min_length=1, max_length=8000)
    readings: dict[str, str] = {}


class ReportUpdate(BaseModel):
    technician_notes: str | None = None
    summary: str | None = None
    work_performed: list[str] | None = None
    findings: list[str] | None = None
    recommendations: list[str] | None = None
    readings: dict[str, str] | None = None


# ---- Feedback (public form) ----

class PublicFeedbackJob(BaseModel):
    company_name: str
    job_number: str
    title: str
    site_name: str | None
    completed_at: datetime | None
    already_submitted: bool


class PublicFeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field("", max_length=4000)


# ---- AI ----

class IntakeIn(BaseModel):
    text: str = Field(min_length=5, max_length=6000)


class IntakeDraft(BaseModel):
    """What the AI proposes; the user reviews it before a job is created."""

    title: str
    description: str
    service_type: ServiceType
    priority: Priority
    client_id: str | None
    site_id: str | None
    # Not an existing client: the name/contact the message mentions, for the user to add.
    new_client_name: str | None
    contact_name: str | None
    contact_phone: str | None
    contact_email: str | None
    reasoning: str
    confidence: float
    provider: str
    model: str


class InsightsOut(BaseModel):
    summary: str
    praise: list[str]
    complaints: list[str]
    suggested_actions: list[str]
    feedback_count: int
    provider: str
    model: str
    generated_at: datetime


class AIRequestOut(ORM):
    id: str
    feature: str
    provider: str
    model: str
    input_text: str
    output_text: str
    success: bool
    error: str | None
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None
    created_at: datetime
    user: UserBrief | None


class AIStatusOut(BaseModel):
    provider: str
    model: str
    is_demo: bool

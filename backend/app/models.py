"""Data model.

Every business row carries tenant_id: a tenant is one solar O&M company, and no query
ever crosses tenants (see app/deps.py). Inside a tenant, work is split by region;
managers and technicians only see the regions they are assigned to.
"""
import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    DDL,
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Always UTC and timezone-aware, including on SQLite (which drops the offset)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc) if value is not None else None

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class Role(str, enum.Enum):
    admin = "admin"  # whole tenant, settings, users, regions
    manager = "manager"  # their regions: clients, sites, jobs, assignment
    technician = "technician"  # jobs in their regions; works and reports on jobs


class ClientType(str, enum.Enum):
    residential = "residential"
    commercial = "commercial"
    utility = "utility"


class ServiceType(str, enum.Enum):
    panel_cleaning = "panel_cleaning"
    inverter_service = "inverter_service"
    thermal_inspection = "thermal_inspection"
    electrical_safety = "electrical_safety"
    vegetation_control = "vegetation_control"
    fault_repair = "fault_repair"
    monitoring_check = "monitoring_check"
    installation_audit = "installation_audit"


class Priority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class JobStatus(str, enum.Enum):
    new = "new"
    scheduled = "scheduled"
    in_progress = "in_progress"
    on_hold = "on_hold"
    completed = "completed"
    cancelled = "cancelled"


OPEN_STATUSES = (JobStatus.new, JobStatus.scheduled, JobStatus.in_progress, JobStatus.on_hold)


class JobSource(str, enum.Enum):
    manual = "manual"
    ai_intake = "ai_intake"
    schedule = "schedule"


class ReportStatus(str, enum.Enum):
    draft = "draft"
    final = "final"


class Sentiment(str, enum.Enum):
    positive = "positive"
    neutral = "neutral"
    negative = "negative"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class Tenant(TimestampMixin, Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    # Per-tenant job numbering: JOB-1001, JOB-1002, ...
    next_job_number: Mapped[int] = mapped_column(Integer, default=1001)


user_regions = Table(
    "user_regions",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("region_id", ForeignKey("regions.id", ondelete="CASCADE"), primary_key=True),
)


class Region(TimestampMixin, Base):
    __tablename__ = "regions"
    __table_args__ = (UniqueConstraint("tenant_id", "code"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(20))


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False))
    phone: Mapped[str | None] = mapped_column(String(40))
    # Technician skills, matched against job service types when suggesting an assignee.
    skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    tenant: Mapped[Tenant] = relationship()
    regions: Mapped[list[Region]] = relationship(secondary=user_regions, lazy="selectin")


class Client(TimestampMixin, Base):
    __tablename__ = "clients"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    region_id: Mapped[str] = mapped_column(ForeignKey("regions.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    client_type: Mapped[ClientType] = mapped_column(Enum(ClientType, native_enum=False))
    contact_name: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(String(400))
    notes: Mapped[str | None] = mapped_column(Text)

    region: Mapped[Region] = relationship(lazy="joined")
    sites: Mapped[list["Site"]] = relationship(back_populates="client", cascade="all, delete-orphan")


class Site(TimestampMixin, Base):
    """A solar installation at a client's property."""

    __tablename__ = "sites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    region_id: Mapped[str] = mapped_column(ForeignKey("regions.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(400))
    system_size_kw: Mapped[float | None] = mapped_column(Float)
    panel_count: Mapped[int | None] = mapped_column(Integer)
    panel_model: Mapped[str | None] = mapped_column(String(120))
    inverter_model: Mapped[str | None] = mapped_column(String(120))
    has_battery: Mapped[bool] = mapped_column(Boolean, default=False)
    install_date: Mapped[date | None] = mapped_column(Date)

    client: Mapped[Client] = relationship(back_populates="sites", lazy="joined")
    region: Mapped[Region] = relationship(lazy="joined")
    schedules: Mapped[list["ServiceSchedule"]] = relationship(back_populates="site", cascade="all, delete-orphan")


class ServiceSchedule(TimestampMixin, Base):
    """A recurring service a site needs (e.g. panel cleaning every 90 days).

    A schedule whose next_due_date has arrived is a "currently required service";
    creating a job from it and completing that job rolls the due date forward.
    """

    __tablename__ = "service_schedules"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    service_type: Mapped[ServiceType] = mapped_column(Enum(ServiceType, native_enum=False))
    interval_days: Mapped[int] = mapped_column(Integer)
    last_done_date: Mapped[date | None] = mapped_column(Date)
    next_due_date: Mapped[date] = mapped_column(Date, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    site: Mapped[Site] = relationship(back_populates="schedules", lazy="joined")


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("tenant_id", "number"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(20))
    region_id: Mapped[str] = mapped_column(ForeignKey("regions.id"), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[str | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), index=True)
    schedule_id: Mapped[str | None] = mapped_column(ForeignKey("service_schedules.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    service_type: Mapped[ServiceType] = mapped_column(Enum(ServiceType, native_enum=False))
    priority: Mapped[Priority] = mapped_column(Enum(Priority, native_enum=False), default=Priority.medium)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus, native_enum=False), default=JobStatus.new, index=True)
    source: Mapped[JobSource] = mapped_column(Enum(JobSource, native_enum=False), default=JobSource.manual)
    # Nullable on purpose: a job can sit unassigned until someone picks it up.
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    scheduled_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Token for the customer's feedback link, set when the job is completed.
    feedback_token: Mapped[str | None] = mapped_column(String(64), unique=True)

    region: Mapped[Region] = relationship(lazy="joined")
    client: Mapped[Client] = relationship(lazy="joined")
    site: Mapped[Site | None] = relationship(lazy="joined")
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id], lazy="joined")
    events: Mapped[list["JobEvent"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="JobEvent.created_at"
    )
    report: Mapped["ServiceReport | None"] = relationship(back_populates="job", cascade="all, delete-orphan")
    feedback: Mapped["Feedback | None"] = relationship(back_populates="job", cascade="all, delete-orphan")


class JobEvent(Base):
    """Activity timeline for a job: created, assigned, status changes, notes."""

    __tablename__ = "job_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(40))  # created, assigned, status, note, report
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    job: Mapped[Job] = relationship(back_populates="events")
    user: Mapped[User | None] = relationship(lazy="joined")


class ServiceReport(TimestampMixin, Base):
    """The maintenance record for a job. Drafted by AI from the technician's notes."""

    __tablename__ = "service_reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), unique=True)
    technician_notes: Mapped[str] = mapped_column(Text, default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    work_performed: Mapped[list[str]] = mapped_column(JSON, default=list)
    findings: Mapped[list[str]] = mapped_column(JSON, default=list)
    recommendations: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Readings taken on site, e.g. {"Inverter output (kW)": "4.6"}.
    readings: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    status: Mapped[ReportStatus] = mapped_column(Enum(ReportStatus, native_enum=False), default=ReportStatus.draft)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    finalized_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    job: Mapped[Job] = relationship(back_populates="report")
    author: Mapped[User | None] = relationship(lazy="joined")


class Feedback(TimestampMixin, Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), unique=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    region_id: Mapped[str] = mapped_column(ForeignKey("regions.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)  # 1-5
    comment: Mapped[str] = mapped_column(Text, default="")
    # Filled in by AI analysis.
    sentiment: Mapped[Sentiment | None] = mapped_column(Enum(Sentiment, native_enum=False))
    sentiment_score: Mapped[float | None] = mapped_column(Float)  # -1 .. 1
    themes: Mapped[list[str]] = mapped_column(JSON, default=list)
    analyzed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    job: Mapped[Job] = relationship(back_populates="feedback")
    client: Mapped[Client] = relationship(lazy="joined")


class AIRequest(Base):
    """Log of every AI call: what was asked, what came back, how long and which model."""

    __tablename__ = "ai_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    feature: Mapped[str] = mapped_column(String(40))  # intake, report, feedback, insights
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(120))
    input_text: Mapped[str] = mapped_column(Text)
    output_text: Mapped[str] = mapped_column(Text, default="")
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    error: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    user: Mapped[User | None] = relationship(lazy="joined")


class AuditLog(Base):
    """Append-only, hash-chained record of user actions (see app/services/audit.py).

    Who/what is copied onto the entry (email, name, role) so it stays readable even if the
    user is later renamed or deactivated. No foreign keys: the trail must outlive any record.
    """

    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str | None] = mapped_column(String(36), index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    user_email: Mapped[str | None] = mapped_column(String(255))
    user_name: Mapped[str | None] = mapped_column(String(200))
    user_role: Mapped[str | None] = mapped_column(String(20))
    action: Mapped[str] = mapped_column(String(60), index=True)  # e.g. job.assign, auth.login_failed
    summary: Mapped[str] = mapped_column(Text)
    entity_type: Mapped[str | None] = mapped_column(String(40), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), index=True)
    entity_label: Mapped[str | None] = mapped_column(String(200))
    changes: Mapped[dict | None] = mapped_column(JSON)  # {field: [before, after]}
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(300))
    status_code: Mapped[int] = mapped_column(Integer)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    request_id: Mapped[str | None] = mapped_column(String(32))
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


# The database itself refuses to change or remove audit entries.
_SQLITE_IMMUTABLE = [
    DDL(
        "CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log "
        "BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END"
    ),
    DDL(
        "CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log "
        "BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END"
    ),
]
_POSTGRES_IMMUTABLE = [
    DDL(
        "CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$ "
        "BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql"
    ),
    DDL(
        "CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log "
        "FOR EACH ROW EXECUTE FUNCTION audit_log_immutable()"
    ),
]
for _ddl in _SQLITE_IMMUTABLE:
    event.listen(AuditLog.__table__, "after_create", _ddl.execute_if(dialect="sqlite"))
for _ddl in _POSTGRES_IMMUTABLE:
    event.listen(AuditLog.__table__, "after_create", _ddl.execute_if(dialect="postgresql"))

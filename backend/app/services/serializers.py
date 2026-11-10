"""Turn ORM rows into API responses (adds computed fields like is_overdue)."""
from datetime import date

from app.core.config import get_settings
from app.models import Feedback, Job, ServiceSchedule, Site
from app import schemas
from app.services.jobs import is_overdue


def site_out(site: Site) -> schemas.SiteOut:
    return schemas.SiteOut.model_validate(
        {**_cols(site), "client_name": site.client.name, "region": site.region}
    )


def job_list_item(job: Job) -> schemas.JobListItem:
    return schemas.JobListItem.model_validate(
        {
            **_cols(job),
            "region": job.region,
            "client_name": job.client.name,
            "site": job.site,
            "assignee": job.assignee,
            "is_overdue": is_overdue(job),
        }
    )


def feedback_out(f: Feedback) -> schemas.FeedbackOut:
    return schemas.FeedbackOut.model_validate(
        {
            **_cols(f),
            "job_number": f.job.number,
            "client_name": f.client.name,
            "region": f.job.region,
        }
    )


def job_detail(job: Job, suggested) -> schemas.JobDetail:
    base = job_list_item(job).model_dump()
    feedback_url = f"{get_settings().frontend_url}/feedback/{job.feedback_token}" if job.feedback_token else None
    return schemas.JobDetail.model_validate(
        {
            **base,
            "description": job.description,
            "client": job.client,
            "site_detail": site_out(job.site) if job.site else None,
            "schedule_id": job.schedule_id,
            "events": list(reversed(job.events)),
            "report": job.report,
            "feedback": feedback_out(job.feedback) if job.feedback else None,
            "feedback_url": feedback_url,
            "suggested_assignees": suggested,
        }
    )


def schedule_out(s: ServiceSchedule, open_job: Job | None, today: date | None = None) -> schemas.ScheduleOut:
    today = today or date.today()
    return schemas.ScheduleOut.model_validate(
        {
            **_cols(s),
            "site_name": s.site.name,
            "client_id": s.site.client_id,
            "client_name": s.site.client.name,
            "region": s.site.region,
            "days_until_due": (s.next_due_date - today).days,
            "open_job_id": open_job.id if open_job else None,
            "open_job_number": open_job.number if open_job else None,
        }
    )


def _cols(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__mapper__.column_attrs}

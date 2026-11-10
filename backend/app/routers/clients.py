"""Clients, their sites (solar installations), and each site's recurring service schedules."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import schemas
from app.db import get_db
from app.deps import MANAGE, Scope, get_scope, get_scoped, region_param, require_roles
from app.models import OPEN_STATUSES, Client, Job, Region, ServiceSchedule, Site
from app.services.audit import diff, record, snapshot
from app.services.serializers import schedule_out, site_out

CLIENT_FIELDS = ["name", "client_type", "region_id", "contact_name", "email", "phone", "address", "notes"]
SITE_FIELDS = ["name", "address", "system_size_kw", "panel_count", "panel_model", "inverter_model", "has_battery", "install_date"]
SCHEDULE_FIELDS = ["service_type", "interval_days", "next_due_date", "last_done_date", "is_active"]

router = APIRouter(tags=["clients"])
manager = require_roles(*MANAGE)


# ---- Clients ----

@router.get("/clients", response_model=schemas.Page[schemas.ClientListItem])
def list_clients(
    q: str | None = None,
    region_id: str | None = Depends(region_param),
    limit: int = Query(50, le=200),
    offset: int = 0,
    scope: Scope = Depends(get_scope),
    db: Session = Depends(get_db),
):
    stmt = scope.apply(select(Client), Client, region_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Client.name.ilike(like), Client.contact_name.ilike(like), Client.email.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    clients = db.scalars(stmt.order_by(Client.name).limit(limit).offset(offset)).unique().all()

    ids = [c.id for c in clients]
    sites = dict(db.execute(select(Site.client_id, func.count()).where(Site.client_id.in_(ids)).group_by(Site.client_id)).all())
    open_jobs = dict(
        db.execute(
            select(Job.client_id, func.count())
            .where(Job.client_id.in_(ids), Job.status.in_(OPEN_STATUSES))
            .group_by(Job.client_id)
        ).all()
    )
    items = [
        schemas.ClientListItem.model_validate(
            {**schemas.ClientOut.model_validate(c).model_dump(), "site_count": sites.get(c.id, 0), "open_jobs": open_jobs.get(c.id, 0)}
        )
        for c in clients
    ]
    return {"items": items, "total": total}


@router.get("/clients/{client_id}", response_model=schemas.ClientOut)
def get_client(client_id: str, scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    return get_scoped(db, Client, client_id, scope)


@router.post("/clients", response_model=schemas.ClientOut, status_code=201)
def create_client(body: schemas.ClientIn, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    _check_region(scope, db, body.region_id)
    client = Client(tenant_id=scope.tenant_id, **body.model_dump())
    db.add(client)
    db.commit()
    record("client.create", f"Added client {client.name}", entity_type="client", entity_id=client.id,
           entity_label=client.name, changes=diff({}, snapshot(client, CLIENT_FIELDS)))
    return client


@router.patch("/clients/{client_id}", response_model=schemas.ClientOut)
def update_client(client_id: str, body: schemas.ClientIn, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    client = get_scoped(db, Client, client_id, scope)
    _check_region(scope, db, body.region_id)
    before = snapshot(client, CLIENT_FIELDS)
    for key, value in body.model_dump().items():
        setattr(client, key, value)
    # Sites and open jobs follow their client into a new region.
    for site in client.sites:
        site.region_id = client.region_id
    db.flush()
    for job in db.scalars(select(Job).where(Job.client_id == client.id, Job.status.in_(OPEN_STATUSES))):
        job.region_id = client.region_id
    record("client.update", f"Updated client {client.name}", entity_type="client", entity_id=client.id,
           entity_label=client.name, changes=diff(before, snapshot(client, CLIENT_FIELDS)))
    db.commit()
    db.refresh(client)
    return client


def _check_region(scope: Scope, db: Session, region_id: str) -> None:
    region = db.get(Region, region_id)
    if region is None or region.tenant_id != scope.tenant_id or not scope.can_see_region(region_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose one of your regions.")


# ---- Sites ----

@router.get("/sites", response_model=list[schemas.SiteOut])
def list_sites(
    client_id: str | None = None,
    region_id: str | None = Depends(region_param),
    scope: Scope = Depends(get_scope),
    db: Session = Depends(get_db),
):
    stmt = scope.apply(select(Site), Site, region_id)
    if client_id:
        stmt = stmt.where(Site.client_id == client_id)
    return [site_out(s) for s in db.scalars(stmt.order_by(Site.name)).unique()]


@router.post("/sites", response_model=schemas.SiteOut, status_code=201)
def create_site(body: schemas.SiteIn, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    client = get_scoped(db, Client, body.client_id, scope)
    site = Site(tenant_id=scope.tenant_id, region_id=client.region_id, **body.model_dump())
    db.add(site)
    db.commit()
    record("site.create", f"Added site {site.name} for {client.name}", entity_type="site", entity_id=site.id,
           entity_label=f"{client.name} · {site.name}", changes=diff({}, snapshot(site, SITE_FIELDS)))
    db.refresh(site)
    return site_out(site)


@router.patch("/sites/{site_id}", response_model=schemas.SiteOut)
def update_site(site_id: str, body: schemas.SiteIn, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    site = get_scoped(db, Site, site_id, scope)
    if body.client_id != site.client_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A site can't move to another client.")
    before = snapshot(site, SITE_FIELDS)
    for key, value in body.model_dump().items():
        setattr(site, key, value)
    record("site.update", f"Updated site {site.name} ({site.client.name})", entity_type="site", entity_id=site.id,
           entity_label=f"{site.client.name} · {site.name}", changes=diff(before, snapshot(site, SITE_FIELDS)))
    db.commit()
    db.refresh(site)
    return site_out(site)


# ---- Service schedules: the "currently required services" ----

def _open_jobs_by_schedule(db: Session, ids: list[str]) -> dict[str, Job]:
    jobs = db.scalars(select(Job).where(Job.schedule_id.in_(ids), Job.status.in_(OPEN_STATUSES))).unique()
    return {j.schedule_id: j for j in jobs}


@router.get("/schedules", response_model=list[schemas.ScheduleOut])
def list_schedules(
    site_id: str | None = None,
    client_id: str | None = None,
    due_within_days: int | None = Query(None, description="Only services due within N days (overdue included)"),
    region_id: str | None = Depends(region_param),
    scope: Scope = Depends(get_scope),
    db: Session = Depends(get_db),
):
    stmt = scope.apply(select(ServiceSchedule).join(Site), Site, region_id).where(ServiceSchedule.is_active.is_(True))
    if site_id:
        stmt = stmt.where(ServiceSchedule.site_id == site_id)
    if client_id:
        stmt = stmt.where(Site.client_id == client_id)
    if due_within_days is not None:
        stmt = stmt.where(ServiceSchedule.next_due_date <= date.today() + timedelta(days=due_within_days))
    schedules = db.scalars(stmt.order_by(ServiceSchedule.next_due_date)).unique().all()
    open_jobs = _open_jobs_by_schedule(db, [s.id for s in schedules])
    return [schedule_out(s, open_jobs.get(s.id)) for s in schedules]


@router.post("/schedules", response_model=schemas.ScheduleOut, status_code=201)
def create_schedule(body: schemas.ScheduleIn, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    get_scoped(db, Site, body.site_id, scope)
    schedule = ServiceSchedule(tenant_id=scope.tenant_id, **body.model_dump())
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    record("schedule.create", f"Added recurring {schedule.service_type.value.replace('_', ' ')} every "
           f"{schedule.interval_days} days at {schedule.site.name}", entity_type="schedule", entity_id=schedule.id,
           entity_label=f"{schedule.site.client.name} · {schedule.site.name}", changes=diff({}, snapshot(schedule, SCHEDULE_FIELDS)))
    return schedule_out(schedule, None)


@router.patch("/schedules/{schedule_id}", response_model=schemas.ScheduleOut)
def update_schedule(schedule_id: str, body: schemas.ScheduleUpdate, scope: Scope = Depends(get_scope), _=Depends(manager), db: Session = Depends(get_db)):
    schedule = db.get(ServiceSchedule, schedule_id)
    if schedule is None or schedule.tenant_id != scope.tenant_id or not scope.can_see_region(schedule.site.region_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    before = snapshot(schedule, SCHEDULE_FIELDS)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(schedule, key, value)
    record("schedule.update", f"Updated recurring service at {schedule.site.name}", entity_type="schedule",
           entity_id=schedule.id, entity_label=f"{schedule.site.client.name} · {schedule.site.name}",
           changes=diff(before, snapshot(schedule, SCHEDULE_FIELDS)))
    db.commit()
    return schedule_out(schedule, _open_jobs_by_schedule(db, [schedule.id]).get(schedule.id))

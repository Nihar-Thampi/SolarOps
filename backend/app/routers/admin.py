"""Regions and users. Admins manage both; everyone can list the people they can assign."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import schemas
from app.core.security import hash_password
from app.db import get_db
from app.deps import Scope, get_scope, require_roles
from app.models import Region, Role, User
from app.services.audit import diff, record, snapshot

router = APIRouter(tags=["admin"])
admin_only = require_roles(Role.admin)


# ---- Regions ----

@router.get("/regions", response_model=list[schemas.RegionOut])
def list_regions(scope: Scope = Depends(get_scope), db: Session = Depends(get_db)):
    stmt = select(Region).where(Region.tenant_id == scope.tenant_id).order_by(Region.name)
    if scope.region_ids is not None:
        stmt = stmt.where(Region.id.in_(scope.region_ids))
    return db.scalars(stmt).all()


@router.post("/regions", response_model=schemas.RegionOut, status_code=201)
def create_region(body: schemas.RegionIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    region = Region(tenant_id=user.tenant_id, name=body.name.strip(), code=body.code.strip().upper())
    db.add(region)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A region with that code already exists.")
    record("region.create", f"Created region {region.name} ({region.code})", entity_type="region",
           entity_id=region.id, entity_label=region.name, changes=diff({}, snapshot(region, ["name", "code"])))
    return region


@router.patch("/regions/{region_id}", response_model=schemas.RegionOut)
def update_region(region_id: str, body: schemas.RegionIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    region = db.get(Region, region_id)
    if region is None or region.tenant_id != user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    before = snapshot(region, ["name", "code"])
    region.name, region.code = body.name.strip(), body.code.strip().upper()
    record("region.update", f"Updated region {region.name}", entity_type="region", entity_id=region.id,
           entity_label=region.name, changes=diff(before, snapshot(region, ["name", "code"])))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A region with that code already exists.")
    return region


# ---- Users ----

def _regions_for(db: Session, tenant_id: str, ids: list[str]) -> list[Region]:
    regions = db.scalars(select(Region).where(Region.tenant_id == tenant_id, Region.id.in_(ids))).all()
    if len(regions) != len(set(ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown region.")
    return list(regions)


@router.get("/users", response_model=list[schemas.UserOut])
def list_users(
    role: Role | None = None,
    region_id: str | None = None,
    scope: Scope = Depends(get_scope),
    db: Session = Depends(get_db),
):
    """Admins see everyone; others see the people working in their regions (for assignment)."""
    stmt = select(User).where(User.tenant_id == scope.tenant_id).order_by(User.full_name)
    if role:
        stmt = stmt.where(User.role == role)
    if region_id:
        stmt = stmt.where(User.regions.any(id=region_id))
    if scope.region_ids is not None:
        stmt = stmt.where(User.is_active.is_(True), User.regions.any(Region.id.in_(scope.region_ids)))
    return db.scalars(stmt).all()


@router.post("/users", response_model=schemas.UserOut, status_code=201)
def create_user(body: schemas.UserIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    if not body.password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Set an initial password (8+ characters).")
    user = User(
        tenant_id=admin.tenant_id,
        email=body.email.lower(),
        full_name=body.full_name.strip(),
        role=body.role,
        phone=body.phone,
        skills=body.skills,
        password_hash=hash_password(body.password),
        regions=_regions_for(db, admin.tenant_id, body.region_ids),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That email is already in use.")
    record("user.create", f"Added {user.full_name} as {user.role.value}", entity_type="user", entity_id=user.id,
           entity_label=user.email, changes=diff({}, _user_view(user)))
    return user


@router.patch("/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: str, body: schemas.UserUpdate, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None or user.tenant_id != admin.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    if user.id == admin.id and (body.is_active is False or (body.role and body.role != Role.admin)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't remove your own admin access.")
    before = _user_view(user)
    data = body.model_dump(exclude_unset=True)
    password_changed = bool(data.get("password"))
    if "region_ids" in data:
        user.regions = _regions_for(db, admin.tenant_id, data.pop("region_ids") or [])
    if data.get("password"):
        user.password_hash = hash_password(data.pop("password"))
    data.pop("password", None)
    for key, value in data.items():
        setattr(user, key, value)
    changes = diff(before, _user_view(user))
    if password_changed:
        changes["password"] = ["(hidden)", "(changed)"]
    action = "user.deactivate" if changes.get("is_active") == [True, False] else "user.update"
    record(action, f"{'Deactivated' if action == 'user.deactivate' else 'Updated'} {user.full_name}",
           entity_type="user", entity_id=user.id, entity_label=user.email, changes=changes)
    db.commit()
    return user


def _user_view(user: User) -> dict:
    """What the audit trail shows of a user (never the password hash)."""
    return {
        **snapshot(user, ["full_name", "email", "role", "phone", "skills", "is_active"]),
        "regions": sorted(r.name for r in user.regions),
    }

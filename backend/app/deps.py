"""Authentication and tenant/region scoping.

Isolation rules, applied to every query through `Scope`:
- every row is filtered by the signed-in user's tenant;
- admins see all regions of their tenant;
- managers and technicians see only the regions assigned to them.
"""
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Select
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db import get_db
from app.models import Role, User
from app.services.audit import actor_from_user, set_actor

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please sign in again.")
    user = db.get(User, payload.get("sub"))
    if user is None or not user.is_active or user.tenant_id != payload.get("tid"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    set_actor(actor_from_user(user))  # who the audit trail attributes this request to
    return user


def require_roles(*roles: Role):
    def check(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission to do that.")
        return user

    return check


@dataclass
class Scope:
    user: User
    # None = every region in the tenant (admins).
    region_ids: set[str] | None

    @property
    def tenant_id(self) -> str:
        return self.user.tenant_id

    def can_see_region(self, region_id: str | None) -> bool:
        return self.region_ids is None or region_id in self.region_ids

    def apply(self, stmt: Select, model, region_filter: str | None = None) -> Select:
        """Restrict a query on `model` to this tenant and the visible regions.

        `region_filter` narrows further to one region (the UI's region picker); asking
        for a region you can't see returns nothing rather than an error.
        """
        stmt = stmt.where(model.tenant_id == self.tenant_id)
        if self.region_ids is not None:
            stmt = stmt.where(model.region_id.in_(self.region_ids))
        if region_filter:
            stmt = stmt.where(model.region_id == region_filter)
        return stmt


def get_scope(user: User = Depends(get_current_user)) -> Scope:
    if user.role == Role.admin:
        return Scope(user, None)
    return Scope(user, {r.id for r in user.regions})


def region_param(region_id: str | None = Query(None, description="Only this region")) -> str | None:
    return region_id or None


def get_scoped(db: Session, model, obj_id: str, scope: Scope):
    """Load one row the user is allowed to see, or 404 (never 403: don't reveal it exists)."""
    obj = db.get(model, obj_id)
    if obj is None or obj.tenant_id != scope.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    if hasattr(obj, "region_id") and not scope.can_see_region(obj.region_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return obj


MANAGE = (Role.admin, Role.manager)

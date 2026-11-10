from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas
from app.core.security import create_token, verify_password
from app.db import get_db
from app.deps import get_current_user
from app.models import Region, Role, User
from app.services.audit import actor_from_user, record, set_actor

router = APIRouter(prefix="/auth", tags=["auth"])


def me_payload(db: Session, user: User) -> dict:
    if user.role == Role.admin:
        regions = db.scalars(select(Region).where(Region.tenant_id == user.tenant_id).order_by(Region.name)).all()
    else:
        regions = sorted(user.regions, key=lambda r: r.name)
    return {"user": user, "tenant": user.tenant, "visible_regions": regions}


@router.post("/login", response_model=schemas.LoginOut)
def login(body: schemas.LoginIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        # Logged under the account's company when the email exists, so its admins see attempts on it.
        # The actor is whoever typed the email, not the account owner, so no user_id.
        set_actor({"email": email, "tenant_id": user.tenant_id if user else None})
        reason = "unknown email" if user is None else "account deactivated" if not user.is_active else "wrong password"
        record("auth.login_failed", f"Failed sign-in for {email} ({reason})", entity_type="user",
               entity_id=user.id if user else None, entity_label=email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password.")
    set_actor(actor_from_user(user))
    record("auth.login", "Signed in", entity_type="user", entity_id=user.id, entity_label=user.email)
    return {**me_payload(db, user), "token": create_token(user.id, user.tenant_id)}


@router.post("/logout", status_code=204)
def logout(user: User = Depends(get_current_user)):
    """Tokens are stateless; this exists so sign-outs appear in the audit trail."""
    record("auth.logout", "Signed out", entity_type="user", entity_id=user.id, entity_label=user.email)


@router.get("/me", response_model=schemas.MeOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return me_payload(db, user)

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.db import Base, engine
from app.routers import admin, ai, audit, auth, clients, dashboard, feedback, jobs
from app.services.audit import audit_middleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

settings = get_settings()

# Creates any missing tables. Fine for this project; a production deployment would run
# versioned migrations (e.g. Alembic) instead.
Base.metadata.create_all(engine)

app = FastAPI(title=f"{settings.app_name} API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

# Records every change, sign-in and refused request (see app/services/audit.py).
app.middleware("http")(audit_middleware)

for module in (auth, admin, clients, jobs, feedback, ai, dashboard, audit):
    app.include_router(module.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}

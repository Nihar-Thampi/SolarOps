# SolarOps API. Python packages live in the image, not in a synced virtualenv.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# The SQLite database is backend/data/solarops.db, mounted from the project folder.
EXPOSE 8000

# Seed the demo data when there is no database yet, then serve.
CMD ["sh", "-c", "if [ ! -f data/solarops.db ] && [ \"${SEED_ON_START:-1}\" = 1 ]; then python seed.py; fi && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]

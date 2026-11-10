import os
import tempfile

import pytest

# Point the app at a throwaway database before anything imports it.
_db_dir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_db_dir}/test.db"
os.environ["AI_PROVIDER"] = "demo"

from fastapi.testclient import TestClient  # noqa: E402

import seed  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = seed.DEMO_PASSWORD


@pytest.fixture(scope="session", autouse=True)
def demo_data():
    seed.main()


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture(scope="session")
def login(client):
    cache = {}

    def _login(email: str) -> dict:
        if email not in cache:
            r = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
            assert r.status_code == 200, r.text
            body = r.json()
            cache[email] = {"headers": {"Authorization": f"Bearer {body['token']}"}, **body}
        return cache[email]

    return _login

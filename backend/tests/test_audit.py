import pytest
from sqlalchemy import text
from sqlalchemy.exc import DatabaseError

from app.db import engine

ADMIN = "admin@sunpeak.demo"
PRIYA = "priya@sunpeak.demo"
MARCO = "marco@sunpeak.demo"
OTHER_ADMIN = "admin@brightgrid.demo"


def h(login, email):
    return login(email)["headers"]


def latest(client, login, **params):
    r = client.get("/api/audit", headers=h(login, ADMIN), params={"limit": 5, **params})
    assert r.status_code == 200
    return r.json()["items"]


def test_assignment_is_recorded_with_actor_and_change(client, login):
    job = client.get("/api/jobs?assignee=unassigned", headers=h(login, PRIYA)).json()["items"][0]
    tech = client.get(f"/api/jobs/{job['id']}", headers=h(login, PRIYA)).json()["suggested_assignees"][0]
    client.post(f"/api/jobs/{job['id']}/assign", headers=h(login, PRIYA), json={"assignee_id": tech["id"]})

    entry = latest(client, login, action="job.assign", entity_id=job["id"])[0]
    assert entry["user_email"] == PRIYA and entry["user_role"] == "manager"
    assert entry["changes"] == {"assignee": [None, tech["full_name"]]}
    assert entry["status_code"] == 200 and entry["method"] == "POST"
    assert entry["entity_label"].startswith(job["number"])


def test_failed_sign_in_is_recorded_for_that_company(client, login):
    client.post("/api/auth/login", json={"email": MARCO, "password": "not-the-password"})
    entry = latest(client, login, action="auth.login_failed")[0]
    assert entry["summary"] == f"Failed sign-in for {MARCO} (wrong password)"
    assert entry["status_code"] == 401 and entry["user_id"] is None


@pytest.mark.parametrize("email", [MARCO, PRIYA])
def test_only_admins_can_read_the_audit_trail(client, login, email):
    for path in ("/api/audit", "/api/audit/verify", "/api/audit/export", "/api/audit/facets"):
        assert client.get(path, headers=h(login, email)).status_code == 403
    # ...and the attempt itself is on record, attributed to them.
    denied = latest(client, login, action="access.denied", user_id=login(email)["user"]["id"])
    assert denied and denied[0]["status_code"] == 403


def test_each_company_sees_only_its_own_trail(client, login):
    sunpeak_ids = {e["id"] for e in client.get("/api/audit?limit=200", headers=h(login, ADMIN)).json()["items"]}
    brightgrid = client.get("/api/audit?limit=200", headers=h(login, OTHER_ADMIN)).json()["items"]
    assert brightgrid and not sunpeak_ids & {e["id"] for e in brightgrid}
    assert all(e["user_email"] is None or e["user_email"].endswith("brightgrid.demo") for e in brightgrid)


def test_password_changes_are_noted_but_never_shown(client, login):
    marco = login(MARCO)["user"]
    client.patch(f"/api/users/{marco['id']}", headers=h(login, ADMIN), json={"password": "a-new-password-123"})
    entry = latest(client, login, action="user.update", entity_id=marco["id"])[0]
    assert entry["changes"]["password"] == ["(hidden)", "(changed)"]
    assert "a-new-password-123" not in str(entry) and "$2b$" not in str(entry)
    client.patch(f"/api/users/{marco['id']}", headers=h(login, ADMIN), json={"password": "SolarOps!2026"})


def test_export_is_csv_and_is_itself_recorded(client, login):
    r = client.get("/api/audit/export", headers=h(login, ADMIN))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.text.splitlines()[0].startswith("id,time_utc,user,role,action")
    assert latest(client, login, action="audit.export")


def test_database_rejects_edits_and_deletes():
    with engine.connect() as conn:
        with pytest.raises(DatabaseError, match="append-only"):
            conn.execute(text("UPDATE audit_log SET summary = 'nothing happened' WHERE id = 1"))
        with pytest.raises(DatabaseError, match="append-only"):
            conn.execute(text("DELETE FROM audit_log WHERE id = 1"))


def test_tampering_is_detected(client, login):
    """Last on purpose: it breaks the chain to show verification catches it."""
    assert client.get("/api/audit/verify", headers=h(login, ADMIN)).json()["valid"] is True

    target = latest(client, login, action="job.assign")[0]["id"]
    with engine.begin() as conn:  # someone with direct database access removes the guard...
        conn.execute(text("DROP TRIGGER audit_log_no_update"))
        conn.execute(text("UPDATE audit_log SET summary = 'Nothing to see here' WHERE id = :id"), {"id": target})

    result = client.get("/api/audit/verify", headers=h(login, ADMIN)).json()
    assert result["valid"] is False and result["broken_at_id"] == target

from datetime import date

import pytest

from app.ai import client as ai_client
from app.db import SessionLocal
from app.models import AIRequest, ServiceSchedule

ADMIN = "admin@sunpeak.demo"
PRIYA = "priya@sunpeak.demo"  # manager: Metro + North Coast
DANIEL = "daniel@sunpeak.demo"  # manager: Central Valley + Highlands
MARCO = "marco@sunpeak.demo"  # technician: Metro
OTHER_TENANT = "admin@brightgrid.demo"


def h(login, email):
    return login(email)["headers"]


def test_wrong_password_is_rejected(client):
    r = client.post("/api/auth/login", json={"email": ADMIN, "password": "nope-nope"})
    assert r.status_code == 401


def test_requests_without_token_are_rejected(client):
    assert client.get("/api/jobs").status_code == 401


# ---- Multi-tenant and region isolation ----

def test_other_tenant_cannot_see_jobs_or_clients(client, login):
    job = client.get("/api/jobs", headers=h(login, ADMIN)).json()["items"][0]
    assert client.get(f"/api/jobs/{job['id']}", headers=h(login, OTHER_TENANT)).status_code == 404
    their_clients = client.get("/api/clients?limit=200", headers=h(login, OTHER_TENANT)).json()["items"]
    assert job["client_id"] not in {c["id"] for c in their_clients}


def test_manager_only_sees_their_regions(client, login):
    me = login(PRIYA)
    allowed = {r["id"] for r in me["visible_regions"]}
    assert {r["name"] for r in me["visible_regions"]} == {"Metro", "North Coast"}
    jobs = client.get("/api/jobs?view=all&limit=200", headers=me["headers"]).json()["items"]
    assert jobs and all(j["region"]["id"] in allowed for j in jobs)

    other_region = next(r for r in login(ADMIN)["visible_regions"] if r["id"] not in allowed)
    r = client.get(f"/api/jobs?region_id={other_region['id']}", headers=me["headers"])
    assert r.json()["total"] == 0  # asking for a hidden region returns nothing, not someone else's data

    hidden = client.get(f"/api/jobs?region_id={other_region['id']}", headers=h(login, ADMIN)).json()["items"][0]
    assert client.get(f"/api/jobs/{hidden['id']}", headers=me["headers"]).status_code == 404


# ---- Assignment ----

def _unassigned_job(client, headers):
    jobs = client.get("/api/jobs?assignee=unassigned", headers=headers).json()["items"]
    assert jobs, "seed should leave unassigned jobs"
    return jobs[0]


def test_manager_assigns_and_unassigns(client, login):
    job = _unassigned_job(client, h(login, PRIYA))
    detail = client.get(f"/api/jobs/{job['id']}", headers=h(login, PRIYA)).json()
    tech = detail["suggested_assignees"][0]

    r = client.post(f"/api/jobs/{job['id']}/assign", headers=h(login, PRIYA), json={"assignee_id": tech["id"]})
    assert r.status_code == 200 and r.json()["assignee"]["id"] == tech["id"]

    r = client.post(f"/api/jobs/{job['id']}/assign", headers=h(login, PRIYA), json={"assignee_id": None})
    assert r.status_code == 200 and r.json()["assignee"] is None
    assert r.json()["events"][0]["message"] == "Marked unassigned"


def test_cannot_assign_technician_from_another_region(client, login):
    job = _unassigned_job(client, h(login, PRIYA))
    users = client.get("/api/users?role=technician", headers=h(login, ADMIN)).json()
    outsider = next(u for u in users if job["region"]["id"] not in {r["id"] for r in u["regions"]})
    r = client.post(f"/api/jobs/{job['id']}/assign", headers=h(login, PRIYA), json={"assignee_id": outsider["id"]})
    assert r.status_code == 400


def test_technician_can_claim_but_not_assign_others(client, login):
    marco = login(MARCO)
    job = _unassigned_job(client, marco["headers"])
    users = client.get("/api/users?role=technician", headers=h(login, ADMIN)).json()
    colleague = next(u for u in users if u["id"] != marco["user"]["id"])

    r = client.post(f"/api/jobs/{job['id']}/assign", headers=marco["headers"], json={"assignee_id": colleague["id"]})
    assert r.status_code == 403
    r = client.post(f"/api/jobs/{job['id']}/assign", headers=marco["headers"], json={"assignee_id": marco["user"]["id"]})
    assert r.status_code == 200 and r.json()["assignee"]["id"] == marco["user"]["id"]


def test_technician_cannot_create_jobs_or_work_others_jobs(client, login):
    marco = login(MARCO)
    jobs = client.get("/api/jobs?limit=200", headers=marco["headers"]).json()["items"]
    others = [j for j in jobs if j["assignee"] and j["assignee"]["id"] != marco["user"]["id"]]
    if others:
        r = client.post(f"/api/jobs/{others[0]['id']}/status", headers=marco["headers"], json={"status": "in_progress"})
        assert r.status_code == 403
    r = client.post(
        "/api/jobs", headers=marco["headers"],
        json={"client_id": jobs[0]["client_id"], "title": "x", "service_type": "panel_cleaning"},
    )
    assert r.status_code == 403


# ---- Job lifecycle, reports, schedules, feedback ----

def test_schedule_job_report_and_feedback_flow(client, login):
    headers = h(login, DANIEL)
    due = client.get("/api/schedules?due_within_days=30", headers=headers).json()
    schedule = next(s for s in due if not s["open_job_id"])

    job = client.post(f"/api/schedules/{schedule['id']}/job", headers=headers).json()
    assert job["source"] == "schedule" and job["schedule_id"] == schedule["id"]
    assert client.post(f"/api/schedules/{schedule['id']}/job", headers=headers).status_code == 409

    # Can't complete without a final report.
    r = client.post(f"/api/jobs/{job['id']}/status", headers=headers, json={"status": "completed"})
    assert r.status_code == 400

    r = client.post(
        f"/api/jobs/{job['id']}/report/draft", headers=headers,
        json={"technician_notes": "Cleaned all panels. Found 2 cracked mods. Recommend replacing them next visit.",
              "readings": {"Output after (kW)": "5.2"}},
    )
    report = r.json()["report"]
    assert r.status_code == 200 and report["ai_generated"] and report["status"] == "draft"
    assert any("crack" in f.lower() for f in report["findings"])
    assert report["recommendations"]

    r = client.post(f"/api/jobs/{job['id']}/report/finalize", headers=headers)
    done = r.json()
    assert done["status"] == "completed" and done["report"]["status"] == "final" and done["feedback_url"]

    with SessionLocal() as db:
        rolled = db.get(ServiceSchedule, schedule["id"])
        assert rolled.last_done_date == date.today()
        assert (rolled.next_due_date - rolled.last_done_date).days == rolled.interval_days

    token = done["feedback_url"].rsplit("/", 1)[1]
    assert client.get(f"/api/public/feedback/{token}").json()["already_submitted"] is False
    r = client.post(f"/api/public/feedback/{token}", json={"rating": 2, "comment": "Arrived late and left a mess."})
    assert r.status_code == 201
    assert client.post(f"/api/public/feedback/{token}", json={"rating": 5}).status_code == 409
    fb = client.get(f"/api/jobs/{job['id']}", headers=headers).json()["feedback"]
    assert fb["sentiment"] == "negative" and {"Punctuality", "Cleanliness"} <= set(fb["themes"])


def test_bad_feedback_token(client):
    assert client.get("/api/public/feedback/not-a-token").status_code == 404


# ---- AI ----

def test_intake_drafts_a_job_and_logs_the_call(client, login):
    headers = h(login, PRIYA)
    r = client.post("/api/ai/intake", headers=headers,
                    json={"text": "There is a burning smell near the isolator and sparks when it rains!"})
    draft = r.json()
    assert r.status_code == 200
    assert draft["service_type"] == "electrical_safety" and draft["priority"] == "urgent"
    log = client.get("/api/ai/requests?feature=intake", headers=headers).json()
    assert log["total"] >= 1 and log["items"][0]["provider"] == "demo"


def test_intake_matches_existing_client_by_email(client, login):
    headers = h(login, PRIYA)
    known = client.get("/api/clients", headers=headers).json()["items"][0]
    r = client.post("/api/ai/intake", headers=headers,
                    json={"text": f"Hello, panels are filthy after the dust storm. From {known['email']}"})
    assert r.json()["client_id"] == known["id"]


def test_model_chosen_ids_outside_scope_are_dropped():
    from app.ai.intake import _validate_ids

    data = {"client_id": "someone-elses-client", "site_id": "x"}
    _validate_ids(data, [])
    assert data["client_id"] is None and data["site_id"] is None


def test_local_model_failure_falls_back_to_rules_and_is_logged(monkeypatch, login):
    settings = ai_client.get_settings()
    monkeypatch.setattr(settings, "ai_provider", "local")

    def boom(*args, **kwargs):
        raise ai_client.AIError("simulated outage")

    monkeypatch.setattr(ai_client, "_call_local", boom)
    tenant_id = login(ADMIN)["tenant"]["id"]
    with SessionLocal() as db:
        result = ai_client.run_json(
            db=db, tenant_id=tenant_id, user_id=None, feature="test", system="s", prompt="p",
            schema={}, demo=lambda: {"ok": True},
        )
        db.commit()
        assert result.provider == "demo-fallback" and result.data == {"ok": True}
        row = db.query(AIRequest).filter_by(feature="test").one()
        assert row.success is False and "simulated outage" in row.error


def test_local_model_call_sends_schema_and_context(monkeypatch):
    sent = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"message": {"content": '{"answer": "yes"}'}, "done_reason": "stop",
                    "prompt_eval_count": 12, "eval_count": 5}

    def fake_post(url, json, timeout):
        sent.update(url=url, body=json)
        return FakeResponse()

    monkeypatch.setattr(ai_client.httpx, "post", fake_post)
    schema = ai_client.obj({"answer": ai_client.STR})
    data, tokens_in, tokens_out = ai_client._call_local("system", "prompt", schema, 500)
    settings = ai_client.get_settings()
    assert data == {"answer": "yes"} and (tokens_in, tokens_out) == (12, 5)
    assert sent["url"].endswith("/api/chat")
    assert sent["body"]["format"] == schema and sent["body"]["model"] == settings.local_llm_model
    assert sent["body"]["options"]["num_ctx"] == settings.local_llm_context
    assert sent["body"]["options"]["num_predict"] == 500


def test_cut_off_answer_is_an_error(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return {"message": {"content": '{"answer": "ye'}, "done_reason": "length"}

    monkeypatch.setattr(ai_client.httpx, "post", lambda *a, **k: FakeResponse())
    with pytest.raises(ai_client.AIError):
        ai_client._call_local("system", "prompt", {}, 500)


def test_auto_mode_uses_rules_when_no_local_model(monkeypatch):
    settings = ai_client.get_settings()
    monkeypatch.setattr(settings, "ai_provider", "auto")
    monkeypatch.setattr(ai_client, "local_model_available", lambda: (False, "not running"))
    assert ai_client.provider_status() == ("demo", ai_client.DEMO_MODEL)
    monkeypatch.setattr(ai_client, "local_model_available", lambda: (True, ""))
    assert ai_client.provider_status() == ("local", settings.local_llm_model)


@pytest.mark.parametrize("email", [ADMIN, PRIYA, MARCO])
def test_dashboard_loads_for_every_role(client, login, email):
    r = client.get("/api/dashboard", headers=h(login, email))
    assert r.status_code == 200
    body = r.json()
    assert body["kpis"]["open_jobs"] >= body["kpis"]["unassigned_jobs"]
    assert len(body["weekly"]) == 12

"""Reset the database and fill it with realistic demo data.

    python seed.py

Two tenants show the multi-tenant isolation: SunPeak (4 regions, the main demo) and
BrightGrid (2 regions). Data is generated from a fixed random seed, so every run
produces the same records. All demo users share the password below.
"""
import random
import secrets
from datetime import date, datetime, timedelta, timezone

from app.ai.feedback import _demo_one
from app.services.audit import append as append_audit
from app.core.security import hash_password
from app.db import Base, SessionLocal, engine
from app.models import (
    AuditLog,
    Client,
    ClientType,
    Feedback,
    Job,
    JobEvent,
    JobSource,
    JobStatus,
    Priority,
    Region,
    ReportStatus,
    Role,
    ServiceReport,
    ServiceSchedule,
    ServiceType,
    Site,
    Tenant,
    User,
)

DEMO_PASSWORD = "SolarOps!2026"
rng = random.Random(42)
NOW = datetime.now(timezone.utc).replace(microsecond=0)
TODAY = NOW.date()

PANEL_MODELS = ["Helion HX-410 Mono", "Brightcell BC-395", "SunForge SF-450 Bifacial", "Lumen LM-380"]
INVERTERS = ["VoltaGrid VG-5000", "VoltaGrid VG-8000", "Inverta IX-10K", "SolisCore SC-25K Three-phase", "Inverta IX-60K Central"]

STREETS = ["Lake Road", "Maple Avenue", "Hillcrest Drive", "Orchard Lane", "Station Road", "Harbour Way", "Cedar Street",
           "Riverside Drive", "Kingfisher Close", "Mill Lane", "Park View", "Sunset Boulevard", "Granite Way",
           "Oak Ridge Road", "Willow Crescent", "Meadow Lane", "Industrial Estate Road", "Quarry Road"]
FIRST = ["Ava", "Liam", "Maya", "Noah", "Zara", "Ethan", "Leah", "Ravi", "Sofia", "Omar", "Isla", "Arjun", "Chloe",
         "Daniel", "Hana", "Lucas", "Mei", "Kofi", "Elena", "Sam", "Nadia", "Tom", "Asha", "Ben"]
LAST = ["Mehta", "Collins", "Okafor", "Fischer", "Reyes", "Novak", "Patel", "Hughes", "Tanaka", "Silva", "Brennan",
        "Kowalski", "Dubois", "Lindqvist", "Haddad", "Chen", "Moreau", "Walsh", "Iyer", "Costa"]
BUSINESSES = ["Greenfield Primary School", "Harbourview Logistics", "Northgate Medical Centre", "Crestline Cold Storage",
              "Riverside Community Hall", "Summit Fitness Club", "Oakridge Dairy Farm", "Meridian Office Park",
              "Bluewater Hotel", "Pinecrest Retail Centre", "Valley Fresh Packhouse", "St. Anne's Church",
              "Hilltop Vineyards", "Copperleaf Apartments", "Westbrook Auto Works", "Lakeshore Sports Arena"]
UTILITIES = ["Ridgeback Solar Farm", "Dry Creek Solar Park", "Eastplain Community Solar"]


def days_ago(n: float) -> datetime:
    return NOW - timedelta(days=n)


# ---------------------------------------------------------------- reports & feedback text

REPORT_TEMPLATES = {
    ServiceType.panel_cleaning: dict(
        notes="Arrived 9am. Heavy dust + bird droppings on north rows. Cleaned all {panels} panels with DI water + soft brush. "
              "Output before {before} kW, after {after} kW. Noticed 2 panels w/ minor frame scratches, no cracks. "
              "Recommend cleaning again in 3 months due to nearby construction.",
        summary="All {panels} panels were cleaned to remove heavy dust and bird droppings. Output rose from {before} kW to {after} kW "
                "straight after cleaning. Two panels have minor cosmetic frame scratches but no damage.",
        work=["Cleaned all {panels} panels with deionised water and a soft brush", "Measured system output before and after cleaning"],
        findings=["Heavy dust and bird droppings on the north-facing rows", "Minor cosmetic scratches on two panel frames (no cracks)"],
        recs=["Book the next cleaning in 3 months because of dust from nearby construction"],
        readings={"Output before (kW)": "{before}", "Output after (kW)": "{after}"},
    ),
    ServiceType.inverter_service: dict(
        notes="Inv showing error E-27 (grid voltage high) intermittently. Checked AC terminals, 1 loose, re-torqued. Updated firmware "
              "to v4.2. Cleaned fan filter, was clogged. Ran for 30 min no errors. Customer should keep an eye on app for E-27.",
        summary="The inverter was logging intermittent grid-voltage errors (E-27). A loose AC terminal was tightened, the firmware was "
                "updated and the clogged cooling filter was cleaned. The inverter ran error-free during a 30-minute test.",
        work=["Re-torqued a loose AC terminal", "Updated inverter firmware to v4.2", "Cleaned the clogged cooling fan filter",
              "Ran a 30-minute test with no errors"],
        findings=["Intermittent E-27 grid voltage error in the inverter log", "One loose AC terminal", "Cooling fan filter clogged with dust"],
        recs=["Watch the monitoring app for any return of the E-27 error and report it"],
        readings={"Inverter output (kW)": "{after}", "DC input voltage (V)": "{voltage}"},
    ),
    ServiceType.thermal_inspection: dict(
        notes="Thermal scan of all strings at 11:30, irradiance {irr} W/m2. Found 1 hotspot on string 3 panel 14, approx 18C above "
              "neighbours, likely cell crack. 1 bypass diode warm on string 5. Rest normal. Recommend replacing panel 3-14 under warranty.",
        summary="A thermal scan of every string found one panel with a hot spot about 18°C above its neighbours, most likely a cracked "
                "cell, and one warm bypass diode. All other panels were within normal range.",
        work=["Thermal-imaged every string under {irr} W/m² sunlight", "Logged temperatures panel by panel"],
        findings=["Hot spot on string 3, panel 14, about 18°C above neighbouring panels (likely a cracked cell)",
                  "Warm bypass diode on string 5"],
        recs=["Replace panel 14 on string 3 under the manufacturer's warranty", "Re-check the string 5 bypass diode at the next visit"],
        readings={"Irradiance (W/m²)": "{irr}", "Max temperature delta (°C)": "18"},
    ),
    ServiceType.electrical_safety: dict(
        notes="Full electrical safety check. Tested isolators, RCD trip time 22ms ok. Insulation resistance > 40 MOhm all strings. "
              "Found DC isolator cover cracked, replaced. Earth bonding ok. Labels faded on combiner box, relabelled.",
        summary="The electrical safety check passed. All protective devices and insulation tests were within limits. A cracked DC isolator "
                "cover was replaced and faded warning labels were renewed.",
        work=["Tested isolators and RCD (trip time 22 ms)", "Measured insulation resistance on every string",
              "Replaced a cracked DC isolator cover", "Relabelled the combiner box"],
        findings=["DC isolator cover was cracked", "Warning labels on the combiner box had faded"],
        recs=[],
        readings={"RCD trip time (ms)": "22", "Insulation resistance (MΩ)": ">40"},
    ),
    ServiceType.vegetation_control: dict(
        notes="Trimmed 3 tree branches shading east array from approx 2pm. Cleared weeds around ground mount + cable trench. "
              "Removed debris from gutters near array. Shading should be gone now. Suggest trimming again next spring.",
        summary="Tree branches that shaded the east array from early afternoon were trimmed, and weeds and debris were cleared around "
                "the mounting and cable trench. The array should no longer be shaded in the afternoon.",
        work=["Trimmed three branches shading the east array", "Cleared weeds around the ground mount and cable trench",
              "Removed debris from gutters next to the array"],
        findings=["Afternoon shading on the east array from about 2 pm"],
        recs=["Trim the trees again next spring before the growing season"],
        readings={},
    ),
    ServiceType.fault_repair: dict(
        notes="System producing 0 kW. String 2 fuse blown in combiner box. Found MC4 connector melted on string 2 due to poor crimp. "
              "Replaced connector pair + fuse. System back online, output {after} kW. Checked other strings ok.",
        summary="The system had stopped producing power because a string fuse had blown after a connector overheated. The melted "
                "connector pair and the fuse were replaced and the system is producing {after} kW again.",
        work=["Replaced the blown string 2 fuse", "Replaced a melted MC4 connector pair on string 2", "Checked all other strings"],
        findings=["String 2 fuse blown in the combiner box", "MC4 connector on string 2 melted from a poorly crimped joint"],
        recs=["Inspect the remaining connectors at the next scheduled service"],
        readings={"Output after repair (kW)": "{after}"},
    ),
    ServiceType.monitoring_check: dict(
        notes="Customer app offline since last week. Wifi dongle lost connection after router change. Re-paired dongle with new "
              "network, data uploading again. Checked history, no production gaps in inverter memory.",
        summary="Monitoring had stopped because the Wi-Fi dongle lost its connection after the customer changed their router. It was "
                "reconnected and data is uploading again; no production data was lost.",
        work=["Reconnected the monitoring Wi-Fi dongle to the new router", "Confirmed data is uploading to the app"],
        findings=["Monitoring dongle disconnected after a router change"],
        recs=["Let us know before changing the Wi-Fi network so monitoring can be updated"],
        readings={},
    ),
    ServiceType.installation_audit: dict(
        notes="Audit for new owner/insurance. Checked mounting, roof penetrations sealed, cabling routed + clipped. Documented "
              "serial numbers. System {kw} kW performing normally. One roof bracket bolt missing, replaced.",
        summary="The installation was audited for the new owner and insurer. Mounting, roof seals and cabling meet standard; one missing "
                "bracket bolt was replaced. The {kw} kW system is performing normally.",
        work=["Inspected mounting, roof penetrations and cable routing", "Recorded equipment serial numbers", "Replaced a missing roof bracket bolt"],
        findings=["One roof bracket bolt was missing"],
        recs=[],
        readings={"System size (kW)": "{kw}"},
    ),
}

POSITIVE_COMMENTS = [
    "Technician arrived on time and explained everything clearly. Very professional.",
    "Quick and thorough job, output is back to normal. Thank you!",
    "Really happy with the service. The team was friendly and left the site clean.",
    "Great communication before the visit and a clear report afterwards.",
    "Fixed the inverter fault in under an hour. Excellent work.",
    "Polite, careful and tidy. Panels look brand new after cleaning.",
    "Same day response to our outage, very impressed with the speed of service.",
    "Explained the thermal scan results in plain language. Helpful and professional.",
    "Professional team, good value for money. Will recommend to neighbours.",
    "Our production numbers are up since the visit. Great job.",
]
NEUTRAL_COMMENTS = [
    "Job done, though the technician arrived a bit later than the window we were given.",
    "Work seems fine. Would have liked a call when they were on the way.",
    "Okay service. The invoice was higher than I expected but the work was good.",
    "",
    "Took two visits to finish but it is working now.",
]
NEGATIVE_COMMENTS = [
    "Technician was over two hours late and nobody called to let us know.",
    "The same inverter error came back three days later. Still waiting for someone to return.",
    "Left a mess of cable offcuts on the roof. Not happy.",
    "Had to reschedule twice because no one confirmed the appointment.",
    "Overpriced for a cleaning visit, and the panels still had streaks.",
    "No one explained what was done or why the bill was so high.",
]


def report_for(job: Job, site: Site | None) -> ServiceReport:
    t = REPORT_TEMPLATES[job.service_type]
    kw = site.system_size_kw if site and site.system_size_kw else 6.0
    values = dict(
        panels=site.panel_count if site and site.panel_count else 16,
        before=round(kw * rng.uniform(0.55, 0.7), 1),
        after=round(kw * rng.uniform(0.78, 0.9), 1),
        voltage=rng.randint(340, 610),
        irr=rng.randint(720, 950),
        kw=kw,
    )
    fill = lambda s: s.format(**values)  # noqa: E731
    return ServiceReport(
        tenant_id=job.tenant_id,
        technician_notes=fill(t["notes"]),
        summary=fill(t["summary"]),
        work_performed=[fill(x) for x in t["work"]],
        findings=[fill(x) for x in t["findings"]],
        recommendations=[fill(x) for x in t["recs"]],
        readings={k: fill(v) for k, v in t["readings"].items()},
        status=ReportStatus.final,
        ai_generated=rng.random() < 0.7,
        finalized_at=job.completed_at,
        author_id=job.assignee_id,
        created_at=job.completed_at,
        updated_at=job.completed_at,
    )


# ---------------------------------------------------------------- open-job descriptions

OPEN_JOB_TEXT = {
    ServiceType.fault_repair: [("System showing zero output since this morning", Priority.high),
                               ("Cracked panel after hailstorm", Priority.medium),
                               ("Loose mounting rail rattling in wind", Priority.medium)],
    ServiceType.inverter_service: [("Inverter beeping with fault code E-31", Priority.medium),
                                   ("Inverter display blank, no power reading", Priority.high)],
    ServiceType.electrical_safety: [("Burning smell near the DC isolator", Priority.urgent),
                                    ("Breaker tripping every afternoon", Priority.high)],
    ServiceType.panel_cleaning: [("Panels covered in dust after nearby roadworks", Priority.low),
                                 ("Bird droppings on several panels", Priority.low)],
    ServiceType.vegetation_control: [("Neighbour's tree now shading the west array", Priority.medium)],
    ServiceType.thermal_inspection: [("Annual thermal inspection", Priority.low),
                                     ("Possible hot spot visible as brown mark on a panel", Priority.medium)],
    ServiceType.monitoring_check: [("Monitoring app offline for a week", Priority.low),
                                   ("App shows half the usual production", Priority.medium)],
    ServiceType.installation_audit: [("Insurance audit for new homeowner", Priority.low)],
}


# ---------------------------------------------------------------- build

def build_tenant(db, name, slug, region_specs, staff, n_clients, n_history, n_open):
    tenant = Tenant(name=name, slug=slug)
    db.add(tenant)
    db.flush()
    regions = [Region(tenant_id=tenant.id, name=n, code=c) for n, c in region_specs]
    db.add_all(regions)
    db.flush()
    by_code = {r.code: r for r in regions}

    pw = hash_password(DEMO_PASSWORD)
    users = []
    for full_name, email, role, codes, skills in staff:
        u = User(
            tenant_id=tenant.id, email=email, full_name=full_name, role=role, password_hash=pw,
            phone=f"+1 555 {rng.randint(100, 999)} {rng.randint(1000, 9999)}", skills=skills,
            regions=[by_code[c] for c in codes],
        )
        users.append(u)
    db.add_all(users)
    db.flush()
    techs = [u for u in users if u.role == Role.technician]
    managers = [u for u in users if u.role != Role.technician]

    # Clients and sites.
    clients, sites = [], []
    businesses = BUSINESSES[:]
    rng.shuffle(businesses)
    for i in range(n_clients):
        region = regions[i % len(regions)]
        kind = rng.choices([ClientType.residential, ClientType.commercial, ClientType.utility], [0.62, 0.32, 0.06])[0]
        street = f"{rng.randint(2, 480)} {rng.choice(STREETS)}"
        if kind == ClientType.residential:
            person = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
            cname, contact = f"{person.split()[1]} Residence ({person.split()[0]})", person
        elif kind == ClientType.commercial and businesses:
            cname, contact = businesses.pop(), f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        else:
            kind = ClientType.utility
            cname, contact = f"{rng.choice(UTILITIES)} {region.code}", f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        email_name = contact.lower().replace(" ", ".")
        client = Client(
            tenant_id=tenant.id, region_id=region.id, region=region, name=cname, client_type=kind,
            contact_name=contact, email=f"{email_name}@example.com",
            phone=f"+1 555 {rng.randint(100, 999)} {rng.randint(1000, 9999)}",
            address=f"{street}, {region.name}", created_at=days_ago(rng.randint(200, 900)),
        )
        clients.append(client)
        n_sites = 1 if kind == ClientType.residential else rng.randint(1, 3)
        for s in range(n_sites):
            if kind == ClientType.residential:
                kw, panels, inv, sname = round(rng.uniform(4, 12), 1), 0, rng.choice(INVERTERS[:3]), "Rooftop array"
            elif kind == ClientType.commercial:
                kw, panels, inv, sname = round(rng.uniform(30, 250)), 0, rng.choice(INVERTERS[2:4]), ["Main roof", "Car park canopy", "Warehouse roof"][s]
            else:
                kw, panels, inv, sname = round(rng.uniform(800, 4000)), 0, INVERTERS[4], ["Block A", "Block B", "Block C"][s]
            panels = int(kw * 1000 / 410)
            site = Site(
                tenant_id=tenant.id, client=client, region_id=region.id, region=region, name=sname,
                address=client.address if s == 0 else f"{rng.randint(2, 480)} {rng.choice(STREETS)}, {region.name}",
                system_size_kw=kw, panel_count=panels, panel_model=rng.choice(PANEL_MODELS), inverter_model=inv,
                has_battery=kind == ClientType.residential and rng.random() < 0.4,
                install_date=TODAY - timedelta(days=rng.randint(300, 2600)),
            )
            sites.append(site)
    db.add_all(clients)
    db.flush()

    # Recurring services per site.
    schedules = []
    for site in sites:
        plan = [(ServiceType.panel_cleaning, rng.choice([90, 120, 180])), (ServiceType.inverter_service, 365),
                (ServiceType.electrical_safety, 365)]
        if site.client.client_type != ClientType.residential:
            plan.append((ServiceType.thermal_inspection, 365))
        if rng.random() < 0.35:
            plan.append((ServiceType.vegetation_control, 120))
        for service, interval in plan:
            due = TODAY + timedelta(days=rng.randint(-10, interval))
            schedules.append(ServiceSchedule(
                tenant_id=tenant.id, site=site, service_type=service, interval_days=interval,
                next_due_date=due, last_done_date=due - timedelta(days=interval),
            ))
    db.add_all(schedules)
    db.flush()

    number = tenant.next_job_number

    def new_job(site, service, title, description, priority, created, source=JobSource.manual, schedule=None):
        nonlocal number
        job = Job(
            tenant_id=tenant.id, number=f"JOB-{number}", region_id=site.region_id, region=site.region,
            client_id=site.client_id, client=site.client, site_id=site.id, site=site, title=title,
            description=description, service_type=service, priority=priority, source=source,
            schedule_id=schedule.id if schedule else None, created_by_id=rng.choice(managers).id,
            created_at=created, updated_at=created,
        )
        number += 1
        db.add(job)
        db.add(JobEvent(job=job, user_id=job.created_by_id, kind="created", created_at=created,
                        message="Job created" + (" by AI intake" if source == JobSource.ai_intake else
                                                 " from a service schedule" if source == JobSource.schedule else "")))
        return job

    def tech_for(site, service):
        local = [t for t in techs if site.region_id in {r.id for r in t.regions}]
        skilled = [t for t in local if service.value in t.skills] or local or techs
        return rng.choice(skilled)

    # History: completed jobs over the last ~6 months.
    completed = []
    for _ in range(n_history):
        site = rng.choice(sites)
        service = rng.choices(list(REPORT_TEMPLATES), [26, 16, 10, 12, 7, 16, 8, 5])[0]
        created = days_ago(rng.uniform(4, 182))
        title = f"{service.value.replace('_', ' ').capitalize()} – {site.client.name}"
        source = rng.choices([JobSource.manual, JobSource.ai_intake], [0.6, 0.4])[0]
        job = new_job(site, service, title, None, rng.choice(list(Priority)), created, source)
        tech = tech_for(site, service)
        job.assignee_id, job.assignee = tech.id, tech
        job.scheduled_date = (created + timedelta(days=rng.randint(1, 6))).date()
        job.due_date = job.scheduled_date + timedelta(days=2)
        job.completed_at = min(created + timedelta(days=rng.uniform(1, 9)), NOW - timedelta(hours=6))
        job.status, job.updated_at = JobStatus.completed, job.completed_at
        job.feedback_token = secrets.token_urlsafe(24)
        db.add(JobEvent(job=job, user_id=job.created_by_id, kind="assigned", message=f"Assigned to {tech.full_name}",
                        created_at=created + timedelta(hours=2)))
        db.add(JobEvent(job=job, user_id=tech.id, kind="status", message="Status changed from scheduled to in progress",
                        created_at=job.completed_at - timedelta(hours=3)))
        job.report = report_for(job, site)
        db.add(JobEvent(job=job, user_id=tech.id, kind="report", message="Service report finalized", created_at=job.completed_at))
        db.add(JobEvent(job=job, user_id=tech.id, kind="status", message="Status changed from in progress to completed",
                        created_at=job.completed_at))
        completed.append(job)
    db.flush()

    # Feedback on ~70% of completed jobs. A few technicians and one region get worse reviews,
    # so the insights have a real pattern to find.
    weak_techs = {techs[1].id} if len(techs) > 2 else set()
    weak_region = regions[-1].id
    for job in completed:
        if rng.random() > 0.7:
            continue
        bad = 0.12 + (0.25 if job.assignee_id in weak_techs else 0) + (0.12 if job.region_id == weak_region else 0)
        roll = rng.random()
        if roll < bad:
            rating, comment = rng.choice([1, 2, 2]), rng.choice(NEGATIVE_COMMENTS)
        elif roll < bad + 0.18:
            rating, comment = 3, rng.choice(NEUTRAL_COMMENTS)
        else:
            rating, comment = rng.choice([4, 5, 5, 5]), rng.choice(POSITIVE_COMMENTS)
        at = job.completed_at + timedelta(hours=rng.uniform(3, 72))
        if at > NOW:
            continue
        fb = Feedback(tenant_id=tenant.id, job_id=job.id, client_id=job.client_id, region_id=job.region_id,
                      rating=rating, comment=comment, created_at=at, updated_at=at, analyzed_at=at)
        analysis = _demo_one(fb)
        fb.sentiment, fb.sentiment_score, fb.themes = analysis["sentiment"], analysis["score"], analysis["themes"]
        db.add(fb)

    # Open work: a mix of statuses, some unassigned, a few overdue.
    for i in range(n_open):
        site = rng.choice(sites)
        service = rng.choice(list(OPEN_JOB_TEXT))
        title, priority = rng.choice(OPEN_JOB_TEXT[service])
        created = days_ago(rng.uniform(0.2, 20))
        # Ad-hoc requests: logged by hand or through AI intake (scheduled work is raised below).
        source = rng.choice([JobSource.manual, JobSource.ai_intake])
        job = new_job(site, service, title, f"{title}. Reported by {site.client.contact_name}.", priority, created, source)
        status = rng.choices(
            [JobStatus.new, JobStatus.scheduled, JobStatus.in_progress, JobStatus.on_hold], [0.3, 0.4, 0.2, 0.1]
        )[0]
        assign = status != JobStatus.new or rng.random() < 0.3
        if assign:
            tech = tech_for(site, service)
            job.assignee_id, job.assignee = tech.id, tech
            db.add(JobEvent(job=job, user_id=job.created_by_id, kind="assigned", message=f"Assigned to {tech.full_name}",
                            created_at=created + timedelta(hours=1)))
        else:
            status = JobStatus.new
        job.status = status
        job.scheduled_date = (created + timedelta(days=rng.randint(1, 10))).date() if status != JobStatus.new else None
        sla = {Priority.urgent: 1, Priority.high: 3, Priority.medium: 7, Priority.low: 21}[priority]
        # Most open work is on track; about one in seven jobs has slipped past its due date.
        if rng.random() < 0.15:
            job.due_date = TODAY - timedelta(days=rng.randint(1, 6))
        else:
            job.due_date = max((created + timedelta(days=sla + rng.randint(2, 12))).date(), TODAY + timedelta(days=1))
        if status == JobStatus.on_hold:
            db.add(JobEvent(job=job, user_id=job.assignee_id, kind="status",
                            message="Status changed from in progress to on hold: waiting for replacement part",
                            created_at=created + timedelta(days=1)))

    # Due services that already have an open job raised for them.
    due_soon = [s for s in schedules if s.next_due_date <= TODAY + timedelta(days=10)]
    for schedule in rng.sample(due_soon, min(len(due_soon) // 3, 8)):
        site = schedule.site
        created = days_ago(rng.uniform(0.5, 6))
        job = new_job(site, schedule.service_type,
                      f"{schedule.service_type.value.replace('_', ' ').capitalize()} – {site.name}",
                      f"Scheduled {schedule.service_type.value.replace('_', ' ')} (every {schedule.interval_days} days).",
                      Priority.medium, created, JobSource.schedule, schedule)
        job.due_date = max(schedule.next_due_date, TODAY)
        job.status = JobStatus.new
    tenant.next_job_number = number
    db.flush()
    seed_audit_history(db, tenant, users, completed)
    return tenant


BROWSERS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/131.0 Mobile Safari/537.36",
]


def seed_audit_history(db, tenant, users, completed):
    """A month of plausible activity, written through the real hash chain (oldest first)."""
    since = NOW - timedelta(days=30)
    ips = {u.id: f"203.0.113.{rng.randint(10, 250)}" for u in users}
    agents = {u.id: rng.choice(BROWSERS) for u in users}
    events = []

    def add(at, user, action, summary, *, status=200, method="POST", path="/api/", entity=None, changes=None):
        events.append(dict(
            created_at=at, tenant_id=tenant.id, user_id=user.id if user else None,
            user_email=user.email if user else None, user_name=user.full_name if user else None,
            user_role=user.role.value if user else None, action=action, summary=summary,
            entity_type=entity[0] if entity else None, entity_id=entity[1] if entity else None,
            entity_label=entity[2] if entity else None, changes=changes, method=method, path=path,
            status_code=status, ip_address=ips[user.id] if user else "198.51.100.23",
            user_agent=agents[user.id] if user else BROWSERS[1], request_id=secrets.token_hex(8),
            duration_ms=rng.randint(8, 120),
        ))

    # Daily sign-ins.
    for day in range(30):
        for u in users:
            if rng.random() < (0.8 if u.role == Role.technician else 0.6):
                at = since + timedelta(days=day, hours=rng.uniform(7, 10))
                add(at, u, "auth.login", "Signed in", path="/api/auth/login", entity=("user", u.id, u.email))

    # Work on recently completed jobs.
    for job in completed:
        if job.completed_at < since:
            continue
        creator = next((u for u in users if u.id == job.created_by_id), users[0])
        tech = job.assignee
        label = f"{job.number} · {job.title}"
        add(job.created_at, creator, "job.create", f"Created {job.number} for {job.client.name}, unassigned",
            path="/api/jobs", entity=("job", job.id, label))
        add(job.created_at + timedelta(hours=2), creator, "job.assign", f"Assigned {job.number} to {tech.full_name}",
            path=f"/api/jobs/{job.id}/assign", entity=("job", job.id, label), changes={"assignee": [None, tech.full_name]})
        add(job.completed_at - timedelta(minutes=20), tech, "report.ai_draft",
            f"Drafted the service report for {job.number} with AI (local)",
            path=f"/api/jobs/{job.id}/report/draft", entity=("job", job.id, label))
        add(job.completed_at, tech, "report.finalize", f"Finalized the service report for {job.number} and completed the job",
            path=f"/api/jobs/{job.id}/report/finalize", entity=("job", job.id, label))

    # A few things an admin would want to notice.
    techs = [u for u in users if u.role == Role.technician]
    admin = next(u for u in users if u.role == Role.admin)
    for _ in range(3):
        u = rng.choice(techs)
        add(since + timedelta(days=rng.uniform(1, 29)), None, "auth.login_failed",
            f"Failed sign-in for {u.email} (wrong password)", status=401, path="/api/auth/login",
            entity=("user", u.id, u.email))
    for _ in range(2):
        u = rng.choice(techs)
        add(since + timedelta(days=rng.uniform(1, 29)), u, "access.denied", "Permission denied: GET /api/audit",
            status=403, method="GET", path="/api/audit")
    add(since + timedelta(days=rng.uniform(5, 25)), None, "auth.login_failed",
        "Failed sign-in for it-support@sunpeak.demo (unknown email)", status=401, path="/api/auth/login",
        entity=("user", None, "it-support@sunpeak.demo"))
    add(NOW - timedelta(days=6), admin, "audit.export", "Exported 412 audit entries as CSV", method="GET", path="/api/audit/export")

    for e in sorted(events, key=lambda e: e["created_at"]):
        if e["created_at"] < NOW:
            append_audit(db, AuditLog(**e))


def main():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    T = Role.technician
    sunpeak_staff = [
        ("Alex Morgan", "admin@sunpeak.demo", Role.admin, [], []),
        ("Priya Nair", "priya@sunpeak.demo", Role.manager, ["MET", "NTH"], []),
        ("Daniel Brooks", "daniel@sunpeak.demo", Role.manager, ["VAL", "HIL"], []),
        ("Marco Ruiz", "marco@sunpeak.demo", T, ["MET"], ["panel_cleaning", "fault_repair", "electrical_safety"]),
        ("Jordan Lee", "jordan@sunpeak.demo", T, ["MET", "NTH"], ["inverter_service", "monitoring_check", "fault_repair"]),
        ("Aisha Khan", "aisha@sunpeak.demo", T, ["NTH"], ["thermal_inspection", "electrical_safety", "installation_audit"]),
        ("Tom Becker", "tom@sunpeak.demo", T, ["VAL"], ["panel_cleaning", "vegetation_control", "fault_repair"]),
        ("Grace Owusu", "grace@sunpeak.demo", T, ["VAL", "HIL"], ["inverter_service", "thermal_inspection", "electrical_safety"]),
        ("Kenji Sato", "kenji@sunpeak.demo", T, ["HIL"], ["panel_cleaning", "monitoring_check", "installation_audit"]),
        ("Lena Novak", "lena@sunpeak.demo", T, ["HIL", "VAL"], ["fault_repair", "electrical_safety", "vegetation_control"]),
    ]
    build_tenant(
        db, "SunPeak Solar Services", "sunpeak",
        [("Metro", "MET"), ("North Coast", "NTH"), ("Central Valley", "VAL"), ("Highlands", "HIL")],
        sunpeak_staff, n_clients=44, n_history=230, n_open=38,
    )
    brightgrid_staff = [
        ("Sam Patel", "admin@brightgrid.demo", Role.admin, [], []),
        ("Elena Costa", "elena@brightgrid.demo", Role.manager, ["LAK", "RIV"], []),
        ("Omar Haddad", "omar@brightgrid.demo", T, ["LAK"], ["panel_cleaning", "inverter_service", "fault_repair"]),
        ("Mei Chen", "mei@brightgrid.demo", T, ["RIV"], ["thermal_inspection", "electrical_safety", "monitoring_check"]),
    ]
    build_tenant(
        db, "BrightGrid Energy", "brightgrid", [("Lakeside", "LAK"), ("Riverside", "RIV")],
        brightgrid_staff, n_clients=14, n_history=60, n_open=12,
    )
    db.commit()
    db.close()
    print(f"Seeded demo data. Log in with any demo account, password: {DEMO_PASSWORD}")
    for name, email, role, *_ in sunpeak_staff[:4] + brightgrid_staff[:1]:
        print(f"  {role.value:<10} {email:<26} {name}")


if __name__ == "__main__":
    main()

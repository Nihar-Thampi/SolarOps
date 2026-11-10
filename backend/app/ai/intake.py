"""AI job intake: turn a customer's message (email, call notes, text) into a draft job.

The model sees the tenant's clients and sites so it can match "the Mehta house on
Lake Road" to the right records. Its answer is a draft the user reviews and edits;
nothing is created until they confirm.
"""
import difflib
import re

from sqlalchemy.orm import Session

from app.ai.client import STR, AIResult, nullable, obj, run_json
from app.models import Client, Priority, ServiceType

SYSTEM = """You are the intake coordinator for a solar operations and maintenance company.
Turn the customer's message into a work order.

Rules:
- Pick client_id and site_id only from the CLIENTS list, and only when the message clearly
  identifies them (name, address, phone or email). Otherwise use null and, if the message
  names a person or business, put it in new_client_name.
- service_type: panel_cleaning (dirty/soiled panels, bird droppings, dust), inverter_service
  (inverter errors, beeping, display faults), thermal_inspection (hot spots, burn marks,
  annual thermal scan), electrical_safety (sparking, burning smell, tripping breakers,
  exposed wiring), vegetation_control (trees or plants shading panels), fault_repair
  (system down, zero output, physical damage, cracked panels, loose mounting),
  monitoring_check (app shows odd readings, monitoring offline), installation_audit
  (new owner, insurance or compliance check of an existing system).
- priority: urgent = safety risk (sparks, smoke, burning smell, fire, exposed live wires);
  high = system producing nothing or major loss; medium = partial loss or a fault
  without safety risk; low = routine or cosmetic.
- title: under 70 characters, specific. description: a clean summary for the technician,
  keeping every concrete detail (symptoms, error codes, access notes, preferred times).
- reasoning: one or two sentences on how you chose the service type, priority and client.
- confidence: 0 to 1, how sure you are of the client match and classification."""

SCHEMA = obj(
    {
        "title": STR,
        "description": STR,
        "service_type": {"type": "string", "enum": [s.value for s in ServiceType]},
        "priority": {"type": "string", "enum": [p.value for p in Priority]},
        "client_id": nullable(STR),
        "site_id": nullable(STR),
        "new_client_name": nullable(STR),
        "contact_name": nullable(STR),
        "contact_phone": nullable(STR),
        "contact_email": nullable(STR),
        "reasoning": STR,
        "confidence": {"type": "number"},
    }
)


def _client_context(clients: list[Client]) -> str:
    lines = []
    for c in clients:
        contact = ", ".join(x for x in (c.contact_name, c.phone, c.email) if x)
        lines.append(f"- client_id={c.id} | {c.name} | {c.region.name} | {c.address or ''} | {contact}")
        for s in c.sites:
            lines.append(f"    - site_id={s.id} | {s.name} | {s.address or ''} | inverter: {s.inverter_model or '?'}")
    return "\n".join(lines) or "(no clients yet)"


def draft_job(db: Session, tenant_id: str, user_id: str, text: str, clients: list[Client]) -> AIResult:
    prompt = f"CLIENTS:\n{_client_context(clients)}\n\nCUSTOMER MESSAGE:\n{text}"
    result = run_json(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        feature="intake",
        system=SYSTEM,
        prompt=prompt,
        schema=SCHEMA,
        demo=lambda: _demo(text, clients),
    )
    _validate_ids(result.data, clients)
    return result


def _validate_ids(data: dict, clients: list[Client]) -> None:
    """Never trust model-chosen ids: drop any that aren't this user's clients/sites."""
    by_id = {c.id: c for c in clients}
    client = by_id.get(data.get("client_id") or "")
    if client is None:
        data["client_id"] = None
        data["site_id"] = None
        return
    if data.get("site_id") not in {s.id for s in client.sites}:
        data["site_id"] = client.sites[0].id if len(client.sites) == 1 else None


# ---- Rule-based fallback ----

_SERVICE_KEYWORDS: list[tuple[ServiceType, tuple[str, ...]]] = [
    (ServiceType.electrical_safety, ("spark", "burning smell", "smoke", "breaker", "tripping", "exposed wire", "shock", "fire")),
    (ServiceType.inverter_service, ("inverter", "error code", "beeping", "fault code", "display")),
    (ServiceType.vegetation_control, ("tree", "branch", "shade", "shading", "vegetation", "overgrown")),
    (ServiceType.thermal_inspection, ("hot spot", "hotspot", "thermal", "burn mark", "discolor")),
    (ServiceType.panel_cleaning, ("dirty", "dust", "clean", "bird", "droppings", "soiling", "pollen")),
    (ServiceType.monitoring_check, ("app", "monitoring", "portal", "readings", "offline", "data")),
    (ServiceType.installation_audit, ("audit", "insurance", "compliance", "new owner", "bought the house")),
    (ServiceType.fault_repair, ("not working", "zero", "no power", "nothing", "crack", "broken", "loose", "damage", "down")),
]

_URGENT = ("spark", "smoke", "fire", "burning", "shock", "exposed wire")
_HIGH = ("not working", "zero", "no power", "nothing", "completely", "dead", "down", "stopped")
_LOW = ("routine", "whenever", "no rush", "annual", "scheduled", "next month")


def _demo(text: str, clients: list[Client]) -> dict:
    lower = text.lower()
    service = next(
        (s for s, words in _SERVICE_KEYWORDS if any(w in lower for w in words)), ServiceType.fault_repair
    )
    if any(w in lower for w in _URGENT):
        priority = Priority.urgent
    elif any(w in lower for w in _HIGH):
        priority = Priority.high
    elif any(w in lower for w in _LOW):
        priority = Priority.low
    else:
        priority = Priority.medium

    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text)
    phone = re.search(r"\+?\d[\d\s-]{7,}\d", text)
    client, site, how = _match_client(lower, clients, email, phone)

    label = service.value.replace("_", " ").capitalize()
    title = f"{label} – {client.name}"[:70] if client else f"{label} request"

    return {
        "title": title,
        "description": text.strip(),
        "service_type": service.value,
        "priority": priority.value,
        "client_id": client.id if client else None,
        "site_id": site.id if site else None,
        "new_client_name": None,
        "contact_name": None,
        "contact_phone": phone.group(0).strip() if phone else None,
        "contact_email": email.group(0) if email else None,
        "reasoning": f"Keyword rules: classified as {service.value.replace('_', ' ')} with {priority.value} "
        f"priority. {how}",
        "confidence": 0.75 if client else 0.4,
    }


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")[-9:]


def _match_client(lower, clients, email, phone):
    for c in clients:
        if email and c.email and c.email.lower() == email.group(0).lower():
            return c, _only_site(c), f"Matched {c.name} by email."
        if phone and c.phone and _digits(c.phone) and _digits(c.phone) == _digits(phone.group(0)):
            return c, _only_site(c), f"Matched {c.name} by phone number."
    for c in clients:
        for s in c.sites:
            if s.address and s.address.lower().split(",")[0] in lower:
                return c, s, f"Matched {c.name} by site address."
    names = {c.name.lower(): c for c in clients}
    words = re.findall(r"[a-z][a-z'&.-]+(?: [a-z][a-z'&.-]+){0,3}", lower)
    for name, c in names.items():
        key = name.split()[0] if len(name.split()) > 1 else name
        if len(key) > 3 and re.search(rf"\b{re.escape(key)}\b", lower):
            return c, _only_site(c), f"Matched {c.name} by name."
    close = difflib.get_close_matches(" ".join(words)[:60], list(names), n=1, cutoff=0.8)
    if close:
        c = names[close[0]]
        return c, _only_site(c), f"Closest client name: {c.name}."
    return None, None, "No existing client matched; review the client before creating the job."


def _only_site(client: Client):
    return client.sites[0] if len(client.sites) == 1 else None

"""Auto service reports: turn a technician's rough notes into a customer-ready report.

The draft is saved for the technician to edit; it becomes the site's maintenance
record once they finalize it.
"""
import re

from sqlalchemy.orm import Session

from app.ai.client import STR, STR_LIST, AIResult, obj, run_json
from app.models import Job

SYSTEM = """You write service reports for a solar operations and maintenance company.
Turn the technician's rough field notes into a clear report the customer will read.

Rules:
- Use only facts in the notes and readings. Never invent measurements, parts, causes or
  work that the notes don't mention.
- summary: 2-3 plain sentences: what was wrong (or checked), what was done, the outcome.
- work_performed: the actions taken, one per item, past tense.
- findings: what was observed (faults, damage, wear, readings that matter), one per item.
  Empty if nothing notable.
- recommendations: follow-up the customer should consider, one per item, each starting
  with a verb. Empty if none are supported by the notes.
- Write for a homeowner or facility manager: no jargon without a short explanation,
  no internal shorthand ("inv" -> "inverter", "PV" -> "solar panels")."""

SCHEMA = obj({"summary": STR, "work_performed": STR_LIST, "findings": STR_LIST, "recommendations": STR_LIST})


def draft_report(
    db: Session, tenant_id: str, user_id: str, job: Job, notes: str, readings: dict[str, str]
) -> AIResult:
    site = job.site
    site_lines = (
        f"Site: {site.name}, {site.address or ''}. System {site.system_size_kw or '?'} kW, "
        f"{site.panel_count or '?'} panels ({site.panel_model or 'unknown model'}), "
        f"inverter {site.inverter_model or 'unknown'}, battery: {'yes' if site.has_battery else 'no'}."
        if site
        else "Site: not recorded."
    )
    readings_text = "\n".join(f"- {k}: {v}" for k, v in readings.items()) or "(none)"
    prompt = (
        f"JOB {job.number}: {job.title}\nService type: {job.service_type.value.replace('_', ' ')}\n"
        f"Customer: {job.client.name}\n{site_lines}\nOriginal request: {job.description or '(none)'}\n\n"
        f"READINGS:\n{readings_text}\n\nTECHNICIAN NOTES:\n{notes}"
    )
    return run_json(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        feature="report",
        system=SYSTEM,
        prompt=prompt,
        schema=SCHEMA,
        demo=lambda: _demo(job, notes),
    )


# ---- Rule-based fallback ----

_ABBREVIATIONS = {
    r"\binv\b": "inverter",
    r"\bpv\b": "solar panel",
    r"\bmods?\b": "modules",
    r"\bw/\b": "with",
    r"\bchk(d)?\b": "checked",
    r"\brepl(d)?\b": "replaced",
    r"\bapprox\b": "approximately",
}
_WORK = ("cleaned", "replaced", "tightened", "reset", "installed", "repaired", "trimmed", "updated",
         "tested", "checked", "inspected", "removed", "torqued", "sealed", "restarted", "flushed", "swapped")
_RECOMMEND = ("recommend", "should", "suggest", "next visit", "monitor", "consider", "plan to", "advise")
_FINDING = ("found", "noticed", "crack", "hot spot", "hotspot", "corrosion", "loose", "degraded", "dirty",
            "damage", "error", "fault", "worn", "shading", "low output", "reading")


def _clean(sentence: str) -> str:
    s = sentence.strip(" -•*\t")
    for pattern, word in _ABBREVIATIONS.items():
        s = re.sub(pattern, word, s, flags=re.I)
    return s[:1].upper() + s[1:] if s else s


def _demo(job: Job, notes: str) -> dict:
    parts = [_clean(p) for p in re.split(r"(?<=[.!?])\s+|\n+|;\s*", notes) if len(p.strip()) > 3]
    work, findings, recs = [], [], []
    for p in parts:
        low = p.lower()
        if any(w in low for w in _RECOMMEND):
            recs.append(p.rstrip("."))
        elif any(w in low for w in _WORK):
            work.append(p.rstrip("."))
        elif any(w in low for w in _FINDING):
            findings.append(p.rstrip("."))
        else:
            work.append(p.rstrip("."))
    service = job.service_type.value.replace("_", " ")
    where = f"{job.client.name} ({job.site.name})" if job.site else job.client.name
    summary = f"{service.capitalize()} visit completed for {where}."
    if work:
        summary += f" Work carried out: {'; '.join(w[:1].lower() + w[1:] for w in work[:3])}."
    summary += (
        f" {len(findings)} issue{'s' if len(findings) != 1 else ''} noted for attention."
        if findings
        else " No further issues were found."
    )
    return {
        "summary": summary,
        "work_performed": work,
        "findings": findings,
        "recommendations": recs,
    }

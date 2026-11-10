"""Customer feedback insights.

1. analyze_feedback: label each comment with sentiment, a -1..1 score and themes from a
   fixed list (fixed so the dashboard can count them consistently).
2. summarize_feedback: read recent feedback and write what customers praise, what they
   complain about, and what the business should do next.
"""
from sqlalchemy.orm import Session

from app.ai.client import STR, STR_LIST, AIResult, obj, run_json
from app.models import Feedback, Sentiment

THEMES = [
    "Punctuality",
    "Communication",
    "Workmanship",
    "Professionalism",
    "Cleanliness",
    "Pricing",
    "Speed of service",
    "System performance",
    "Scheduling",
    "Follow-up",
]

ANALYZE_SYSTEM = f"""You analyze customer feedback for a solar maintenance company.
For each item, return:
- sentiment: positive, neutral or negative, judged from the comment together with the 1-5 rating.
  Mixed feedback with a real complaint is negative or neutral, not positive.
- score: -1 (very negative) to 1 (very positive).
- themes: the 0-3 themes the comment actually talks about, from this list only:
  {", ".join(THEMES)}. An empty list if the comment is blank or too vague.
Return one result per input id."""

ANALYZE_SCHEMA = obj(
    {
        "results": {
            "type": "array",
            "items": obj(
                {
                    "id": STR,
                    "sentiment": {"type": "string", "enum": [s.value for s in Sentiment]},
                    "score": {"type": "number"},
                    "themes": {"type": "array", "items": {"type": "string", "enum": THEMES}},
                }
            ),
        }
    }
)

SUMMARY_SYSTEM = """You advise the operations manager of a solar maintenance company.
Read the customer feedback and report:
- summary: 2-3 sentences on overall satisfaction and the main pattern, citing the numbers given.
- praise: up to 4 specific things customers value, most common first.
- complaints: up to 4 specific recurring problems, most common first. Empty if there are none.
- suggested_actions: up to 4 concrete actions that address the complaints, each starting with a verb.
Ground every point in the feedback; quote short phrases where helpful. Don't invent issues."""

SUMMARY_SCHEMA = obj({"summary": STR, "praise": STR_LIST, "complaints": STR_LIST, "suggested_actions": STR_LIST})

BATCH = 25


def analyze_feedback(db: Session, tenant_id: str, user_id: str | None, items: list[Feedback]) -> list[AIResult]:
    """Fill sentiment, score and themes on `items` (in place), in batches."""
    results = []
    for i in range(0, len(items), BATCH):
        batch = items[i : i + BATCH]
        prompt = "\n".join(f"id={f.id} | rating={f.rating}/5 | comment: {f.comment or '(no comment)'}" for f in batch)
        result = run_json(
            db=db,
            tenant_id=tenant_id,
            user_id=user_id,
            feature="feedback",
            system=ANALYZE_SYSTEM,
            prompt=prompt,
            schema=ANALYZE_SCHEMA,
            demo=lambda batch=batch: {"results": [_demo_one(f) for f in batch]},
        )
        by_id = {r["id"]: r for r in result.data.get("results", [])}
        for f in batch:
            r = by_id.get(f.id) or _demo_one(f)
            f.sentiment = Sentiment(r["sentiment"])
            f.sentiment_score = max(-1.0, min(1.0, float(r["score"])))
            f.themes = [t for t in r["themes"] if t in THEMES][:3]
        results.append(result)
    return results


def summarize_feedback(db: Session, tenant_id: str, user_id: str, items: list[Feedback]) -> AIResult:
    n = len(items)
    avg = sum(f.rating for f in items) / n if n else 0
    counts = {s: sum(1 for f in items if f.sentiment == s) for s in Sentiment}
    header = (
        f"{n} feedback items, average rating {avg:.1f}/5. "
        f"Positive {counts[Sentiment.positive]}, neutral {counts[Sentiment.neutral]}, "
        f"negative {counts[Sentiment.negative]}."
    )
    lines = "\n".join(
        f"- {f.rating}/5 ({f.sentiment.value if f.sentiment else '?'}; {', '.join(f.themes) or 'no theme'}): "
        f"{f.comment or '(no comment)'}"
        for f in items
    )
    return run_json(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        feature="insights",
        system=SUMMARY_SYSTEM,
        prompt=f"{header}\n\nFEEDBACK:\n{lines}",
        schema=SUMMARY_SCHEMA,
        demo=lambda: _demo_summary(items, avg, counts),
    )


# ---- Rule-based fallback ----

_POS = ("great", "excellent", "friendly", "professional", "quick", "fast", "on time", "punctual", "helpful",
        "thorough", "clean", "tidy", "recommend", "happy", "amazing", "polite", "explained", "efficient", "good")
_NEG = ("late", "slow", "rude", "dirty", "mess", "expensive", "never", "didn't", "did not", "poor", "waited",
        "no one", "nobody", "broke", "again", "still", "worse", "overpriced", "unprofessional", "cancel", "delay")
_THEME_WORDS = {
    "Punctuality": ("on time", "late", "punctual", "arrived", "waited", "early"),
    "Communication": ("explained", "call", "update", "informed", "communicat", "told", "text", "email", "respond"),
    "Workmanship": ("thorough", "quality", "job", "work", "fixed", "repair", "careful", "detail"),
    "Professionalism": ("professional", "polite", "rude", "friendly", "courteous", "respectful"),
    "Cleanliness": ("clean", "tidy", "mess", "dirty", "debris"),
    "Pricing": ("price", "expensive", "cost", "cheap", "overpriced", "value", "invoice", "charge"),
    "Speed of service": ("quick", "fast", "slow", "took", "same day", "efficient", "hours"),
    "System performance": ("output", "production", "generating", "performance", "working", "power", "kwh"),
    "Scheduling": ("schedule", "appointment", "reschedul", "booking", "slot", "cancel"),
    "Follow-up": ("follow", "again", "still", "came back", "return", "check back"),
}


def _demo_one(f: Feedback) -> dict:
    text = (f.comment or "").lower()
    hits = sum(w in text for w in _POS) - sum(w in text for w in _NEG)
    score = max(-1.0, min(1.0, (f.rating - 3) / 2 * 0.7 + hits * 0.15))
    sentiment = "positive" if score > 0.25 else "negative" if score < -0.15 else "neutral"
    themes = [t for t, words in _THEME_WORDS.items() if any(w in text for w in words)][:3]
    return {"id": f.id, "sentiment": sentiment, "score": round(score, 2), "themes": themes}


def _demo_summary(items: list[Feedback], avg: float, counts: dict) -> dict:
    pos_themes: dict[str, int] = {}
    neg_themes: dict[str, int] = {}
    for f in items:
        bucket = neg_themes if f.sentiment == Sentiment.negative else pos_themes if f.sentiment == Sentiment.positive else None
        if bucket is not None:
            for t in f.themes:
                bucket[t] = bucket.get(t, 0) + 1
    top_pos = sorted(pos_themes.items(), key=lambda kv: -kv[1])[:4]
    top_neg = sorted(neg_themes.items(), key=lambda kv: -kv[1])[:4]
    n = len(items) or 1
    share = round(100 * counts[Sentiment.positive] / n)
    actions = {
        "Punctuality": "Send customers an arrival window and a heads-up text when the technician is on the way",
        "Communication": "Call or message customers with an update before and after each visit",
        "Workmanship": "Add a final checklist sign-off before technicians leave the site",
        "Professionalism": "Run a short customer-care refresher for the team",
        "Cleanliness": "Make site clean-up part of the job checklist",
        "Pricing": "Share a written estimate before work starts and explain each invoice line",
        "Speed of service": "Review dispatch so urgent jobs are assigned the same day",
        "System performance": "Schedule a follow-up output check a week after repair jobs",
        "Scheduling": "Offer customers self-service booking slots and confirm the day before",
        "Follow-up": "Track repeat visits and assign a senior technician when a fault comes back",
    }
    return {
        "summary": f"Across {len(items)} reviews the average rating is {avg:.1f}/5 and {share}% are positive. "
        + (f"The most common complaint theme is {top_neg[0][0].lower()}." if top_neg else "There is no recurring complaint theme."),
        "praise": [f"{t} ({c} mentions)" for t, c in top_pos],
        "complaints": [f"{t} ({c} mentions)" for t, c in top_neg],
        "suggested_actions": [actions[t] for t, _ in top_neg],
    }

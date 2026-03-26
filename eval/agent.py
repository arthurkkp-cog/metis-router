"""
DoorDash MCP OrderSupportAgent - DSPy-based agent with openinference tracing.

This agent routes customer queries to the appropriate MCP service:
- meilisearch: Restaurant/food search
- medusa: Order management (place, cancel, modify orders)
- osrm: Delivery tracking and routing
- chatwoot: Customer support and complaints
- novu: Notifications and alerts
"""

import os
import re as _re

import dspy

# ---------------------------------------------------------------------------
# Tracing setup (Phoenix / OpenInference)
# ---------------------------------------------------------------------------

_tracer_provider = None


def setup_tracing(project_name: str = "doordash-mcp-eval") -> None:
    """Initialize OpenTelemetry + Phoenix tracing for DSPy."""
    global _tracer_provider
    if _tracer_provider is not None:
        return

    try:
        from openinference.instrumentation.dspy import DSPyInstrumentor
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from phoenix.otel import register

        _tracer_provider = register(project_name=project_name)
        DSPyInstrumentor().instrument(tracer_provider=_tracer_provider)
        print(f"[tracing] Phoenix tracing enabled  project={project_name}")
    except ImportError as exc:
        print(
            f"[tracing] Tracing dependencies not fully installed ({exc}). "
            "Continuing without tracing."
        )
    except Exception as exc:
        print(f"[tracing] Could not start tracing: {exc}. Continuing without tracing.")


# ---------------------------------------------------------------------------
# DSPy Signatures
# ---------------------------------------------------------------------------

class RouteQuery(dspy.Signature):
    """Classify a customer support query to the correct MCP service.

    You are a DoorDash customer-support routing agent. Your job is to classify
    each customer query to exactly ONE primary MCP service.

    Available services:
      meilisearch - Restaurant and food search. Use for queries about finding
                    restaurants, browsing menus, searching for cuisine types,
                    or discovering what's available nearby.
      medusa      - Order management. Use for placing orders, cancelling orders,
                    modifying orders, checking order status, or anything related
                    to the lifecycle of a purchase.
      osrm        - Delivery tracking and routing. Use for real-time delivery
                    location, ETA estimates, driver/dasher tracking, route info,
                    or distance calculations.
      chatwoot    - Customer support and complaints. Use for refund requests,
                    complaints about food quality, missing items, reporting
                    issues, or any conversation that requires human-like support
                    resolution.
      novu        - Notifications. Use for sending delivery updates, order
                    confirmations, promotional alerts, push notifications, email
                    or SMS notifications to customers.

    Routing rules:
    - Food / restaurant discovery queries -> meilisearch
    - Order lifecycle (create, cancel, modify, status) -> medusa
    - "Where is my driver/dasher?", ETA, tracking -> osrm
    - Complaints, refunds, quality issues -> chatwoot
    - "Notify me", "send me updates", alerts -> novu
    - If ambiguous, prefer the service that best matches the primary intent.
    """

    query: str = dspy.InputField(desc="The customer's message or question.")
    service: str = dspy.OutputField(
        desc=(
            "Exactly one of: meilisearch, medusa, osrm, chatwoot, novu. "
            "Pick the service whose description best matches the primary intent."
        )
    )
    reasoning: str = dspy.OutputField(
        desc="Brief explanation of why this service was chosen."
    )


class GenerateResponse(dspy.Signature):
    """Generate a helpful customer-facing response."""

    query: str = dspy.InputField(desc="The customer's original message.")
    service: str = dspy.InputField(desc="The MCP service selected for this query.")
    response: str = dspy.OutputField(
        desc=(
            "A friendly, concise response acknowledging the customer's request "
            "and explaining what action is being taken via the selected service."
        )
    )


# ---------------------------------------------------------------------------
# Mock LM for offline / CI usage
# ---------------------------------------------------------------------------

# Mapping used by the mock to deterministically route queries
_MOCK_KEYWORD_MAP = {
    "meilisearch": [
        "find", "search", "looking for", "nearby", "restaurant", "food",
        "cuisine", "menu", "sushi", "thai", "pizza", "burger", "open",
        "available", "browse", "discover", "what's around", "recommend",
        "vegan", "vegetarian", "italian", "chinese", "mexican", "indian",
        "dessert", "breakfast", "lunch", "dinner", "brunch", "cafe",
        "pizzza",  # common misspelling
    ],
    "medusa": [
        "order", "place", "cancel", "modify", "change", "cart", "checkout",
        "purchase", "buy", "add to", "remove from", "status", "receipt",
        "payment", "promo", "coupon", "reorder",
    ],
    "osrm": [
        "where is", "track", "eta", "delivery time", "dasher", "driver",
        "how long", "route", "distance", "arrive", "arriving", "location",
        "map", "live", "on the way", "en route",
    ],
    "chatwoot": [
        "refund", "cold", "wrong", "missing", "complaint", "complain",
        "damaged", "terrible", "awful", "bad experience", "late",
        "never arrived", "issue", "problem", "unhappy", "disappointed",
        "speak to", "agent", "manager", "human", "help me",
    ],
    "novu": [
        "notify", "notification", "alert", "update me", "send me",
        "email", "sms", "text me", "push", "remind", "reminder",
        "subscribe", "unsubscribe", "preference",
    ],
}


# Priority-ordered rules checked before generic keyword scoring.
# Each rule is (compiled_pattern, service).  First match wins.
_MOCK_PRIORITY_RULES: list[tuple["_re.Pattern[str]", str]] = [
    # Refund / complaint signals should always go to chatwoot
    (_re.compile(r"refund|cold|wrong item|missing item|damaged|terrible|awful|complaint|complain|never arrived|bad experience|speak to.*(manager|agent|human)", _re.I), "chatwoot"),
    # Notification intent
    (_re.compile(r"notify me|notification|alert me|update me|send me.*(email|sms|update|notification|confirmation)|text me|push notification|unsubscribe|subscribe|remind me|reminder", _re.I), "novu"),
    # Delivery / tracking intent (check before order keywords because "ETA for order" is tracking)
    (_re.compile(r"where is my (dasher|driver|delivery)|track(ing)?|\bETA\b|delivery time|how long until.*(deliver|arriv)|on the way|en route|dasher.*(near|coming|on)|live.*(location|track)|show.*(route|map)|driver.*(route|location)", _re.I), "osrm"),
    # Order lifecycle
    (_re.compile(r"(place|cancel|modify|change|check).*(order|cart)|checkout|reorder|add to (my )?order|remove from (my )?order|order status|receipt|payment|promo|coupon", _re.I), "medusa"),
    # Restaurant / food search
    (_re.compile(r"find|search|looking for|nearby|restaurant|cuisine|menu|browse|discover|recommend|what.*(open|around|available)|sushi|thai|burger|pizza|vegan|vegetarian|italian|chinese|mexican|indian|dessert|breakfast|lunch|dinner|brunch|cafe|pizzza", _re.I), "meilisearch"),
]


def _mock_route(query: str) -> str:
    """Keyword + priority-rule routing for mock mode."""
    # 1. Try priority rules first (order matters)
    for pattern, svc in _MOCK_PRIORITY_RULES:
        if pattern.search(query):
            return svc

    # 2. Fallback to generic keyword scoring
    q = query.lower()
    scores = {svc: 0 for svc in _MOCK_KEYWORD_MAP}
    for svc, keywords in _MOCK_KEYWORD_MAP.items():
        for kw in keywords:
            if kw in q:
                scores[svc] += 1
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "chatwoot"  # default to support for unknown queries
    return best


def _mock_response(query: str, service: str) -> str:
    """Generate a canned response for mock mode."""
    templates = {
        "meilisearch": "I'll search our restaurant database for you right away!",
        "medusa": "I'm processing your order request now through our order management system.",
        "osrm": "Let me check the real-time delivery tracking for you.",
        "chatwoot": "I'm connecting you with our support team to resolve this issue.",
        "novu": "I'll set up those notifications for you right away.",
    }
    return templates.get(service, "Let me help you with that.")


# ---------------------------------------------------------------------------
# OrderSupportAgent
# ---------------------------------------------------------------------------

class OrderSupportAgent(dspy.Module):
    """
    DSPy module that routes DoorDash customer queries to the correct MCP
    service and generates a customer-facing response.
    """

    VALID_SERVICES = {"meilisearch", "medusa", "osrm", "chatwoot", "novu"}

    def __init__(self) -> None:
        super().__init__()
        self.router = dspy.ChainOfThought(RouteQuery)
        self.responder = dspy.ChainOfThought(GenerateResponse)
        self.mock_mode = os.environ.get("MOCK_MODE", "").lower() in ("1", "true", "yes")

    def forward(self, query: str) -> dspy.Prediction:
        if self.mock_mode:
            service = _mock_route(query)
            response = _mock_response(query, service)
            reasoning = f"[mock] keyword match -> {service}"
            return dspy.Prediction(
                service=service,
                reasoning=reasoning,
                response=response,
            )

        # --- Real LLM path ---
        route_result = self.router(
            query=query,
        )
        service = route_result.service.strip().lower()
        # Normalise: take only the first word in case the LLM returns extra text
        service = service.split()[0].strip(".,;:\"'") if service else "chatwoot"
        if service not in self.VALID_SERVICES:
            service = "chatwoot"

        resp_result = self.responder(
            query=query,
            service=service,
        )

        return dspy.Prediction(
            service=service,
            reasoning=route_result.reasoning,
            response=resp_result.response,
        )


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------

def create_agent(
    model: str = "openai/gpt-4o-mini",
    enable_tracing: bool = True,
) -> OrderSupportAgent:
    """
    Factory: configure DSPy LM, optionally enable tracing, and return an
    OrderSupportAgent ready for use.
    """
    mock_mode = os.environ.get("MOCK_MODE", "").lower() in ("1", "true", "yes")

    if not mock_mode:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            print(
                "[agent] No OPENAI_API_KEY found. Falling back to MOCK_MODE=true."
            )
            os.environ["MOCK_MODE"] = "true"
        else:
            lm = dspy.LM(model, api_key=api_key)
            dspy.configure(lm=lm)

    if enable_tracing:
        setup_tracing()

    agent = OrderSupportAgent()
    return agent


# ---------------------------------------------------------------------------
# Quick smoke-test when run directly
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    agent = create_agent()
    sample_queries = [
        "Find me Thai food nearby",
        "Cancel my order #456",
        "Where is my dasher right now?",
        "My food arrived cold and soggy",
        "Send me a notification when my order is ready",
    ]
    for q in sample_queries:
        result = agent(query=q)
        print(f"Q: {q}")
        print(f"  Service : {result.service}")
        print(f"  Response: {result.response}")
        print()

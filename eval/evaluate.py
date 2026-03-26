#!/usr/bin/env python3
"""
DoorDash MCP Agent Evaluation Suite.

Loads test cases from test_cases.json, runs each through the OrderSupportAgent,
checks routing accuracy, and reports per-category and overall results.
Traces are sent to Arize Phoenix when tracing is available.

Usage:
    # With a real LLM (requires OPENAI_API_KEY):
    python evaluate.py

    # Mock mode (no API key needed):
    MOCK_MODE=true python evaluate.py

    # Specify a custom model:
    OPENAI_MODEL=openai/gpt-4o python evaluate.py
"""

import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from agent import create_agent, OrderSupportAgent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_test_cases(path: str = "test_cases.json") -> list[dict[str, Any]]:
    """Load test cases from a JSON file."""
    filepath = Path(__file__).parent / path
    with open(filepath) as f:
        return json.load(f)


def check_routing(
    predicted_service: str,
    expected_service: str | list[str],
) -> bool:
    """
    Return True if the predicted service matches the expected one.

    For cross-domain queries where ``expected_service`` is a list, the
    prediction passes if it matches *any* of the expected services (since
    the agent returns a single primary service).
    """
    if isinstance(expected_service, list):
        return predicted_service in expected_service
    return predicted_service == expected_service


# ---------------------------------------------------------------------------
# Evaluation runner
# ---------------------------------------------------------------------------

def run_evaluation(
    agent: OrderSupportAgent,
    test_cases: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Execute every test case and return structured results.

    Returns a dict with:
        results   – list of per-test dicts
        by_category – {category: {total, passed, details}}
        overall   – {total, passed, pct}
    """
    results: list[dict[str, Any]] = []
    by_category: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"total": 0, "passed": 0, "details": []}
    )

    for tc in test_cases:
        query = tc["query"]
        expected = tc["expected_service"]
        category = tc["category"]

        start = time.time()
        prediction = agent(query=query)
        elapsed = time.time() - start

        predicted_service = prediction.service
        passed = check_routing(predicted_service, expected)

        record = {
            "query": query,
            "category": category,
            "expected_service": expected,
            "predicted_service": predicted_service,
            "passed": passed,
            "reasoning": getattr(prediction, "reasoning", ""),
            "response": getattr(prediction, "response", ""),
            "elapsed_s": round(elapsed, 3),
        }
        results.append(record)

        by_category[category]["total"] += 1
        if passed:
            by_category[category]["passed"] += 1
        by_category[category]["details"].append(record)

    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    pct = (passed / total * 100) if total else 0.0

    return {
        "results": results,
        "by_category": dict(by_category),
        "overall": {"total": total, "passed": passed, "pct": round(pct, 1)},
    }


# ---------------------------------------------------------------------------
# Pretty printer
# ---------------------------------------------------------------------------

_CATEGORY_ORDER = [
    "restaurant_search",
    "order_management",
    "delivery_tracking",
    "customer_support",
    "notifications",
    "cross_domain",
]


def print_results(evaluation: dict[str, Any]) -> None:
    """Print a nicely formatted evaluation report to stdout."""
    results = evaluation["results"]
    by_category = evaluation["by_category"]
    overall = evaluation["overall"]

    print()
    print("=" * 50)
    print("  DoorDash MCP Agent Evaluation")
    print("=" * 50)
    print(f"Running {len(results)} test cases...\n")

    for r in results:
        expected_str = (
            " | ".join(r["expected_service"])
            if isinstance(r["expected_service"], list)
            else r["expected_service"]
        )
        status = "PASS" if r["passed"] else "FAIL"
        print(
            f'[{r["category"]}] "{r["query"]}"\n'
            f"  Expected: {expected_str} | Got: {r['predicted_service']} | {status}"
        )

    # Per-category summary
    print()
    print("=" * 50)
    print("  Results by Category")
    print("=" * 50)

    # Determine max category name length for alignment
    categories = [c for c in _CATEGORY_ORDER if c in by_category]
    # Include any categories not in our predefined order
    for c in sorted(by_category):
        if c not in categories:
            categories.append(c)

    max_len = max((len(c) for c in categories), default=0)

    for cat in categories:
        info = by_category[cat]
        p, t = info["passed"], info["total"]
        pct = (p / t * 100) if t else 0.0
        bar = f"{p}/{t}"
        print(f"  {cat:<{max_len}}  {bar:>5}  ({pct:.0f}%)")

    # Overall
    print()
    print("-" * 50)
    print(
        f"  Overall: {overall['passed']}/{overall['total']} "
        f"({overall['pct']}%)"
    )
    print("-" * 50)
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    model = os.environ.get("OPENAI_MODEL", "openai/gpt-4o-mini")
    print(f"[eval] Model        : {model}")
    print(f"[eval] Mock mode    : {os.environ.get('MOCK_MODE', 'false')}")
    print(f"[eval] Phoenix URL  : http://localhost:6006")
    print()

    agent = create_agent(model=model, enable_tracing=True)
    test_cases = load_test_cases()

    evaluation = run_evaluation(agent, test_cases)
    print_results(evaluation)

    # Write machine-readable results alongside the human-readable output
    output_path = Path(__file__).parent / "eval_results.json"
    with open(output_path, "w") as f:
        json.dump(evaluation, f, indent=2)
    print(f"[eval] Detailed results written to {output_path}")

    # Exit with non-zero status if accuracy is below 90%
    if evaluation["overall"]["pct"] < 90.0:
        print("[eval] WARNING: Overall accuracy below 90% threshold.")
        sys.exit(1)


if __name__ == "__main__":
    main()

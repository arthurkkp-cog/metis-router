# DoorDash MCP Agent Evaluation Pipeline

An evaluation pipeline for the DoorDash OrderSupportAgent built with **DSPy**, instrumented with **openinference** tracing, and visualized in **Arize Phoenix**.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  test_cases.json │────►│  evaluate.py      │────►│  Phoenix (:6006) │
│  (28 scenarios)  │     │  (runs agent,     │     │  (trace viewer)  │
│                  │     │   checks routing) │     │                  │
└──────────────────┘     └────────┬─────────┘     └──────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  agent.py         │
                         │  OrderSupportAgent│
                         │  (DSPy module)    │
                         └──────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
cd eval
pip install -r requirements.txt
```

### 2. Start Phoenix (Trace Viewer)

```bash
phoenix serve
```

Phoenix will start on [http://localhost:6006](http://localhost:6006).

### 3. Run the Evaluation

**With an OpenAI API key** (real LLM routing):

```bash
export OPENAI_API_KEY=sk-...
python evaluate.py
```

**Without an API key** (mock mode — deterministic keyword matching):

```bash
MOCK_MODE=true python evaluate.py
```

**With a different model:**

```bash
OPENAI_MODEL=openai/gpt-4o python evaluate.py
```

### 4. View Traces in Phoenix

Open [http://localhost:6006](http://localhost:6006) and select the **doordash-mcp-eval** project. You'll see:

- Each evaluation query as a trace
- The DSPy chain-of-thought steps (routing + response generation)
- Latency, token counts, and model parameters per span

## Files

| File | Description |
|---|---|
| `agent.py` | DSPy `OrderSupportAgent` — classifies queries to MCP services and generates responses |
| `evaluate.py` | Evaluation runner — loads test cases, runs the agent, reports accuracy |
| `test_cases.json` | 28 test scenarios across 6 categories |
| `requirements.txt` | Python dependencies |
| `eval_results.json` | Generated after a run — machine-readable results |

## Test Categories

| Category | Count | Description |
|---|---|---|
| `restaurant_search` | 5 | Finding restaurants, browsing cuisines |
| `order_management` | 5 | Placing, cancelling, modifying orders |
| `delivery_tracking` | 5 | Dasher location, ETA, route info |
| `customer_support` | 5 | Complaints, refunds, issues |
| `notifications` | 5 | Push, email, SMS notification setup |
| `cross_domain` | 3 | Queries spanning multiple services |

## MCP Services

The agent routes to one of five services:

| Service | Use Case |
|---|---|
| **meilisearch** | Restaurant/food search and discovery |
| **medusa** | Order lifecycle (create, cancel, modify, status) |
| **osrm** | Delivery tracking, ETA, route mapping |
| **chatwoot** | Customer support, complaints, refunds |
| **novu** | Notifications (push, email, SMS alerts) |

## Mock Mode

When `MOCK_MODE=true` or no `OPENAI_API_KEY` is set, the agent uses deterministic keyword-based routing instead of an LLM. This is useful for:

- CI pipelines (no API key required)
- Quick iteration on test cases
- Demonstrating the evaluation framework

## Demo: Breaking the Agent (Phase 4)

To demonstrate how Devin can detect and fix regressions:

### 1. Introduce a Bug

Edit `agent.py` and change the routing rules in `SERVICES_DESCRIPTION`. For example, swap the descriptions of `meilisearch` and `medusa`:

```python
# Before:
#   meilisearch - Restaurant and food search...
#   medusa      - Order management...

# After (broken):
#   meilisearch - Order management...
#   medusa      - Restaurant and food search...
```

### 2. Run the Eval

```bash
python evaluate.py
```

You'll see accuracy drop dramatically as the agent mis-routes queries.

### 3. Have Devin Investigate

Share the evaluation output with Devin:

> "The eval pipeline is showing 40% accuracy — routing is broken. Can you investigate the traces in Phoenix and fix it?"

Devin will:
1. Check the Phoenix traces at http://localhost:6006
2. Identify the swapped service descriptions
3. Fix the system prompt
4. Re-run the eval to confirm 90%+ accuracy

## Example Output

```
==================================================
  DoorDash MCP Agent Evaluation
==================================================
Running 28 test cases...

[restaurant_search] "Find me Thai food nearby"
  Expected: meilisearch | Got: meilisearch | PASS

[order_management] "Cancel my order #123"
  Expected: medusa | Got: medusa | PASS

...

==================================================
  Results by Category
==================================================
  restaurant_search  5/5  (100%)
  order_management   5/5  (100%)
  delivery_tracking  5/5  (100%)
  customer_support   5/5  (100%)
  notifications      5/5  (100%)
  cross_domain       3/3  (100%)

--------------------------------------------------
  Overall: 28/28 (100.0%)
--------------------------------------------------
```

## Adding Test Cases

Add new entries to `test_cases.json`:

```json
{
  "query": "Your customer query here",
  "expected_service": "meilisearch",
  "expected_tools": ["search_restaurants"],
  "category": "restaurant_search"
}
```

For cross-domain queries, use a list for `expected_service`:

```json
{
  "query": "Find pizza and order it",
  "expected_service": ["meilisearch", "medusa"],
  "category": "cross_domain"
}
```

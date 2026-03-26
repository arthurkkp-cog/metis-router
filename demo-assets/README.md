# Demo Assets — Phase 3: Promotions MCP Server

This directory contains the assets needed for **Phase 3** of the DoorDash-themed Metis MCP Router demo, where Devin generates a NEW MCP server from an OpenAPI spec in real-time.

## Contents

| File | Purpose |
|------|---------|
| `promotions-service.yaml` | OpenAPI 3.0 spec for the DoorDash Promotions & Loyalty Service |
| `../mcp-servers/promotions-mcp.mjs` | Pre-built MCP server (fallback if live generation is too slow) |

---

## Phase 3 Demo Flow

### Overview

During Phase 3, the presenter shows that Devin can generate a fully functional MCP server from an OpenAPI specification. The audience sees:

1. The OpenAPI spec displayed on screen
2. A prompt given to Devin to generate the MCP server
3. Devin producing a working server in real-time (or the fallback is swapped in)
4. The new Promotions tools appearing in the Metis router and being used by the agent

### Step-by-Step

#### 1. Display the OpenAPI Spec

Open `demo-assets/promotions-service.yaml` in an editor or viewer so the audience can see the four endpoints:

- `GET /promotions/active` — List active promotions
- `POST /promotions/validate` — Validate a promo code
- `GET /loyalty/points/{customer_id}` — Get loyalty points balance
- `POST /loyalty/redeem` — Redeem points for a discount

> **Tip:** Use a YAML-aware viewer or VS Code with syntax highlighting for maximum visual impact.

#### 2. Prompt Devin for Live Generation

Use the following prompt (copy-paste ready):

```
Using the OpenAPI spec at demo-assets/promotions-service.yaml, generate a new MCP
server at mcp-servers/promotions-mcp.mjs that exposes four tools:

1. get_active_promotions — maps to GET /promotions/active
2. validate_promo_code — maps to POST /promotions/validate
3. get_loyalty_points — maps to GET /loyalty/points/{customer_id}
4. redeem_loyalty_points — maps to POST /loyalty/redeem

Use @modelcontextprotocol/sdk with StdioServerTransport. Default to MOCK_MODE=true
with realistic DoorDash-themed sample data (promo codes: WELCOME20, FREEDEL25,
SUSHIDEAL, SAVE5, DASHPASS10). Use ES modules (.mjs) with a shebang line.
```

#### 3. Wait for Generation (or Swap in Fallback)

- **If Devin finishes in time:** Use the generated file directly.
- **If it's taking too long:** The pre-built fallback is already at `mcp-servers/promotions-mcp.mjs`. No action needed — it's ready to go.

#### 4. Register the New Server with Metis

Add the promotions server to `server/mcp-registry.json`:

```json
{
  "mcpServers": {
    "doordash-promotions": {
      "command": "node",
      "args": ["../mcp-servers/promotions-mcp.mjs"],
      "env": {
        "MOCK_MODE": "true"
      }
    }
  }
}
```

Or use the Metis `add_new_mcp` tool at runtime to hot-load it without restarting.

#### 5. Test the New Tools

Ask the agent questions like:

- _"What promotions are available right now?"_
- _"I have the code WELCOME20 — is it valid for a $42.50 order?"_
- _"How many loyalty points does customer cust_98765 have?"_
- _"Redeem 500 points from customer cust_98765 on order order_12345."_

---

## Running the Pre-built Server Standalone

You can test the MCP server outside of Metis:

```bash
# Install dependencies (from repo root)
npm install @modelcontextprotocol/sdk zod

# Run the server (it communicates over stdio)
node mcp-servers/promotions-mcp.mjs
```

The server starts in `MOCK_MODE=true` by default. To connect to a real API:

```bash
MOCK_MODE=false PROMOTIONS_API_BASE_URL=https://api.doordash.com/v1 \
  node mcp-servers/promotions-mcp.mjs
```

---

## Mock Data Reference

### Promo Codes

| Code | Promotion | Type | Value |
|------|-----------|------|-------|
| `WELCOME20` | 20% Off First Order | percentage | 20% (min $15) |
| `FREEDEL25` | Free Delivery on $25+ | free_delivery | delivery fee waived |
| `SUSHIDEAL` | Buy 2 Rolls Get 1 Free | bogo | 1 free item (Sakura Sushi only) |
| `SAVE5` | $5 Off Next Order | fixed | $5.00 (min $20) |
| `DASHPASS10` | DashPass 10% Off | percentage | 10% (DashPass members) |

### Test Customers

| Customer ID | Points | Tier | Notes |
|-------------|--------|------|-------|
| `cust_98765` | 2,450 | Gold | Good default test customer |
| `cust_11111` | 750 | Silver | New customer, low points |
| `cust_55555` | 12,300 | Platinum | Power user, high points |

### Loyalty Tiers

| Tier | Lifetime Points | Monthly Bonus |
|------|----------------|---------------|
| Silver | 0 – 2,999 | — |
| Gold | 3,000 – 9,999 | 500 pts |
| Platinum | 10,000+ | 1,000 pts |
| DashPass | Subscription-based | Varies |

### Point Redemption

- **Rate:** 100 points = $1.00
- **Minimum:** 100 points per redemption

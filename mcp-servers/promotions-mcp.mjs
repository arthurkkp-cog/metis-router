#!/usr/bin/env node

/**
 * DoorDash Promotions & Loyalty MCP Server
 *
 * A Model Context Protocol server that exposes DoorDash promotions and loyalty
 * tools. Runs in MOCK_MODE by default, returning realistic sample data for
 * demo purposes. Set MOCK_MODE=false and PROMOTIONS_API_BASE_URL to connect
 * to a real Promotions & Loyalty API.
 *
 * Tools:
 *   - get_active_promotions   (GET  /promotions/active)
 *   - validate_promo_code     (POST /promotions/validate)
 *   - get_loyalty_points      (GET  /loyalty/points/{customer_id})
 *   - redeem_loyalty_points   (POST /loyalty/redeem)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MOCK_MODE = process.env.MOCK_MODE !== "false"; // default true
const API_BASE = process.env.PROMOTIONS_API_BASE_URL || "http://localhost:8080/v1";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_PROMOTIONS = [
  {
    id: "promo_001",
    title: "20% Off Your First Order",
    description:
      "Welcome to DoorDash! Enjoy 20% off your first order from any restaurant.",
    discount_type: "percentage",
    discount_value: 20,
    min_order_amount: 15.0,
    valid_until: "2026-06-30T23:59:59Z",
    promo_code: "WELCOME20",
    applicable_restaurants: [],
    category: "new_user",
    terms_and_conditions:
      "Valid for new customers only. Maximum discount $15. Cannot be combined with other offers.",
  },
  {
    id: "promo_002",
    title: "Free Delivery on Orders Over $25",
    description:
      "Skip the delivery fee on any order over $25. Available for all customers!",
    discount_type: "free_delivery",
    discount_value: 0,
    min_order_amount: 25.0,
    valid_until: "2026-04-30T23:59:59Z",
    promo_code: "FREEDEL25",
    applicable_restaurants: [],
    category: "returning",
    terms_and_conditions:
      "Valid on orders $25+. Delivery fee waived up to $7.99.",
  },
  {
    id: "promo_003",
    title: "Buy 2 Rolls Get 1 Free at Sakura Sushi",
    description:
      "Order any two specialty rolls and get a third roll free at Sakura Sushi!",
    discount_type: "bogo",
    discount_value: 1,
    min_order_amount: 0,
    valid_until: "2026-05-15T23:59:59Z",
    promo_code: "SUSHIDEAL",
    applicable_restaurants: ["rest_sakura_001", "rest_sakura_002"],
    category: "restaurant_specific",
    terms_and_conditions:
      "Valid at participating Sakura Sushi locations. Third roll must be of equal or lesser value.",
  },
  {
    id: "promo_004",
    title: "$5 Off Your Next Order",
    description:
      "Save $5 on your next order of $20 or more. Because you deserve a treat!",
    discount_type: "fixed",
    discount_value: 5.0,
    min_order_amount: 20.0,
    valid_until: "2026-04-15T23:59:59Z",
    promo_code: "SAVE5",
    applicable_restaurants: [],
    category: "returning",
    terms_and_conditions:
      "One use per customer. Minimum order $20 before taxes and fees.",
  },
  {
    id: "promo_005",
    title: "DashPass Members: 10% Off Everything",
    description:
      "Exclusive for DashPass members - enjoy 10% off every order this month!",
    discount_type: "percentage",
    discount_value: 10,
    min_order_amount: 0,
    valid_until: "2026-04-30T23:59:59Z",
    promo_code: "DASHPASS10",
    applicable_restaurants: [],
    category: "returning",
    terms_and_conditions:
      "DashPass membership required. Maximum discount $25 per order.",
  },
];

const PROMO_BY_CODE = Object.fromEntries(
  MOCK_PROMOTIONS.map((p) => [p.promo_code, p])
);

/*
 * Tier thresholds (lifetime points):
 *   Silver:   0 – 2,999
 *   Gold:     3,000 – 9,999
 *   Platinum: 10,000+
 *   DashPass: independent subscription status
 */

const MOCK_CUSTOMERS = {
  cust_98765: {
    customer_id: "cust_98765",
    points_balance: 2450,
    tier: "gold",
    points_to_next_tier: 550,
    lifetime_points: 8720,
    recent_transactions: [
      {
        id: "txn_101",
        type: "earned",
        points: 150,
        description: "Order #DD-88291 - Thai Basil Restaurant",
        date: "2026-03-25T19:32:00Z",
      },
      {
        id: "txn_100",
        type: "earned",
        points: 85,
        description: "Order #DD-88104 - Pizza Palace",
        date: "2026-03-23T12:15:00Z",
      },
      {
        id: "txn_099",
        type: "redeemed",
        points: -500,
        description: "Redeemed $5.00 discount on Order #DD-87990",
        date: "2026-03-20T20:45:00Z",
      },
      {
        id: "txn_098",
        type: "earned",
        points: 200,
        description: "Order #DD-87801 - Sakura Sushi",
        date: "2026-03-18T18:20:00Z",
      },
      {
        id: "txn_097",
        type: "bonus",
        points: 500,
        description: "Gold tier monthly bonus",
        date: "2026-03-01T00:00:00Z",
      },
    ],
  },
  cust_11111: {
    customer_id: "cust_11111",
    points_balance: 750,
    tier: "silver",
    points_to_next_tier: 2250,
    lifetime_points: 750,
    recent_transactions: [
      {
        id: "txn_050",
        type: "earned",
        points: 200,
        description: "Order #DD-90102 - Burger Barn",
        date: "2026-03-24T13:00:00Z",
      },
      {
        id: "txn_049",
        type: "earned",
        points: 550,
        description: "Sign-up bonus",
        date: "2026-03-20T10:00:00Z",
      },
    ],
  },
  cust_55555: {
    customer_id: "cust_55555",
    points_balance: 12300,
    tier: "platinum",
    points_to_next_tier: 0,
    lifetime_points: 24500,
    recent_transactions: [
      {
        id: "txn_200",
        type: "earned",
        points: 320,
        description: "Order #DD-91200 - Le Petit Bistro",
        date: "2026-03-26T11:45:00Z",
      },
      {
        id: "txn_199",
        type: "redeemed",
        points: -1000,
        description: "Redeemed $10.00 discount on Order #DD-91100",
        date: "2026-03-25T20:30:00Z",
      },
      {
        id: "txn_198",
        type: "bonus",
        points: 1000,
        description: "Platinum tier monthly bonus",
        date: "2026-03-01T00:00:00Z",
      },
    ],
  },
};

let transactionCounter = 300;

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockGetActivePromotions(category, limit) {
  let results = [...MOCK_PROMOTIONS];
  if (category) {
    results = results.filter((p) => p.category === category);
  }
  results = results.slice(0, limit);
  return { promotions: results, total_count: results.length };
}

function mockValidatePromoCode(promoCode, orderTotal, restaurantId) {
  const promo = PROMO_BY_CODE[promoCode];
  if (!promo) {
    return {
      valid: false,
      discount_amount: 0,
      new_total: orderTotal,
      promo_details: null,
      reason_if_invalid: `Promo code '${promoCode}' was not found.`,
    };
  }

  // Check minimum order amount
  if (promo.min_order_amount > 0 && orderTotal < promo.min_order_amount) {
    return {
      valid: false,
      discount_amount: 0,
      new_total: orderTotal,
      promo_details: null,
      reason_if_invalid: `Minimum order amount of $${promo.min_order_amount.toFixed(2)} not met. Your order total is $${orderTotal.toFixed(2)}.`,
    };
  }

  // Check restaurant eligibility
  if (
    promo.applicable_restaurants.length > 0 &&
    restaurantId &&
    !promo.applicable_restaurants.includes(restaurantId)
  ) {
    return {
      valid: false,
      discount_amount: 0,
      new_total: orderTotal,
      promo_details: null,
      reason_if_invalid: `This promo code is only valid at specific restaurants. The selected restaurant is not eligible.`,
    };
  }

  // Calculate discount
  let discountAmount = 0;
  switch (promo.discount_type) {
    case "percentage":
      discountAmount = Math.round(orderTotal * (promo.discount_value / 100) * 100) / 100;
      break;
    case "fixed":
      discountAmount = promo.discount_value;
      break;
    case "free_delivery":
      discountAmount = 4.99; // simulated delivery fee
      break;
    case "bogo":
      discountAmount = Math.round(orderTotal * 0.33 * 100) / 100; // approximate 1-of-3 free
      break;
  }

  const newTotal = Math.round((orderTotal - discountAmount) * 100) / 100;

  return {
    valid: true,
    discount_amount: discountAmount,
    new_total: Math.max(newTotal, 0),
    promo_details: {
      id: promo.id,
      title: promo.title,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
    },
    reason_if_invalid: null,
  };
}

function mockGetLoyaltyPoints(customerId) {
  const customer = MOCK_CUSTOMERS[customerId];
  if (!customer) {
    return {
      error: true,
      message: `No customer found with ID '${customerId}'.`,
    };
  }
  return { ...customer };
}

function mockRedeemLoyaltyPoints(customerId, pointsToRedeem, orderId) {
  const customer = MOCK_CUSTOMERS[customerId];
  if (!customer) {
    return {
      success: false,
      discount_amount: 0,
      remaining_points: 0,
      transaction_id: null,
      error_message: `No customer found with ID '${customerId}'.`,
    };
  }

  if (pointsToRedeem < 100) {
    return {
      success: false,
      discount_amount: 0,
      remaining_points: customer.points_balance,
      transaction_id: null,
      error_message: "Minimum redemption is 100 points.",
    };
  }

  if (pointsToRedeem > customer.points_balance) {
    return {
      success: false,
      discount_amount: 0,
      remaining_points: customer.points_balance,
      transaction_id: null,
      error_message: `Insufficient points. You have ${customer.points_balance.toLocaleString()} points but attempted to redeem ${pointsToRedeem.toLocaleString()}.`,
    };
  }

  // 100 points = $1
  const discountAmount = Math.round((pointsToRedeem / 100) * 100) / 100;
  customer.points_balance -= pointsToRedeem;

  const txnId = `txn_${++transactionCounter}`;
  customer.recent_transactions.unshift({
    id: txnId,
    type: "redeemed",
    points: -pointsToRedeem,
    description: `Redeemed $${discountAmount.toFixed(2)} discount on Order #${orderId}`,
    date: new Date().toISOString(),
  });

  return {
    success: true,
    discount_amount: discountAmount,
    remaining_points: customer.points_balance,
    transaction_id: txnId,
  };
}

// ---------------------------------------------------------------------------
// Live API helpers (when MOCK_MODE=false)
// ---------------------------------------------------------------------------

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "doordash-promotions",
  version: "1.0.0",
});

// --- Tool 1: get_active_promotions -------------------------------------------

server.tool(
  "get_active_promotions",
  "List currently active DoorDash promotions. Optionally filter by category (new_user, returning, seasonal, restaurant_specific) and limit results.",
  {
    category: z
      .enum(["new_user", "returning", "seasonal", "restaurant_specific"])
      .optional()
      .describe(
        "Filter by promotion category: new_user, returning, seasonal, or restaurant_specific"
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of promotions to return (default 10)"),
  },
  async ({ category, limit }) => {
    let data;
    if (MOCK_MODE) {
      data = mockGetActivePromotions(category, limit);
    } else {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (limit) params.set("limit", String(limit));
      const qs = params.toString();
      data = await apiGet(`/promotions/active${qs ? `?${qs}` : ""}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// --- Tool 2: validate_promo_code ---------------------------------------------

server.tool(
  "validate_promo_code",
  "Validate a DoorDash promo code against an order. Returns whether the code is valid, the discount amount, and the new order total.",
  {
    promo_code: z.string().describe("The promotion code to validate"),
    order_total: z
      .number()
      .describe("Current order subtotal before discount (in dollars)"),
    restaurant_id: z
      .string()
      .optional()
      .describe("Restaurant ID to check restaurant-specific promos"),
    customer_id: z
      .string()
      .describe("Customer ID to check usage limits and eligibility"),
  },
  async ({ promo_code, order_total, restaurant_id, customer_id }) => {
    let data;
    if (MOCK_MODE) {
      data = mockValidatePromoCode(promo_code, order_total, restaurant_id);
    } else {
      data = await apiPost("/promotions/validate", {
        promo_code,
        order_total,
        restaurant_id,
        customer_id,
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// --- Tool 3: get_loyalty_points ----------------------------------------------

server.tool(
  "get_loyalty_points",
  "Get a DoorDash customer's loyalty points balance, tier status (silver/gold/platinum/dashpass), and recent transaction history.",
  {
    customer_id: z.string().describe("Unique identifier of the customer"),
  },
  async ({ customer_id }) => {
    let data;
    if (MOCK_MODE) {
      data = mockGetLoyaltyPoints(customer_id);
    } else {
      data = await apiGet(`/loyalty/points/${encodeURIComponent(customer_id)}`);
    }

    if (data.error) {
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// --- Tool 4: redeem_loyalty_points -------------------------------------------

server.tool(
  "redeem_loyalty_points",
  "Redeem a customer's DoorDash loyalty points for a discount on an order. Conversion rate: 100 points = $1.00. Minimum redemption is 100 points.",
  {
    customer_id: z.string().describe("Customer whose points to redeem"),
    points_to_redeem: z
      .number()
      .int()
      .min(100)
      .describe(
        "Number of points to redeem (minimum 100, must be a positive integer)"
      ),
    order_id: z
      .string()
      .describe("Order to apply the points discount to"),
  },
  async ({ customer_id, points_to_redeem, order_id }) => {
    let data;
    if (MOCK_MODE) {
      data = mockRedeemLoyaltyPoints(customer_id, points_to_redeem, order_id);
    } else {
      data = await apiPost("/loyalty/redeem", {
        customer_id,
        points_to_redeem,
        order_id,
      });
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      isError: !data.success && data.error_message ? true : undefined,
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `DoorDash Promotions MCP Server running (MOCK_MODE=${MOCK_MODE})`
  );
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});

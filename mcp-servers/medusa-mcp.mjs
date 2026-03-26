#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const MEDUSA_URL = process.env.MEDUSA_URL || "http://localhost:9000";
const MOCK_MODE = (process.env.MOCK_MODE || "true").toLowerCase() === "true";
const DELIVERY_FEE_CENTS = 499; // $4.99 flat delivery fee

// ---------------------------------------------------------------------------
// Helpers – HTTP
// ---------------------------------------------------------------------------
async function medusaFetch(path, options = {}) {
  const url = `${MEDUSA_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Medusa API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Mock-mode in-memory state
// ---------------------------------------------------------------------------
let mockOrderCounter = 0;
let mockCartCounter = 0;
const mockOrders = new Map();
const mockCarts = new Map();

const PROMO_CODES = {
  DASHPASS: { pct: 0, flat: 0, desc: "Free delivery with DashPass", freeDelivery: true },
  WELCOME20: { pct: 20, flat: 0, desc: "20% off your first order (up to $10)", maxDiscount: 1000 },
  SAVE5: { pct: 0, flat: 500, desc: "$5 off orders over $20", minOrder: 2000 },
  BOGO50: { pct: 50, flat: 0, desc: "50% off second item", maxDiscount: 1500 },
  FREEDELIVERY: { pct: 0, flat: 0, desc: "Free delivery on this order", freeDelivery: true },
  LUNCH15: { pct: 15, flat: 0, desc: "15% off lunch orders", maxDiscount: 800 },
};

// Realistic menu items with prices (cents) used when variant_id is absent
const MENU_PRICES = {
  "dragon roll": 1699,
  "spicy tuna roll": 1499,
  "california roll": 1299,
  "chicken teriyaki": 1599,
  "miso soup": 499,
  "edamame": 599,
  "classic smash burger": 1399,
  "bacon bbq burger": 1599,
  "truffle fries": 899,
  "milkshake": 799,
  "margherita pizza": 1499,
  "pepperoni pizza": 1599,
  "garlic knots": 699,
  "caesar salad": 1099,
  "pad thai": 1499,
  "green curry": 1599,
  "spring rolls": 799,
  "mango sticky rice": 899,
  "butter chicken": 1699,
  "chicken tikka masala": 1799,
  "naan bread": 399,
  "samosa": 599,
  "fish tacos": 1399,
  "burrito bowl": 1299,
  "chips and guac": 799,
  "churros": 699,
  "big mac meal": 1099,
  "chicken nuggets": 899,
  "fries": 499,
  "mcflurry": 599,
};

function lookupPrice(name) {
  const key = name.toLowerCase().trim();
  if (MENU_PRICES[key]) return MENU_PRICES[key];
  // Fallback: hash the name to a price between $7.99 and $24.99
  let hash = 0;
  for (const ch of key) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return 799 + Math.abs(hash) % 1700;
}

function padId(n) {
  return String(n).padStart(3, "0");
}

function nowISO() {
  return new Date().toISOString();
}

function generateOrderId() {
  mockOrderCounter++;
  const d = new Date();
  const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `ORD-${ds}-${padId(mockOrderCounter)}`;
}

function generateCartId() {
  mockCartCounter++;
  return `CART-${padId(mockCartCounter)}`;
}

function estimatedDelivery() {
  const mins = 25 + Math.floor(Math.random() * 20); // 25-44 min
  const eta = new Date(Date.now() + mins * 60_000);
  return { minutes: mins, eta: eta.toISOString() };
}

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

function mockCreateOrder({ restaurant_id, items, delivery_address, customer_email }) {
  const orderId = generateOrderId();
  const orderItems = items.map((it) => {
    const unitPrice = lookupPrice(it.name);
    return {
      name: it.name,
      quantity: it.quantity,
      variant_id: it.variant_id || null,
      unit_price: unitPrice,
      total: unitPrice * it.quantity,
    };
  });
  const subtotal = orderItems.reduce((s, i) => s + i.total, 0);
  const delivery = estimatedDelivery();

  const order = {
    order_id: orderId,
    restaurant_id,
    status: "confirmed",
    items: orderItems,
    subtotal,
    delivery_fee: DELIVERY_FEE_CENTS,
    total: subtotal + DELIVERY_FEE_CENTS,
    delivery_address,
    customer_email: customer_email || null,
    estimated_delivery: delivery,
    timestamps: {
      created: nowISO(),
      confirmed: nowISO(),
      preparing: null,
      picked_up: null,
      delivered: null,
      cancelled: null,
    },
  };
  mockOrders.set(orderId, order);

  return {
    order_id: orderId,
    total: order.total,
    total_formatted: `$${(order.total / 100).toFixed(2)}`,
    status: "confirmed",
    estimated_delivery_time: `${delivery.minutes} minutes`,
    estimated_delivery_eta: delivery.eta,
  };
}

function mockGetOrderStatus({ order_id }) {
  const order = mockOrders.get(order_id);
  if (!order) {
    return { error: true, message: `Order ${order_id} not found` };
  }
  return {
    order_id: order.order_id,
    status: order.status,
    items: order.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit_price_formatted: `$${(i.unit_price / 100).toFixed(2)}`,
      total_formatted: `$${(i.total / 100).toFixed(2)}`,
    })),
    subtotal_formatted: `$${(order.subtotal / 100).toFixed(2)}`,
    delivery_fee_formatted: `$${(order.delivery_fee / 100).toFixed(2)}`,
    total_formatted: `$${(order.total / 100).toFixed(2)}`,
    delivery_address: order.delivery_address,
    timestamps: order.timestamps,
  };
}

function mockCancelOrder({ order_id, reason }) {
  const order = mockOrders.get(order_id);
  if (!order) {
    return { success: false, message: `Order ${order_id} not found`, refund_eligible: false, refund_amount: 0 };
  }
  if (order.status !== "confirmed" && order.status !== "preparing") {
    return {
      success: false,
      message: `Cannot cancel order in '${order.status}' status. Only 'confirmed' or 'preparing' orders can be cancelled.`,
      refund_eligible: false,
      refund_amount: 0,
    };
  }
  const refundAmount = order.status === "confirmed" ? order.total : Math.round(order.total * 0.8);
  order.status = "cancelled";
  order.timestamps.cancelled = nowISO();

  return {
    success: true,
    order_id: order.order_id,
    message: `Order cancelled successfully.${reason ? ` Reason: ${reason}` : ""}`,
    refund_eligible: true,
    refund_amount: refundAmount,
    refund_amount_formatted: `$${(refundAmount / 100).toFixed(2)}`,
  };
}

function mockApplyPromotion({ cart_id, promo_code }) {
  const cart = mockCarts.get(cart_id);
  if (!cart) {
    return { error: true, message: `Cart ${cart_id} not found` };
  }
  const promo = PROMO_CODES[promo_code.toUpperCase()];
  if (!promo) {
    return { error: true, message: `Invalid promo code: ${promo_code}` };
  }
  if (promo.minOrder && cart.subtotal < promo.minOrder) {
    return {
      error: true,
      message: `Order minimum of $${(promo.minOrder / 100).toFixed(2)} not met for code ${promo_code}`,
    };
  }

  let discount = 0;
  if (promo.flat > 0) {
    discount = promo.flat;
  }
  if (promo.pct > 0) {
    discount = Math.round(cart.subtotal * (promo.pct / 100));
    if (promo.maxDiscount) discount = Math.min(discount, promo.maxDiscount);
  }
  if (promo.freeDelivery) {
    cart.delivery_fee = 0;
  }

  cart.discount = discount;
  cart.promo_code = promo_code.toUpperCase();
  cart.total = Math.max(0, cart.subtotal + cart.delivery_fee - discount);

  return {
    discount_amount: discount,
    discount_amount_formatted: `$${(discount / 100).toFixed(2)}`,
    new_total: cart.total,
    new_total_formatted: `$${(cart.total / 100).toFixed(2)}`,
    promo_description: promo.desc,
  };
}

function mockManageCart({ action, cart_id, item }) {
  let cart;
  if (cart_id && mockCarts.has(cart_id)) {
    cart = mockCarts.get(cart_id);
  } else if (cart_id && !mockCarts.has(cart_id)) {
    return { error: true, message: `Cart ${cart_id} not found` };
  } else {
    const newId = generateCartId();
    cart = {
      cart_id: newId,
      items: [],
      subtotal: 0,
      delivery_fee: DELIVERY_FEE_CENTS,
      discount: 0,
      promo_code: null,
      total: DELIVERY_FEE_CENTS,
    };
    mockCarts.set(newId, cart);
  }

  const itemName = item.name.toLowerCase().trim();

  if (action === "add") {
    const unitPrice = lookupPrice(item.name);
    const existing = cart.items.find((i) => i.name.toLowerCase() === itemName);
    if (existing) {
      existing.quantity += item.quantity;
      existing.total = existing.unit_price * existing.quantity;
    } else {
      cart.items.push({
        name: item.name,
        quantity: item.quantity,
        variant_id: item.variant_id || null,
        unit_price: unitPrice,
        total: unitPrice * item.quantity,
      });
    }
  } else if (action === "remove") {
    cart.items = cart.items.filter((i) => i.name.toLowerCase() !== itemName);
  } else if (action === "update") {
    const existing = cart.items.find((i) => i.name.toLowerCase() === itemName);
    if (existing) {
      existing.quantity = item.quantity;
      existing.total = existing.unit_price * existing.quantity;
      if (existing.quantity <= 0) {
        cart.items = cart.items.filter((i) => i.name.toLowerCase() !== itemName);
      }
    } else {
      return { error: true, message: `Item '${item.name}' not found in cart ${cart.cart_id}` };
    }
  }

  // Recalculate totals
  cart.subtotal = cart.items.reduce((s, i) => s + i.total, 0);
  cart.total = Math.max(0, cart.subtotal + cart.delivery_fee - cart.discount);

  return {
    cart_id: cart.cart_id,
    items: cart.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit_price_formatted: `$${(i.unit_price / 100).toFixed(2)}`,
      total_formatted: `$${(i.total / 100).toFixed(2)}`,
    })),
    subtotal: cart.subtotal,
    subtotal_formatted: `$${(cart.subtotal / 100).toFixed(2)}`,
    delivery_fee: cart.delivery_fee,
    delivery_fee_formatted: `$${(cart.delivery_fee / 100).toFixed(2)}`,
    total: cart.total,
    total_formatted: `$${(cart.total / 100).toFixed(2)}`,
  };
}

// ---------------------------------------------------------------------------
// Live Medusa implementations
// ---------------------------------------------------------------------------

async function liveCreateOrder({ restaurant_id, items, delivery_address, customer_email }) {
  // Step 1: Create a cart
  const { cart } = await medusaFetch("/store/carts", {
    method: "POST",
    body: JSON.stringify({
      region_id: restaurant_id,
      context: { delivery_address },
    }),
  });

  // Step 2: Add items to cart
  for (const item of items) {
    if (item.variant_id) {
      await medusaFetch(`/store/carts/${cart.id}/line-items`, {
        method: "POST",
        body: JSON.stringify({
          variant_id: item.variant_id,
          quantity: item.quantity,
        }),
      });
    } else {
      throw new Error(`Item '${item.name}' is missing a variant_id, which is required for live orders`);
    }
  }

  // Step 3: Set email if provided
  if (customer_email) {
    await medusaFetch(`/store/carts/${cart.id}`, {
      method: "POST",
      body: JSON.stringify({ email: customer_email }),
    });
  }

  // Step 4: Complete the cart to create an order
  const { type, data } = await medusaFetch(`/store/carts/${cart.id}/complete`, {
    method: "POST",
  });

  if (type === "order") {
    return {
      order_id: data.id,
      total: data.total,
      total_formatted: `$${(data.total / 100).toFixed(2)}`,
      status: "confirmed",
      estimated_delivery_time: `${25 + Math.floor(Math.random() * 20)} minutes`,
    };
  }
  return { error: true, message: "Failed to complete order", details: data };
}

async function liveGetOrderStatus({ order_id }) {
  const { order } = await medusaFetch(`/store/orders/${order_id}`);
  return {
    order_id: order.id,
    status: order.status,
    items: order.items.map((i) => ({
      name: i.title,
      quantity: i.quantity,
      unit_price_formatted: `$${(i.unit_price / 100).toFixed(2)}`,
      total_formatted: `$${((i.unit_price * i.quantity) / 100).toFixed(2)}`,
    })),
    total_formatted: `$${(order.total / 100).toFixed(2)}`,
    timestamps: {
      created: order.created_at,
      updated: order.updated_at,
    },
  };
}

async function liveCancelOrder({ order_id, reason }) {
  // Medusa v2 cancel: POST /admin/orders/:id/cancel (admin route)
  // For store-side we simulate validation
  const { order } = await medusaFetch(`/store/orders/${order_id}`);
  if (order.status !== "pending" && order.status !== "confirmed" && order.status !== "requires_action") {
    return {
      success: false,
      message: `Cannot cancel order in '${order.status}' status`,
      refund_eligible: false,
      refund_amount: 0,
    };
  }
  return {
    success: true,
    order_id: order.id,
    message: `Cancellation request submitted.${reason ? ` Reason: ${reason}` : ""}`,
    refund_eligible: true,
    refund_amount: order.total,
    refund_amount_formatted: `$${(order.total / 100).toFixed(2)}`,
  };
}

async function liveApplyPromotion({ cart_id, promo_code }) {
  const { cart } = await medusaFetch(`/store/carts/${cart_id}/promotions`, {
    method: "POST",
    body: JSON.stringify({ promo_code }),
  });
  const discount = cart.discount_total || 0;
  return {
    discount_amount: discount,
    discount_amount_formatted: `$${(discount / 100).toFixed(2)}`,
    new_total: cart.total,
    new_total_formatted: `$${(cart.total / 100).toFixed(2)}`,
    promo_description: `Applied code: ${promo_code}`,
  };
}

async function liveManageCart({ action, cart_id, item }) {
  let cartId = cart_id;
  if (!cartId) {
    const { cart } = await medusaFetch("/store/carts", {
      method: "POST",
      body: JSON.stringify({}),
    });
    cartId = cart.id;
  }

  if (action === "add" && item.variant_id) {
    await medusaFetch(`/store/carts/${cartId}/line-items`, {
      method: "POST",
      body: JSON.stringify({ variant_id: item.variant_id, quantity: item.quantity }),
    });
  } else if (action === "add" && !item.variant_id) {
    throw new Error(`Item '${item.name}' is missing a variant_id, which is required for live cart operations`);
  } else if (action === "remove") {
    // Need to find line item by variant, then delete
    const { cart } = await medusaFetch(`/store/carts/${cartId}`);
    const lineItem = cart.items?.find((li) => li.title?.toLowerCase() === item.name?.toLowerCase());
    if (lineItem) {
      await medusaFetch(`/store/carts/${cartId}/line-items/${lineItem.id}`, { method: "DELETE" });
    }
  } else if (action === "update" && item.variant_id) {
    const { cart } = await medusaFetch(`/store/carts/${cartId}`);
    const lineItem = cart.items?.find((li) => li.variant_id === item.variant_id);
    if (lineItem) {
      await medusaFetch(`/store/carts/${cartId}/line-items/${lineItem.id}`, {
        method: "POST",
        body: JSON.stringify({ quantity: item.quantity }),
      });
    }
  } else if (action === "update" && !item.variant_id) {
    throw new Error(`Item '${item.name}' is missing a variant_id, which is required for live cart updates`);
  }

  const { cart } = await medusaFetch(`/store/carts/${cartId}`);
  return {
    cart_id: cart.id,
    items: (cart.items || []).map((li) => ({
      name: li.title,
      quantity: li.quantity,
      unit_price_formatted: `$${(li.unit_price / 100).toFixed(2)}`,
      total_formatted: `$${((li.unit_price * li.quantity) / 100).toFixed(2)}`,
    })),
    subtotal: cart.subtotal,
    subtotal_formatted: `$${(cart.subtotal / 100).toFixed(2)}`,
    delivery_fee: DELIVERY_FEE_CENTS,
    delivery_fee_formatted: `$${(DELIVERY_FEE_CENTS / 100).toFixed(2)}`,
    total: (cart.total || 0) + DELIVERY_FEE_CENTS,
    total_formatted: `$${(((cart.total || 0) + DELIVERY_FEE_CENTS) / 100).toFixed(2)}`,
  };
}

// ---------------------------------------------------------------------------
// Dispatch: mock vs live
// ---------------------------------------------------------------------------
function dispatch(mockFn, liveFn) {
  return (args) => (MOCK_MODE ? mockFn(args) : liveFn(args));
}

const handleCreateOrder = dispatch(mockCreateOrder, liveCreateOrder);
const handleGetOrderStatus = dispatch(mockGetOrderStatus, liveGetOrderStatus);
const handleCancelOrder = dispatch(mockCancelOrder, liveCancelOrder);
const handleApplyPromotion = dispatch(mockApplyPromotion, liveApplyPromotion);
const handleManageCart = dispatch(mockManageCart, liveManageCart);

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "medusa-commerce",
  version: "1.0.0",
  description:
    "DoorDash-style order & commerce service powered by Medusa. Manage carts, create orders, track deliveries, and apply promotions.",
});

// --- Tool: create_order ---------------------------------------------------
server.tool(
  "create_order",
  "Create a new delivery order for a restaurant. Returns order ID, total, status, and estimated delivery time.",
  {
    restaurant_id: z.string().describe("Restaurant identifier (e.g. 'sakura-sushi', 'burger-barn')"),
    items: z
      .array(
        z.object({
          name: z.string().describe("Menu item name"),
          quantity: z.number().int().min(1).describe("Quantity to order"),
          variant_id: z.string().optional().describe("Specific variant ID from product catalog"),
        })
      )
      .min(1)
      .describe("Items to order"),
    delivery_address: z.string().describe("Delivery street address"),
    customer_email: z.string().email().optional().describe("Customer email for order confirmation"),
  },
  async (args) => {
    try {
      const result = await handleCreateOrder(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }], isError: true };
    }
  }
);

// --- Tool: get_order_status -----------------------------------------------
server.tool(
  "get_order_status",
  "Check the current status of an order including items, totals, and state-transition timestamps.",
  {
    order_id: z.string().describe("The order ID (e.g. 'ORD-2026-0326-001')"),
  },
  async (args) => {
    try {
      const result = await handleGetOrderStatus(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }], isError: true };
    }
  }
);

// --- Tool: cancel_order ---------------------------------------------------
server.tool(
  "cancel_order",
  "Cancel an active order. Only orders in 'confirmed' or 'preparing' status can be cancelled. Returns refund eligibility.",
  {
    order_id: z.string().describe("The order ID to cancel"),
    reason: z.string().optional().describe("Reason for cancellation"),
  },
  async (args) => {
    try {
      const result = await handleCancelOrder(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }], isError: true };
    }
  }
);

// --- Tool: apply_promotion ------------------------------------------------
server.tool(
  "apply_promotion",
  "Apply a promo code to a cart. Returns discount amount, new total, and promo description.",
  {
    cart_id: z.string().describe("The cart ID to apply the promotion to"),
    promo_code: z.string().describe("Promo code (e.g. 'WELCOME20', 'DASHPASS', 'FREEDELIVERY')"),
  },
  async (args) => {
    try {
      const result = await handleApplyPromotion(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }], isError: true };
    }
  }
);

// --- Tool: manage_cart ----------------------------------------------------
server.tool(
  "manage_cart",
  "Add, remove, or update items in a cart. Creates a new cart if no cart_id is provided.",
  {
    action: z.enum(["add", "remove", "update"]).describe("Cart operation: 'add', 'remove', or 'update' an item"),
    cart_id: z.string().optional().describe("Existing cart ID. Omit to create a new cart."),
    item: z
      .object({
        name: z.string().describe("Menu item name"),
        quantity: z.number().int().min(0).describe("Quantity (0 removes the item when using 'update')"),
        variant_id: z.string().optional().describe("Specific variant ID from product catalog"),
      })
      .describe("Item to add, remove, or update"),
  },
  async (args) => {
    try {
      const result = await handleManageCart(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now listening on stdio
}

main().catch((err) => {
  console.error("Fatal error starting Medusa MCP server:", err);
  process.exit(1);
});

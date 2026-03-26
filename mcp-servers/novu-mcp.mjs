#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NOVU_URL = process.env.NOVU_URL || "http://localhost:4000";
const NOVU_API_KEY = process.env.NOVU_API_KEY || "";
const MOCK_MODE = (process.env.MOCK_MODE ?? "true") === "true";

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let notifCounter = 0;

/** @type {Map<string, object>} */
const notifications = new Map();

/** @type {Map<string, object>} */
const subscriberPreferences = new Map();

function nextNotifId() {
  notifCounter += 1;
  return `NOTIF-${String(notifCounter).padStart(4, "0")}`;
}

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Novu REST helpers
// ---------------------------------------------------------------------------

async function novuFetch(path, options = {}) {
  const url = `${NOVU_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `ApiKey ${NOVU_API_KEY}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Novu API error ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Notification templates (DoorDash themed)
// ---------------------------------------------------------------------------

const ORDER_TEMPLATES = {
  order_confirmed: {
    title: "Order Confirmed!",
    body: "Your order #{order_id} has been confirmed and is being prepared.",
  },
  dasher_assigned: {
    title: "Dasher Assigned",
    body: "A Dasher has been assigned to pick up your order #{order_id}.",
  },
  order_picked_up: {
    title: "Order Picked Up",
    body: "Your Dasher has picked up your order #{order_id} and is on the way!",
  },
  arriving_soon: {
    title: "Arriving Soon!",
    body: "Your Dasher is almost there with order #{order_id}. Get ready!",
  },
  order_delivered: {
    title: "Order Delivered",
    body: "Your order #{order_id} has been delivered. Enjoy your meal!",
  },
  order_cancelled: {
    title: "Order Cancelled",
    body: "Your order #{order_id} has been cancelled. A refund will be processed.",
  },
};

function renderTemplate(template, vars) {
  let text = template;
  for (const [key, value] of Object.entries(vars)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`#\\{${escapedKey}\\}`, "g"), () => String(value));
  }
  return text;
}

// ---------------------------------------------------------------------------
// Default subscriber preferences
// ---------------------------------------------------------------------------

function defaultPreferences() {
  return {
    order_updates: { push: true, sms: false, email: true },
    promotions: { push: true, sms: false, email: true },
    account_alerts: { push: true, sms: true, email: true },
  };
}

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

function mockSendOrderNotification({ subscriber_id, event_type, order_id, channels, data }) {
  const id = nextNotifId();
  const tmpl = ORDER_TEMPLATES[event_type];
  const title = renderTemplate(tmpl.title, { order_id, ...data });
  const body = renderTemplate(tmpl.body, { order_id, ...data });

  const channelStatuses = channels.map((ch) => ({
    channel: ch,
    status: "sent",
    timestamp: now(),
  }));

  notifications.set(id, {
    notification_id: id,
    subscriber_id,
    event_type,
    order_id,
    title,
    body,
    channels: channelStatuses,
    status: "sent",
    created_at: now(),
    data: data || {},
  });

  return {
    notification_id: id,
    channels_sent: channels,
    status: "sent",
  };
}

function mockSendDeliveryUpdate({ subscriber_id, order_id, message, eta_minutes }) {
  const id = nextNotifId();

  const record = {
    notification_id: id,
    subscriber_id,
    order_id,
    type: "delivery_update",
    message,
    eta_minutes: eta_minutes ?? null,
    channels: [{ channel: "push", status: "sent", timestamp: now() }],
    status: "sent",
    created_at: now(),
  };

  notifications.set(id, record);

  return {
    notification_id: id,
    status: "sent",
  };
}

function mockSendPromotional({ subscriber_id, title, message, promo_code, channels }) {
  const id = nextNotifId();
  const isBroadcast = !subscriber_id;

  const channelStatuses = channels.map((ch) => ({
    channel: ch,
    status: "sent",
    timestamp: now(),
  }));

  const record = {
    notification_id: id,
    subscriber_id: subscriber_id || "ALL",
    type: "promotional",
    title,
    message,
    promo_code: promo_code || null,
    channels: channelStatuses,
    status: "sent",
    recipients_count: isBroadcast ? 150 : 1,
    created_at: now(),
  };

  notifications.set(id, record);

  return {
    notification_id: id,
    recipients_count: record.recipients_count,
    status: "sent",
  };
}

function mockGetNotificationStatus({ notification_id }) {
  const record = notifications.get(notification_id);
  if (!record) {
    return {
      notification_id,
      status: "not_found",
      channels: [],
    };
  }

  // Simulate realistic multi-channel delivery progression
  const channels = (record.channels || []).map((ch) => {
    const age = Date.now() - new Date(ch.timestamp).getTime();
    let status = "sent";
    if (age > 5000) status = "delivered";
    if (age > 15000) status = "read";
    return { channel: ch.channel, status, timestamp: ch.timestamp };
  });

  return {
    notification_id,
    status: record.status,
    channels,
  };
}

function mockManageSubscriberPreferences({ action, subscriber_id, preferences }) {
  if (action === "get") {
    const prefs = subscriberPreferences.get(subscriber_id) || defaultPreferences();
    return { subscriber_id, preferences: prefs };
  }

  // action === "update"
  const existing = subscriberPreferences.get(subscriber_id) || defaultPreferences();
  const merged = { ...existing };
  for (const category of Object.keys(preferences || {})) {
    merged[category] = { ...(merged[category] || {}), ...preferences[category] };
  }
  subscriberPreferences.set(subscriber_id, merged);
  return { subscriber_id, preferences: merged };
}

// ---------------------------------------------------------------------------
// Live (Novu API) implementations
// ---------------------------------------------------------------------------

async function liveSendOrderNotification({ subscriber_id, event_type, order_id, channels, data }) {
  const tmpl = ORDER_TEMPLATES[event_type];
  const title = renderTemplate(tmpl.title, { order_id, ...data });
  const body = renderTemplate(tmpl.body, { order_id, ...data });

  const result = await novuFetch("/v1/events/trigger", {
    method: "POST",
    body: JSON.stringify({
      name: `order_${event_type}`,
      to: { subscriberId: subscriber_id },
      payload: {
        order_id,
        event_type,
        title,
        body,
        channels,
        ...(data || {}),
      },
    }),
  });

  return {
    notification_id: result.data?.id || result.data?.transactionId || "unknown",
    channels_sent: channels,
    status: result.data?.acknowledged ? "sent" : "queued",
  };
}

async function liveSendDeliveryUpdate({ subscriber_id, order_id, message, eta_minutes }) {
  const result = await novuFetch("/v1/events/trigger", {
    method: "POST",
    body: JSON.stringify({
      name: "delivery_update",
      to: { subscriberId: subscriber_id },
      payload: { order_id, message, eta_minutes },
    }),
  });

  return {
    notification_id: result.data?.id || result.data?.transactionId || "unknown",
    status: result.data?.acknowledged ? "sent" : "queued",
  };
}

async function liveSendPromotional({ subscriber_id, title, message, promo_code, channels }) {
  const to = subscriber_id ? { subscriberId: subscriber_id } : { all: true };

  const result = await novuFetch("/v1/events/trigger", {
    method: "POST",
    body: JSON.stringify({
      name: "promotional",
      to,
      payload: { title, message, promo_code, channels },
    }),
  });

  return {
    notification_id: result.data?.id || result.data?.transactionId || "unknown",
    recipients_count: subscriber_id ? 1 : -1,
    status: result.data?.acknowledged ? "sent" : "queued",
  };
}

async function liveGetNotificationStatus({ notification_id }) {
  const result = await novuFetch(`/v1/notifications?page=0&transactionId=${encodeURIComponent(notification_id)}`);
  const items = result.data || [];

  if (items.length === 0) {
    return { notification_id, status: "not_found", channels: [] };
  }

  const channels = items.map((item) => ({
    channel: item.channel || "unknown",
    status: item.status || "sent",
    timestamp: item.createdAt || now(),
  }));

  return { notification_id, status: "sent", channels };
}

async function liveManageSubscriberPreferences({ action, subscriber_id, preferences }) {
  if (action === "get") {
    const result = await novuFetch(`/v1/subscribers/${encodeURIComponent(subscriber_id)}/preferences`);
    return { subscriber_id, preferences: result.data || {} };
  }

  const result = await novuFetch(`/v1/subscribers/${encodeURIComponent(subscriber_id)}/preferences`, {
    method: "PUT",
    body: JSON.stringify(preferences),
  });

  return { subscriber_id, preferences: result.data || {} };
}

// ---------------------------------------------------------------------------
// Dispatcher – picks mock vs live
// ---------------------------------------------------------------------------

function dispatch(mockFn, liveFn) {
  return (args) => (MOCK_MODE ? mockFn(args) : liveFn(args));
}

const handleSendOrderNotification = dispatch(mockSendOrderNotification, liveSendOrderNotification);
const handleSendDeliveryUpdate = dispatch(mockSendDeliveryUpdate, liveSendDeliveryUpdate);
const handleSendPromotional = dispatch(mockSendPromotional, liveSendPromotional);
const handleGetNotificationStatus = dispatch(mockGetNotificationStatus, liveGetNotificationStatus);
const handleManageSubscriberPreferences = dispatch(
  mockManageSubscriberPreferences,
  liveManageSubscriberPreferences,
);

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "novu-notifications",
  version: "1.0.0",
  description:
    "DoorDash notification service powered by Novu. Send order updates, delivery alerts, and promotional messages.",
});

// --- Tool 1: send_order_notification ---
server.tool(
  "send_order_notification",
  "Send a notification for order events (confirmed, picked up, delivered, etc.)",
  {
    subscriber_id: z.string().describe('Customer ID (e.g. "CUST-42")'),
    event_type: z
      .enum([
        "order_confirmed",
        "dasher_assigned",
        "order_picked_up",
        "arriving_soon",
        "order_delivered",
        "order_cancelled",
      ])
      .describe("Type of order event"),
    order_id: z.string().describe("Order identifier"),
    channels: z
      .array(z.enum(["push", "sms", "email", "in_app"]))
      .optional()
      .default(["push", "email"])
      .describe("Notification channels to use"),
    data: z
      .record(z.any())
      .optional()
      .default({})
      .describe("Additional data (dasher_name, eta, etc.)"),
  },
  async (args) => {
    try {
      const result = await handleSendOrderNotification(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// --- Tool 2: send_delivery_update ---
server.tool(
  "send_delivery_update",
  "Send a real-time delivery status push notification",
  {
    subscriber_id: z.string().describe("Customer ID"),
    order_id: z.string().describe("Order identifier"),
    message: z.string().describe('Delivery message (e.g. "Your dasher is 5 min away")'),
    eta_minutes: z.number().optional().describe("Estimated time of arrival in minutes"),
  },
  async (args) => {
    try {
      const result = await handleSendDeliveryUpdate(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// --- Tool 3: send_promotional ---
server.tool(
  "send_promotional",
  "Send a targeted promotional notification to a subscriber or broadcast to all",
  {
    subscriber_id: z
      .string()
      .optional()
      .describe("Customer ID (omit to broadcast to all subscribers)"),
    title: z.string().describe("Promotion title"),
    message: z.string().describe("Promotion message body"),
    promo_code: z.string().optional().describe("Promotional code"),
    channels: z
      .array(z.enum(["push", "sms", "email", "in_app"]))
      .optional()
      .default(["push", "email"])
      .describe("Notification channels to use"),
  },
  async (args) => {
    try {
      const result = await handleSendPromotional(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// --- Tool 4: get_notification_status ---
server.tool(
  "get_notification_status",
  "Check delivery status of a previously sent notification",
  {
    notification_id: z.string().describe("Notification ID to look up"),
  },
  async (args) => {
    try {
      const result = await handleGetNotificationStatus(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// --- Tool 5: manage_subscriber_preferences ---
server.tool(
  "manage_subscriber_preferences",
  "Get or update notification preferences for a subscriber",
  {
    action: z.enum(["get", "update"]).describe('Action to perform: "get" or "update"'),
    subscriber_id: z.string().describe("Customer ID"),
    preferences: z
      .object({
        order_updates: z
          .object({
            push: z.boolean().optional(),
            sms: z.boolean().optional(),
            email: z.boolean().optional(),
          })
          .optional(),
        promotions: z
          .object({
            push: z.boolean().optional(),
            sms: z.boolean().optional(),
            email: z.boolean().optional(),
          })
          .optional(),
        account_alerts: z
          .object({
            push: z.boolean().optional(),
            sms: z.boolean().optional(),
            email: z.boolean().optional(),
          })
          .optional(),
      })
      .optional()
      .describe("Preference categories to update (required for update action)"),
  },
  async (args) => {
    try {
      const result = await handleManageSubscriberPreferences(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Novu MCP server running (mock_mode=${MOCK_MODE}, novu_url=${NOVU_URL})`,
  );
}

main().catch((err) => {
  console.error("Fatal error starting Novu MCP server:", err);
  process.exit(1);
});

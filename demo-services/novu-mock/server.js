const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.NOVU_MOCK_PORT || 4000;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
const subscribers = new Map();
const notifications = [];

// ---------------------------------------------------------------------------
// Sample DoorDash-themed notification templates
// ---------------------------------------------------------------------------
const templates = {
  "order-confirmed": {
    name: "Order Confirmed",
    subject: "Your DoorDash order has been confirmed!",
    body: "Hi {{firstName}}, your order #{{orderId}} from {{restaurantName}} has been confirmed and is being prepared.",
  },
  "order-picked-up": {
    name: "Order Picked Up",
    subject: "Your Dasher has picked up your order!",
    body: "Great news, {{firstName}}! Your Dasher {{dasherName}} has picked up your order from {{restaurantName}}.",
  },
  "order-delivered": {
    name: "Order Delivered",
    subject: "Your order has been delivered!",
    body: "{{firstName}}, your order #{{orderId}} from {{restaurantName}} has been delivered. Enjoy your meal!",
  },
  "dasher-assigned": {
    name: "Dasher Assigned",
    subject: "A Dasher is on the way to the restaurant!",
    body: "{{firstName}}, {{dasherName}} has been assigned to your order and is heading to {{restaurantName}}.",
  },
  "promo-offer": {
    name: "Promotional Offer",
    subject: "Special deal just for you!",
    body: "Hi {{firstName}}, enjoy {{discountPercent}}% off your next order from {{restaurantName}}! Use code: {{promoCode}}.",
  },
  "delivery-eta-update": {
    name: "Delivery ETA Update",
    subject: "Updated delivery time for your order",
    body: "{{firstName}}, your estimated delivery time for order #{{orderId}} has been updated to {{eta}}.",
  },
};

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "novu-mock", timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------
app.post("/v1/subscribers", (req, res) => {
  const { subscriberId, firstName, lastName, email, phone } = req.body;
  if (!subscriberId) {
    return res.status(400).json({ error: "subscriberId is required" });
  }
  const subscriber = {
    subscriberId,
    firstName: firstName || "DoorDash",
    lastName: lastName || "Customer",
    email: email || `${subscriberId}@example.com`,
    phone: phone || "+1-555-0100",
    createdAt: new Date().toISOString(),
  };
  subscribers.set(subscriberId, subscriber);
  res.status(201).json({ data: subscriber });
});

app.get("/v1/subscribers/:subscriberId", (req, res) => {
  const subscriber = subscribers.get(req.params.subscriberId);
  if (!subscriber) {
    return res.status(404).json({ error: "Subscriber not found" });
  }
  res.json({ data: subscriber });
});

app.get("/v1/subscribers", (_req, res) => {
  res.json({ data: Array.from(subscribers.values()), totalCount: subscribers.size });
});

// ---------------------------------------------------------------------------
// Trigger notification
// ---------------------------------------------------------------------------
app.post("/v1/events/trigger", (req, res) => {
  const { name, to, payload } = req.body;

  if (!name || !to) {
    return res.status(400).json({ error: "name and to fields are required" });
  }

  const template = templates[name];
  const subscriberId = typeof to === "string" ? to : to.subscriberId;
  const subscriber = subscribers.get(subscriberId);

  let renderedBody = template
    ? template.body
    : `Notification "${name}" sent to ${subscriberId}`;

  // Simple template variable replacement
  if (payload && template) {
    const merged = { ...(subscriber || {}), ...payload };
    renderedBody = template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => merged[key] || `{{${key}}}`);
  }

  const notification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    transactionId: `txn-${Date.now()}`,
    templateName: name,
    subscriberId,
    payload: payload || {},
    renderedBody,
    channel: "in_app",
    status: "sent",
    createdAt: new Date().toISOString(),
  };

  notifications.push(notification);

  console.log(`[NOVU-MOCK] Notification sent: ${name} -> ${subscriberId}`);

  res.status(201).json({
    data: {
      acknowledged: true,
      status: "processed",
      transactionId: notification.transactionId,
    },
  });
});

// ---------------------------------------------------------------------------
// Bulk trigger
// ---------------------------------------------------------------------------
app.post("/v1/events/trigger/bulk", (req, res) => {
  const { events } = req.body;
  if (!events || !Array.isArray(events)) {
    return res.status(400).json({ error: "events array is required" });
  }

  const results = events.map((event) => {
    const subscriberId = typeof event.to === "string" ? event.to : event.to?.subscriberId;
    const notification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      transactionId: `txn-${Date.now()}`,
      templateName: event.name,
      subscriberId,
      payload: event.payload || {},
      channel: "in_app",
      status: "sent",
      createdAt: new Date().toISOString(),
    };
    notifications.push(notification);
    return { acknowledged: true, status: "processed", transactionId: notification.transactionId };
  });

  res.status(201).json({ data: results });
});

// ---------------------------------------------------------------------------
// List notifications
// ---------------------------------------------------------------------------
app.get("/v1/notifications", (req, res) => {
  const { subscriberId, limit = 20, offset = 0 } = req.query;
  let filtered = notifications;
  if (subscriberId) {
    filtered = filtered.filter((n) => n.subscriberId === subscriberId);
  }
  const paged = filtered.slice(Number(offset), Number(offset) + Number(limit));
  res.json({ data: paged, totalCount: filtered.length });
});

// ---------------------------------------------------------------------------
// List available templates
// ---------------------------------------------------------------------------
app.get("/v1/notification-templates", (_req, res) => {
  const list = Object.entries(templates).map(([key, t]) => ({
    id: key,
    name: t.name,
    subject: t.subject,
  }));
  res.json({ data: list, totalCount: list.length });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[NOVU-MOCK] DoorDash Notification Service running on port ${PORT}`);
  console.log(`[NOVU-MOCK] Available templates: ${Object.keys(templates).join(", ")}`);
});

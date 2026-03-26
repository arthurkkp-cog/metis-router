#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CHATWOOT_URL = process.env.CHATWOOT_URL || "http://localhost:3001";
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || "";
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "1";
const MOCK_MODE = (process.env.MOCK_MODE || "true").toLowerCase() === "true";

// ---------------------------------------------------------------------------
// Helpers – Chatwoot REST calls
// ---------------------------------------------------------------------------
const apiBase = `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}`;
const headers = {
  "Content-Type": "application/json",
  api_access_token: CHATWOOT_API_TOKEN,
};

async function chatwootRequest(path, options = {}) {
  const url = `${apiBase}${path}`;
  const res = await fetch(url, { headers, ...options });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chatwoot API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Mock data store
// ---------------------------------------------------------------------------
let mockConversationCounter = 0;
const mockConversations = new Map();

const TEAM_MAP = {
  order_issues: "Order Issues Team",
  refund_specialists: "Refund Specialists",
  dasher_support: "Dasher Support",
  general: "General Support",
};

// Chatwoot team IDs – override via CHATWOOT_TEAM_ID_<KEY> env vars
const TEAM_ID_MAP = {
  order_issues: Number(process.env.CHATWOOT_TEAM_ID_ORDER_ISSUES) || 1,
  refund_specialists: Number(process.env.CHATWOOT_TEAM_ID_REFUND_SPECIALISTS) || 2,
  dasher_support: Number(process.env.CHATWOOT_TEAM_ID_DASHER_SUPPORT) || 3,
  general: Number(process.env.CHATWOOT_TEAM_ID_GENERAL) || 4,
};

const HELP_ARTICLES = [
  {
    title: "How to request a refund for a missing item",
    content_preview:
      "If an item is missing from your order, open the DoorDash app, go to Orders, select the order, and tap 'Help'. Choose 'Missing Items' and follow the prompts to request a refund.",
    url: "https://help.doordash.com/consumers/s/article/missing-items",
    category: "orders",
    relevance_score: 0.95,
  },
  {
    title: "What to do if your order is late",
    content_preview:
      "If your order hasn't arrived within the estimated delivery window, you can track your Dasher in real-time. If the delay exceeds 15 minutes, you may be eligible for DoorDash credits.",
    url: "https://help.doordash.com/consumers/s/article/late-delivery",
    category: "delivery",
    relevance_score: 0.92,
  },
  {
    title: "How to contact your Dasher",
    content_preview:
      "Once a Dasher has been assigned, tap the Dasher's name on the tracking screen to call or text them directly. You can also leave delivery instructions before the order is picked up.",
    url: "https://help.doordash.com/consumers/s/article/contact-dasher",
    category: "delivery",
    relevance_score: 0.90,
  },
  {
    title: "DoorDash cancellation policy",
    content_preview:
      "You can cancel an order for a full refund before the restaurant starts preparing it. After preparation begins, cancellation fees may apply depending on the order stage.",
    url: "https://help.doordash.com/consumers/s/article/cancellation-policy",
    category: "orders",
    relevance_score: 0.88,
  },
  {
    title: "How to update delivery instructions",
    content_preview:
      "To update delivery instructions, go to your active order, tap 'Delivery Details', and edit the instructions field. You can specify gate codes, building numbers, or leave-at-door preferences.",
    url: "https://help.doordash.com/consumers/s/article/delivery-instructions",
    category: "delivery",
    relevance_score: 0.85,
  },
  {
    title: "How to report a wrong order",
    content_preview:
      "If you received the wrong items, open Help in the app, select the affected order, and choose 'Wrong Order'. Attach photos for faster resolution. Refunds are typically processed within 3-5 business days.",
    url: "https://help.doordash.com/consumers/s/article/wrong-order",
    category: "orders",
    relevance_score: 0.87,
  },
  {
    title: "Understanding DoorDash fees and pricing",
    content_preview:
      "DoorDash charges a delivery fee, service fee, and optional Dasher tip. DashPass members enjoy $0 delivery fees on eligible orders over $12. Fees vary by restaurant and distance.",
    url: "https://help.doordash.com/consumers/s/article/fees-pricing",
    category: "payments",
    relevance_score: 0.82,
  },
  {
    title: "How to manage your DoorDash account",
    content_preview:
      "Update your profile, payment methods, addresses, and notification preferences from the Account section. You can also manage DashPass subscriptions and view order history.",
    url: "https://help.doordash.com/consumers/s/article/manage-account",
    category: "account",
    relevance_score: 0.80,
  },
  {
    title: "DoorDash promotions and credits",
    content_preview:
      "Apply promo codes at checkout to receive discounts. Credits from refunds or promotions are automatically applied to your next order. Check the Promotions tab for current offers.",
    url: "https://help.doordash.com/consumers/s/article/promotions-credits",
    category: "promotions",
    relevance_score: 0.78,
  },
  {
    title: "How to dispute a charge on your account",
    content_preview:
      "If you see an unexpected charge, go to Orders > select the order > Help > 'Charge Issue'. Our support team reviews disputes within 24-48 hours and will issue credits if applicable.",
    url: "https://help.doordash.com/consumers/s/article/dispute-charge",
    category: "payments",
    relevance_score: 0.84,
  },
];

function padId(n) {
  return `CONV-${String(n).padStart(4, "0")}`;
}

function teamForIssueType(issueType) {
  const mapping = {
    order_issue: "order_issues",
    refund_request: "refund_specialists",
    dasher_complaint: "dasher_support",
    restaurant_feedback: "general",
    account_issue: "general",
    other: "general",
  };
  return mapping[issueType] || "general";
}

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

function mockCreateSupportTicket({
  customer_name,
  customer_email,
  issue_type,
  description,
  order_id,
  priority,
}) {
  mockConversationCounter += 1;
  const ticketId = padId(mockConversationCounter);
  const now = new Date().toISOString();
  const team = teamForIssueType(issue_type);

  const conversation = {
    ticket_id: ticketId,
    status: "open",
    assigned_team: TEAM_MAP[team],
    priority: priority || "medium",
    created_at: now,
    customer_name,
    customer_email: customer_email || null,
    issue_type,
    order_id: order_id || null,
    messages: [
      {
        sender: customer_name,
        content: description,
        timestamp: now,
      },
    ],
    assigned_agent: null,
  };

  mockConversations.set(ticketId, conversation);

  return {
    ticket_id: ticketId,
    status: "open",
    assigned_team: TEAM_MAP[team],
    priority: conversation.priority,
    created_at: now,
  };
}

function mockGetConversation({ ticket_id }) {
  const conv = mockConversations.get(ticket_id);
  if (!conv) {
    throw new Error(`Conversation ${ticket_id} not found`);
  }
  return {
    ticket_id: conv.ticket_id,
    status: conv.status,
    messages: conv.messages,
    assigned_agent: conv.assigned_agent,
    priority: conv.priority,
    created_at: conv.created_at,
  };
}

function mockSendMessage({ ticket_id, message, message_type }) {
  const conv = mockConversations.get(ticket_id);
  if (!conv) {
    throw new Error(`Conversation ${ticket_id} not found`);
  }

  const now = new Date().toISOString();
  const type = message_type || "outgoing";
  const sender = type === "activity" ? "System" : "Support Agent";

  conv.messages.push({
    sender,
    content: message,
    timestamp: now,
  });

  return {
    message_id: `MSG-${Date.now()}`,
    ticket_id,
    status: "sent",
  };
}

function mockAssignAgent({ ticket_id, team, agent_id }) {
  const conv = mockConversations.get(ticket_id);
  if (!conv) {
    throw new Error(`Conversation ${ticket_id} not found`);
  }

  if (team) {
    conv.assigned_team = TEAM_MAP[team] || TEAM_MAP.general;
  }
  if (agent_id) {
    conv.assigned_agent = `Agent #${agent_id}`;
  }

  return {
    ticket_id,
    assigned_to: conv.assigned_agent || conv.assigned_team,
    status: "assigned",
  };
}

function mockSearchHelpArticles({ query, category }) {
  let results = [...HELP_ARTICLES];

  if (category) {
    results = results.filter((a) => a.category === category);
  }

  // Simple keyword relevance scoring
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);

  results = results
    .map((article) => {
      const text = `${article.title} ${article.content_preview}`.toLowerCase();
      const matchCount = queryWords.filter((w) => text.includes(w)).length;
      return {
        ...article,
        relevance_score: Math.min(
          1,
          article.relevance_score * (0.5 + 0.5 * (matchCount / queryWords.length))
        ),
      };
    })
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 5);

  return results;
}

// ---------------------------------------------------------------------------
// Live (Chatwoot API) implementations
// ---------------------------------------------------------------------------

async function liveCreateSupportTicket({
  customer_name,
  customer_email,
  issue_type,
  description,
  order_id,
  priority,
}) {
  // Step 1: Search for or create contact
  let contactId;
  if (customer_email) {
    try {
      const searchResult = await chatwootRequest(
        `/contacts/search?q=${encodeURIComponent(customer_email)}`
      );
      if (searchResult.payload && searchResult.payload.length > 0) {
        contactId = searchResult.payload[0].id;
      }
    } catch {
      // Contact not found, will create
    }
  }

  if (!contactId) {
    const contactPayload = {
      name: customer_name,
      ...(customer_email && { email: customer_email }),
    };
    const contact = await chatwootRequest("/contacts", {
      method: "POST",
      body: JSON.stringify(contactPayload),
    });
    contactId = contact.payload?.contact?.id || contact.id;
  }

  // Step 2: Create conversation
  const team = teamForIssueType(issue_type);
  const additionalAttributes = {
    issue_type,
    priority: priority || "medium",
    ...(order_id && { order_id }),
  };

  const conversationPayload = {
    contact_id: contactId,
    message: description,
    team_id: TEAM_ID_MAP[team] || TEAM_ID_MAP.general,
    additional_attributes: additionalAttributes,
    custom_attributes: additionalAttributes,
  };

  const conversation = await chatwootRequest("/conversations", {
    method: "POST",
    body: JSON.stringify(conversationPayload),
  });

  const convId = conversation.id || conversation.payload?.id;

  return {
    ticket_id: String(convId),
    status: "open",
    assigned_team: TEAM_MAP[team],
    priority: priority || "medium",
    created_at: new Date().toISOString(),
  };
}

async function liveGetConversation({ ticket_id }) {
  const conversation = await chatwootRequest(`/conversations/${ticket_id}`);
  const messagesData = await chatwootRequest(
    `/conversations/${ticket_id}/messages`
  );

  const messages = (messagesData.payload || []).map((msg) => ({
    sender: msg.sender?.name || msg.sender?.email || "Unknown",
    content: msg.content || "",
    timestamp: msg.created_at,
  }));

  return {
    ticket_id: String(conversation.id),
    status: conversation.status,
    messages,
    assigned_agent: conversation.meta?.assignee?.name || null,
    priority:
      conversation.additional_attributes?.priority ||
      conversation.custom_attributes?.priority ||
      "medium",
    created_at: conversation.created_at,
  };
}

async function liveSendMessage({ ticket_id, message, message_type }) {
  const typeMap = {
    outgoing: 1,
    activity: 2,
  };

  const payload = {
    content: message,
    message_type: typeMap[message_type || "outgoing"] || 1,
  };

  const result = await chatwootRequest(
    `/conversations/${ticket_id}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );

  return {
    message_id: String(result.id),
    ticket_id,
    status: "sent",
  };
}

async function liveAssignAgent({ ticket_id, team, agent_id }) {
  const payload = {};
  if (agent_id) {
    payload.assignee_id = agent_id;
  }
  if (team) {
    payload.team_id = TEAM_ID_MAP[team] || TEAM_ID_MAP.general;
  }

  await chatwootRequest(`/conversations/${ticket_id}/assignments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    ticket_id,
    assigned_to: agent_id
      ? `Agent #${agent_id}`
      : TEAM_MAP[team] || TEAM_MAP.general,
    status: "assigned",
  };
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "chatwoot-support",
  version: "1.0.0",
});

// Tool 1: create_support_ticket
server.tool(
  "create_support_ticket",
  "Open a new support conversation for a DoorDash customer issue",
  {
    customer_name: z.string().describe("Name of the customer"),
    customer_email: z
      .string()
      .email()
      .optional()
      .describe("Email address of the customer"),
    issue_type: z
      .enum([
        "order_issue",
        "refund_request",
        "dasher_complaint",
        "restaurant_feedback",
        "account_issue",
        "other",
      ])
      .describe("Type of support issue"),
    description: z.string().describe("Description of the issue"),
    order_id: z.string().optional().describe("Related order ID"),
    priority: z
      .enum(["low", "medium", "high", "urgent"])
      .optional()
      .default("medium")
      .describe("Ticket priority level"),
  },
  async (params) => {
    try {
      const result = MOCK_MODE
        ? mockCreateSupportTicket(params)
        : await liveCreateSupportTicket(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: get_conversation
server.tool(
  "get_conversation",
  "Retrieve full conversation history for a support ticket",
  {
    ticket_id: z.string().describe("The ticket/conversation ID"),
  },
  async (params) => {
    try {
      const result = MOCK_MODE
        ? mockGetConversation(params)
        : await liveGetConversation(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: send_message
server.tool(
  "send_message",
  "Send a reply in a support conversation",
  {
    ticket_id: z.string().describe("The ticket/conversation ID"),
    message: z.string().describe("Message content to send"),
    message_type: z
      .enum(["outgoing", "activity"])
      .optional()
      .default("outgoing")
      .describe("Type of message"),
  },
  async (params) => {
    try {
      const result = MOCK_MODE
        ? mockSendMessage(params)
        : await liveSendMessage(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: assign_agent
server.tool(
  "assign_agent",
  "Route or escalate a ticket to a specific agent or team",
  {
    ticket_id: z.string().describe("The ticket/conversation ID"),
    team: z
      .enum(["order_issues", "refund_specialists", "dasher_support", "general"])
      .optional()
      .describe("Team to assign the ticket to"),
    agent_id: z
      .number()
      .optional()
      .describe("Specific agent ID to assign"),
  },
  async (params) => {
    try {
      const result = MOCK_MODE
        ? mockAssignAgent(params)
        : await liveAssignAgent(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: search_help_articles
server.tool(
  "search_help_articles",
  "Search the knowledge base for self-service DoorDash help articles",
  {
    query: z.string().describe("Search query"),
    category: z
      .enum(["orders", "payments", "delivery", "account", "promotions"])
      .optional()
      .describe("Filter articles by category"),
  },
  async (params) => {
    try {
      // search_help_articles always uses mock data since Chatwoot
      // does not have a built-in public help-article search endpoint.
      const result = mockSearchHelpArticles(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Chatwoot MCP server running (mock_mode=${MOCK_MODE}, account=${CHATWOOT_ACCOUNT_ID})`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

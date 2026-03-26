#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MEILISEARCH_URL = process.env.MEILISEARCH_URL || "http://localhost:7700";
const MEILISEARCH_MASTER_KEY = process.env.MEILISEARCH_MASTER_KEY || "demo-master-key";
const MOCK_MODE = process.env.MOCK_MODE === "true";

// ---------------------------------------------------------------------------
// Meilisearch HTTP helpers
// ---------------------------------------------------------------------------

async function meiliRequest(path, options = {}) {
  const url = `${MEILISEARCH_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${MEILISEARCH_MASTER_KEY}`,
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meilisearch ${res.status}: ${body}`);
  }
  return res.json();
}

async function meiliSearch(index, params) {
  return meiliRequest(`/indexes/${index}/search`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

async function meiliGetDocument(index, docId) {
  return meiliRequest(`/indexes/${index}/documents/${docId}`);
}

// ---------------------------------------------------------------------------
// Mock data (used when MOCK_MODE=true)
// ---------------------------------------------------------------------------

const MOCK_RESTAURANTS = [
  {
    id: "REST-001",
    name: "Sakura Sushi",
    cuisine: "Japanese",
    description: "Premium sushi and Japanese cuisine with fresh daily ingredients from Tsukiji-style sourcing",
    rating: 4.9,
    review_count: 1247,
    delivery_fee: 2.99,
    estimated_time: "25-35 min",
    price_range: "$$",
    address: "123 Sutter St, San Francisco, CA 94108",
    _geo: { lat: 37.7899, lng: -122.4034 },
    hours: "11:00 AM - 10:00 PM",
    is_open: true,
    tags: ["sushi", "japanese", "fresh fish", "sake"],
    image_url: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800",
  },
  {
    id: "REST-003",
    name: "Bella Trattoria",
    cuisine: "Italian",
    description: "Handmade pasta and wood-fired Neapolitan pizza in a cozy North Beach setting",
    rating: 4.7,
    review_count: 892,
    delivery_fee: 3.49,
    estimated_time: "30-40 min",
    price_range: "$$",
    address: "456 Columbus Ave, San Francisco, CA 94133",
    _geo: { lat: 37.7986, lng: -122.4078 },
    hours: "11:30 AM - 10:30 PM",
    is_open: true,
    tags: ["pasta", "pizza", "italian", "wine"],
    image_url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800",
  },
  {
    id: "REST-004",
    name: "Taqueria El Sol",
    cuisine: "Mexican",
    description: "Authentic Mission-style burritos and street tacos with house-made salsas",
    rating: 4.6,
    review_count: 2103,
    delivery_fee: 1.99,
    estimated_time: "15-25 min",
    price_range: "$",
    address: "789 Mission St, San Francisco, CA 94110",
    _geo: { lat: 37.7645, lng: -122.4194 },
    hours: "10:00 AM - 11:00 PM",
    is_open: true,
    tags: ["tacos", "burritos", "mexican", "salsa"],
    image_url: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800",
  },
  {
    id: "REST-006",
    name: "Mumbai Masala House",
    cuisine: "Indian",
    description: "Aromatic curries and tandoori specialties from a veteran Mumbai chef",
    rating: 4.5,
    review_count: 756,
    delivery_fee: 2.99,
    estimated_time: "30-45 min",
    price_range: "$$",
    address: "234 Polk St, San Francisco, CA 94109",
    _geo: { lat: 37.7866, lng: -122.4202 },
    hours: "11:00 AM - 10:00 PM",
    is_open: true,
    tags: ["curry", "tandoori", "indian", "naan"],
    image_url: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=800",
  },
  {
    id: "REST-005",
    name: "Thai Basil Garden",
    cuisine: "Thai",
    description: "Traditional Thai recipes using imported spices and locally sourced produce",
    rating: 4.6,
    review_count: 634,
    delivery_fee: 2.49,
    estimated_time: "25-35 min",
    price_range: "$$",
    address: "567 Larkin St, San Francisco, CA 94102",
    _geo: { lat: 37.7831, lng: -122.4172 },
    hours: "11:30 AM - 9:30 PM",
    is_open: true,
    tags: ["thai", "curry", "pad thai", "spicy"],
    image_url: "https://images.unsplash.com/photo-1562565652-a0d8f0c59eb4?w=800",
  },
];

const MOCK_MENU_ITEMS = [
  { id: "ITEM-001", name: "Dragon Roll", description: "Tempura shrimp, avocado, cucumber topped with eel and spicy mayo", price: 16.99, restaurant_id: "REST-001", restaurant_name: "Sakura Sushi", category: "Specialty Rolls", dietary_tags: ["contains-shellfish"], is_popular: true, calories: 450 },
  { id: "ITEM-002", name: "Salmon Nigiri (4pc)", description: "Fresh Atlantic salmon over seasoned sushi rice", price: 12.99, restaurant_id: "REST-001", restaurant_name: "Sakura Sushi", category: "Nigiri", dietary_tags: ["gluten-free"], is_popular: true, calories: 280 },
  { id: "ITEM-003", name: "Spicy Tuna Roll", description: "Fresh tuna with spicy mayo, cucumber, and sesame seeds", price: 14.99, restaurant_id: "REST-001", restaurant_name: "Sakura Sushi", category: "Specialty Rolls", dietary_tags: ["spicy"], is_popular: true, calories: 380 },
  { id: "ITEM-009", name: "Margherita Pizza", description: "San Marzano tomatoes, fresh mozzarella, basil, and extra virgin olive oil", price: 18.99, restaurant_id: "REST-003", restaurant_name: "Bella Trattoria", category: "Pizza", dietary_tags: ["vegetarian"], is_popular: true, calories: 680 },
  { id: "ITEM-010", name: "Fettuccine Alfredo", description: "Handmade fettuccine in creamy Parmigiano-Reggiano sauce", price: 19.99, restaurant_id: "REST-003", restaurant_name: "Bella Trattoria", category: "Pasta", dietary_tags: ["vegetarian"], is_popular: true, calories: 750 },
  { id: "ITEM-013", name: "Carne Asada Burrito", description: "Grilled steak, rice, beans, pico de gallo, sour cream, and guacamole", price: 13.99, restaurant_id: "REST-004", restaurant_name: "Taqueria El Sol", category: "Burritos", dietary_tags: [], is_popular: true, calories: 890 },
  { id: "ITEM-014", name: "Al Pastor Tacos (3)", description: "Marinated pork with pineapple, onion, and cilantro on corn tortillas", price: 11.99, restaurant_id: "REST-004", restaurant_name: "Taqueria El Sol", category: "Tacos", dietary_tags: ["gluten-free"], is_popular: true, calories: 480 },
  { id: "ITEM-017", name: "Pad Thai", description: "Rice noodles with shrimp, bean sprouts, peanuts, and tamarind sauce", price: 14.99, restaurant_id: "REST-005", restaurant_name: "Thai Basil Garden", category: "Noodles", dietary_tags: ["contains-shellfish", "contains-nuts"], is_popular: true, calories: 520 },
  { id: "ITEM-018", name: "Green Curry", description: "Coconut green curry with bamboo shoots, Thai basil, and jasmine rice", price: 15.99, restaurant_id: "REST-005", restaurant_name: "Thai Basil Garden", category: "Curries", dietary_tags: ["spicy", "gluten-free"], is_popular: true, calories: 580 },
  { id: "ITEM-021", name: "Butter Chicken", description: "Tender chicken in creamy tomato-butter sauce with fenugreek", price: 16.99, restaurant_id: "REST-006", restaurant_name: "Mumbai Masala House", category: "Curries", dietary_tags: ["gluten-free"], is_popular: true, calories: 550 },
  { id: "ITEM-022", name: "Garlic Naan", description: "Soft leavened bread with garlic and cilantro from our tandoor", price: 4.99, restaurant_id: "REST-006", restaurant_name: "Mumbai Masala House", category: "Breads", dietary_tags: ["vegetarian"], is_popular: true, calories: 260 },
  { id: "ITEM-094", name: "Buddha Bowl", description: "Brown rice, roasted chickpeas, sweet potato, kale, avocado, and tahini", price: 15.99, restaurant_id: "REST-028", restaurant_name: "Veggie Delight", category: "Bowls", dietary_tags: ["vegetarian", "vegan", "gluten-free"], is_popular: true, calories: 450 },
  { id: "ITEM-055", name: "Harvest Bowl", description: "Quinoa, roasted sweet potato, kale, avocado, and lemon tahini dressing", price: 14.99, restaurant_id: "REST-015", restaurant_name: "Green Leaf Salads", category: "Bowls", dietary_tags: ["vegetarian", "vegan", "gluten-free"], is_popular: true, calories: 420 },
  { id: "ITEM-037", name: "Falafel Plate", description: "Crispy chickpea falafel with hummus, tabbouleh, pita, and tahini", price: 13.99, restaurant_id: "REST-010", restaurant_name: "Mediterranean Oasis", category: "Plates", dietary_tags: ["vegetarian", "vegan"], is_popular: true, calories: 520 },
  { id: "ITEM-059", name: "Tonkotsu Ramen", description: "18-hour pork bone broth with chashu, ajitama egg, nori, and noodles", price: 16.99, restaurant_id: "REST-016", restaurant_name: "Ramen Yamamoto", category: "Ramen", dietary_tags: [], is_popular: true, calories: 680 },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function searchRestaurants({ query, limit, latitude, longitude, radius_meters }) {
  if (MOCK_MODE) {
    const q = query.toLowerCase();
    const results = MOCK_RESTAURANTS.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.tags.some((t) => t.includes(q))
    ).slice(0, limit);
    return results;
  }

  const searchParams = { q: query, limit };
  const filters = [];

  if (latitude !== undefined && longitude !== undefined) {
    filters.push(`_geoRadius(${latitude}, ${longitude}, ${radius_meters})`);
  }

  if (filters.length > 0) {
    searchParams.filter = filters.join(" AND ");
  }

  const result = await meiliSearch("restaurants", searchParams);
  return result.hits;
}

async function searchMenuItems({ query, limit, dietary_filter }) {
  if (MOCK_MODE) {
    const q = query.toLowerCase();
    let results = MOCK_MENU_ITEMS.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
    if (dietary_filter) {
      results = results.filter((item) =>
        item.dietary_tags.includes(dietary_filter)
      );
    }
    return results.slice(0, limit);
  }

  const searchParams = { q: query, limit };
  if (dietary_filter) {
    searchParams.filter = `dietary_tags = "${dietary_filter}"`;
  }

  const result = await meiliSearch("menu_items", searchParams);
  return result.hits;
}

async function filterByCuisine({ cuisine, limit }) {
  if (MOCK_MODE) {
    return MOCK_RESTAURANTS.filter(
      (r) => r.cuisine.toLowerCase() === cuisine.toLowerCase()
    ).slice(0, limit);
  }

  const result = await meiliSearch("restaurants", {
    q: "",
    limit,
    filter: `cuisine = "${cuisine}"`,
  });
  return result.hits;
}

async function getRestaurantDetails({ restaurant_id }) {
  if (MOCK_MODE) {
    const restaurant = MOCK_RESTAURANTS.find((r) => r.id === restaurant_id);
    if (!restaurant) {
      return { error: `Restaurant ${restaurant_id} not found` };
    }
    const menu = MOCK_MENU_ITEMS.filter(
      (item) => item.restaurant_id === restaurant_id
    );
    return { ...restaurant, menu };
  }

  const restaurant = await meiliGetDocument("restaurants", restaurant_id);
  const menuResult = await meiliSearch("menu_items", {
    q: "",
    limit: 100,
    filter: `restaurant_id = "${restaurant_id}"`,
  });
  return { ...restaurant, menu: menuResult.hits };
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "meilisearch-restaurant-search",
  version: "1.0.0",
});

server.tool(
  "search_restaurants",
  "Search restaurants by name, cuisine, or description. Supports geo-filtering when latitude and longitude are provided.",
  {
    query: z.string().describe("Search query for restaurants"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return"),
    latitude: z.number().optional().describe("Latitude for geo-filtering"),
    longitude: z.number().optional().describe("Longitude for geo-filtering"),
    radius_meters: z.number().optional().default(5000).describe("Search radius in meters (default 5000)"),
  },
  async (params) => {
    try {
      const results = await searchRestaurants(params);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error searching restaurants: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "search_menu_items",
  "Search menu items across all restaurants. Supports filtering by dietary tags like vegetarian, vegan, gluten-free, etc.",
  {
    query: z.string().describe("Search query for menu items"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return"),
    dietary_filter: z
      .string()
      .optional()
      .describe('Optional dietary filter (e.g. "vegetarian", "gluten-free", "vegan")'),
  },
  async (params) => {
    try {
      const results = await searchMenuItems(params);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error searching menu items: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "filter_by_cuisine",
  "Get restaurants filtered by cuisine type using Meilisearch faceted filtering.",
  {
    cuisine: z.string().describe("Cuisine type to filter by (e.g. Japanese, Italian, Mexican)"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return"),
  },
  async (params) => {
    try {
      const results = await filterByCuisine(params);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error filtering by cuisine: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_restaurant_details",
  "Get full details of a specific restaurant including hours, address, rating, delivery fee, and full menu.",
  {
    restaurant_id: z.string().describe("The restaurant ID (e.g. REST-001)"),
  },
  async (params) => {
    try {
      const result = await getRestaurantDetails(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error getting restaurant details: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const mode = MOCK_MODE ? "MOCK" : `Meilisearch @ ${MEILISEARCH_URL}`;
  console.error(`Meilisearch MCP server running (${mode})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

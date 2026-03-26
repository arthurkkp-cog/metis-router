#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OSRM_URL = process.env.OSRM_URL || "http://localhost:5000";
const MOCK_MODE = process.env.MOCK_MODE === "true";

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function metersToMiles(meters) {
  return +(meters * 0.000621371).toFixed(2);
}

function secondsToMinutes(seconds) {
  return +(seconds / 60).toFixed(1);
}

function parseLatLng(str) {
  const parts = str.split(",").map((s) => s.trim());
  if (parts.length !== 2) throw new Error(`Invalid lat,lng string: "${str}"`);
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng))
    throw new Error(`Non-numeric coordinates in: "${str}"`);
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// OSRM fetch helper
// ---------------------------------------------------------------------------

async function osrmFetch(path) {
  const url = `${OSRM_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OSRM request failed (${res.status}): ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Mock data generators
// ---------------------------------------------------------------------------

const SF_STREETS = [
  "Market St",
  "Mission St",
  "Van Ness Ave",
  "Geary Blvd",
  "Folsom St",
  "Howard St",
  "Valencia St",
  "Divisadero St",
  "Columbus Ave",
  "Broadway",
  "3rd St",
  "Embarcadero",
  "Castro St",
  "Haight St",
  "Irving St",
];

function randomBetween(min, max) {
  return +(min + Math.random() * (max - min)).toFixed(2);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mockGeoJsonLineString(originLat, originLng, destLat, destLng) {
  const steps = 5 + Math.floor(Math.random() * 6);
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lng = originLng + (destLng - originLng) * t + (Math.random() - 0.5) * 0.002;
    const lat = originLat + (destLat - originLat) * t + (Math.random() - 0.5) * 0.002;
    coords.push([+lng.toFixed(6), +lat.toFixed(6)]);
  }
  return { type: "LineString", coordinates: coords };
}

function mockSteps(count) {
  const maneuvers = ["turn right", "turn left", "continue straight", "slight right", "slight left", "make a U-turn"];
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push({
      maneuver: pickRandom(maneuvers),
      street: pickRandom(SF_STREETS),
      distance_miles: randomBetween(0.1, 0.8),
      duration_minutes: randomBetween(0.5, 3),
    });
  }
  return result;
}

function mockRoute(originLat, originLng, destLat, destLng) {
  const distMiles = randomBetween(1, 5);
  const durMinutes = randomBetween(5, 20);
  return {
    distance_miles: distMiles,
    duration_minutes: durMinutes,
    route_geometry: mockGeoJsonLineString(originLat, originLng, destLat, destLng),
    steps: mockSteps(3 + Math.floor(Math.random() * 4)),
  };
}

function mockEta() {
  return {
    eta_minutes: randomBetween(5, 20),
    distance_miles: randomBetween(1, 5),
    summary: `Via ${pickRandom(SF_STREETS)}`,
  };
}

function mockMultiStop(stops) {
  const indices = stops.map((_, i) => i);
  const totalDist = randomBetween(3, 15);
  const totalDur = randomBetween(10, 45);
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    legs.push({
      from: stops[i].label || `Stop ${i}`,
      to: stops[i + 1].label || `Stop ${i + 1}`,
      distance_miles: randomBetween(0.5, 4),
      duration_minutes: randomBetween(3, 12),
    });
  }
  return {
    optimized_order: indices,
    total_distance_miles: totalDist,
    total_duration_minutes: totalDur,
    legs,
  };
}

function mockDistanceMatrix(origins, destinations) {
  const matrix = origins.map(() =>
    destinations.map(() => ({
      distance_miles: randomBetween(0.5, 8),
      duration_minutes: randomBetween(3, 25),
    }))
  );
  return {
    matrix,
    origin_labels: origins.map((o, i) => o.label || `Origin ${i}`),
    destination_labels: destinations.map((d, i) => d.label || `Destination ${i}`),
  };
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function calculateDeliveryRoute(originLat, originLng, destLat, destLng) {
  if (MOCK_MODE) return mockRoute(originLat, originLng, destLat, destLng);

  const path = `/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson&steps=true`;
  const data = await osrmFetch(path);

  if (!data.routes || data.routes.length === 0) {
    throw new Error("No route found between the given coordinates");
  }

  const route = data.routes[0];
  const steps = (route.legs || []).flatMap((leg) =>
    (leg.steps || []).map((s) => ({
      maneuver: s.maneuver?.type || "unknown",
      street: s.name || "",
      distance_miles: metersToMiles(s.distance),
      duration_minutes: secondsToMinutes(s.duration),
    }))
  );

  return {
    distance_miles: metersToMiles(route.distance),
    duration_minutes: secondsToMinutes(route.duration),
    route_geometry: route.geometry,
    steps,
  };
}

async function getEta(originStr, destStr) {
  if (MOCK_MODE) return mockEta();

  const origin = parseLatLng(originStr);
  const dest = parseLatLng(destStr);

  const path = `/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;
  const data = await osrmFetch(path);

  if (!data.routes || data.routes.length === 0) {
    throw new Error("No route found between the given coordinates");
  }

  const route = data.routes[0];
  const summaryName =
    route.legs?.[0]?.summary || route.legs?.[0]?.steps?.[0]?.name || "direct route";

  return {
    eta_minutes: secondsToMinutes(route.duration),
    distance_miles: metersToMiles(route.distance),
    summary: `Via ${summaryName}`,
  };
}

async function optimizeMultiStop(stops) {
  if (MOCK_MODE) return mockMultiStop(stops);

  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
  const path = `/trip/v1/driving/${coords}?source=first&roundtrip=false`;
  const data = await osrmFetch(path);

  if (!data.trips || data.trips.length === 0) {
    throw new Error("No optimized trip found for the given stops");
  }

  const trip = data.trips[0];
  const waypoints = data.waypoints || [];
  const optimizedOrder = waypoints.map((wp) => wp.waypoint_index);

  const legs = (trip.legs || []).map((leg, i) => {
    const fromIdx = optimizedOrder[i];
    const toIdx = i + 1 < optimizedOrder.length ? optimizedOrder[i + 1] : undefined;
    return {
      from: fromIdx != null ? (stops[fromIdx]?.label || `Stop ${fromIdx}`) : `Stop ${i}`,
      to: toIdx != null ? (stops[toIdx]?.label || `Stop ${toIdx}`) : `Stop ${i + 1}`,
      distance_miles: metersToMiles(leg.distance),
      duration_minutes: secondsToMinutes(leg.duration),
    };
  });

  return {
    optimized_order: optimizedOrder,
    total_distance_miles: metersToMiles(trip.distance),
    total_duration_minutes: secondsToMinutes(trip.duration),
    legs,
  };
}

async function distanceMatrix(origins, destinations) {
  if (MOCK_MODE) return mockDistanceMatrix(origins, destinations);

  const allCoords = [...origins, ...destinations];
  const coordStr = allCoords.map((c) => `${c.lng},${c.lat}`).join(";");

  const sourceIndices = origins.map((_, i) => i).join(";");
  const destIndices = destinations.map((_, i) => i + origins.length).join(";");

  const path = `/table/v1/driving/${coordStr}?sources=${sourceIndices}&destinations=${destIndices}&annotations=distance,duration`;
  const data = await osrmFetch(path);

  if (!data.durations) {
    throw new Error("No distance matrix returned from OSRM");
  }

  const matrix = data.durations.map((row, ri) =>
    row.map((dur, ci) => ({
      distance_miles: data.distances ? metersToMiles(data.distances[ri][ci]) : null,
      duration_minutes: secondsToMinutes(dur),
    }))
  );

  return {
    matrix,
    origin_labels: origins.map((o, i) => o.label || `Origin ${i}`),
    destination_labels: destinations.map((d, i) => d.label || `Destination ${i}`),
  };
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "osrm-routing",
  version: "1.0.0",
});

// --- Tool: calculate_delivery_route --------------------------------------

server.tool(
  "calculate_delivery_route",
  "Compute optimal driving route from restaurant/dasher to customer. Returns distance, duration, GeoJSON geometry, and turn-by-turn directions.",
  {
    origin_lat: z.number().describe("Restaurant or dasher latitude"),
    origin_lng: z.number().describe("Restaurant or dasher longitude"),
    destination_lat: z.number().describe("Customer latitude"),
    destination_lng: z.number().describe("Customer longitude"),
  },
  async ({ origin_lat, origin_lng, destination_lat, destination_lng }) => {
    try {
      const result = await calculateDeliveryRoute(
        origin_lat,
        origin_lng,
        destination_lat,
        destination_lng
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: get_eta -------------------------------------------------------

server.tool(
  "get_eta",
  'Quick ETA lookup between two points. Accepts coordinates as "lat,lng" strings.',
  {
    origin: z.string().describe('Origin coordinates in "lat,lng" format'),
    destination: z.string().describe('Destination coordinates in "lat,lng" format'),
  },
  async ({ origin, destination }) => {
    try {
      const result = await getEta(origin, destination);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: optimize_multi_stop -------------------------------------------

server.tool(
  "optimize_multi_stop",
  "Optimize ordering of multiple pickup/dropoff stops (traveling salesman). Returns optimized stop order, total distance/duration, and per-leg details.",
  {
    stops: z
      .array(
        z.object({
          lat: z.number().describe("Stop latitude"),
          lng: z.number().describe("Stop longitude"),
          type: z.enum(["pickup", "dropoff"]).describe("Stop type"),
          label: z.string().optional().describe("Human-readable label for the stop"),
        })
      )
      .min(2)
      .describe("Array of stops to optimize"),
  },
  async ({ stops }) => {
    try {
      const result = await optimizeMultiStop(stops);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: distance_matrix -----------------------------------------------

server.tool(
  "distance_matrix",
  "Compute an N x M distance and duration matrix between origins and destinations.",
  {
    origins: z
      .array(
        z.object({
          lat: z.number().describe("Origin latitude"),
          lng: z.number().describe("Origin longitude"),
          label: z.string().optional().describe("Human-readable label"),
        })
      )
      .min(1)
      .describe("Array of origin locations"),
    destinations: z
      .array(
        z.object({
          lat: z.number().describe("Destination latitude"),
          lng: z.number().describe("Destination longitude"),
          label: z.string().optional().describe("Human-readable label"),
        })
      )
      .min(1)
      .describe("Array of destination locations"),
  },
  async ({ origins, destinations }) => {
    try {
      const result = await distanceMatrix(origins, destinations);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("OSRM MCP server error:", err);
  process.exit(1);
});

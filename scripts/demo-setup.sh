#!/usr/bin/env bash
# =============================================================================
# demo-setup.sh
# Master setup script for the DoorDash demo.
#
# This script:
#   1. Checks prerequisites (Docker, Docker Compose)
#   2. Prepares OSRM data if not already present
#   3. Starts all Docker Compose services
#   4. Waits for health checks to pass
#   5. Seeds Meilisearch with DoorDash-themed restaurant data
#   6. Prints the status of all services
#
# Usage:
#   ./scripts/demo-setup.sh               # Full setup
#   ./scripts/demo-setup.sh --skip-osrm   # Skip OSRM data download
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.demo.yml"
ENV_FILE="$REPO_ROOT/.env.demo"

SKIP_OSRM=false
if [ "${1:-}" = "--skip-osrm" ]; then
  SKIP_OSRM=true
fi

# =============================================================================
# Helpers
# =============================================================================
info()  { echo "[INFO]  $*"; }
warn()  { echo "[WARN]  $*"; }
error() { echo "[ERROR] $*" >&2; }
ok()    { echo "[OK]    $*"; }

wait_for_url() {
  local url="$1"
  local name="$2"
  local max_attempts="${3:-30}"
  local attempt=1

  while [ $attempt -le "$max_attempts" ]; do
    if curl -sf "$url" > /dev/null 2>&1; then
      ok "$name is healthy ($url)"
      return 0
    fi
    printf "  Waiting for %s (%d/%d)...\r" "$name" "$attempt" "$max_attempts"
    sleep 3
    attempt=$((attempt + 1))
  done

  warn "$name did not become healthy after $max_attempts attempts ($url)"
  return 1
}

# =============================================================================
# Prerequisites
# =============================================================================
echo ""
echo "============================================="
echo " DoorDash Demo — Setup"
echo "============================================="
echo ""

info "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
  error "Docker is not installed. Please install Docker first."
  exit 1
fi

if ! docker compose version &> /dev/null; then
  error "Docker Compose v2 is not available. Please install Docker Compose."
  exit 1
fi

ok "Docker and Docker Compose are available."

# =============================================================================
# OSRM Data Preparation
# =============================================================================
if [ "$SKIP_OSRM" = true ]; then
  info "Skipping OSRM data preparation (--skip-osrm flag)."
elif [ -f "$REPO_ROOT/osrm-data/california-latest.osrm.cell_metrics" ]; then
  info "OSRM data already prepared — skipping."
else
  info "Preparing OSRM map data (this may take several minutes on first run)..."
  bash "$SCRIPT_DIR/download-osrm-data.sh"
fi

# =============================================================================
# Start Services
# =============================================================================
echo ""
info "Starting demo services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# =============================================================================
# Wait for Health Checks
# =============================================================================
echo ""
info "Waiting for services to become healthy..."
echo ""

HEALTHY=true

wait_for_url "http://localhost:7700/health"  "Meilisearch"  30 || HEALTHY=false
wait_for_url "http://localhost:9000/health"  "Medusa"       40 || HEALTHY=false
wait_for_url "http://localhost:4000/health"  "Novu Mock"    20 || HEALTHY=false

# OSRM and Chatwoot may take longer or may not be ready if data is missing
if [ "$SKIP_OSRM" = false ]; then
  wait_for_url "http://localhost:5000/route/v1/driving/-122.4194,37.7749;-122.4094,37.7849" "OSRM" 20 || HEALTHY=false
fi

wait_for_url "http://localhost:3001" "Chatwoot" 60 || HEALTHY=false

echo ""

# =============================================================================
# Seed Meilisearch with DoorDash-themed data
# =============================================================================
info "Seeding Meilisearch with restaurant data..."

MEILI_KEY="${MEILI_MASTER_KEY:-demo-master-key}"

# Create the restaurants index
curl -sf -X POST "http://localhost:7700/indexes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MEILI_KEY" \
  -d '{"uid": "restaurants", "primaryKey": "id"}' > /dev/null 2>&1 || true

# Seed restaurant documents
curl -sf -X POST "http://localhost:7700/indexes/restaurants/documents" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MEILI_KEY" \
  -d '[
  {
    "id": 1,
    "name": "Golden Dragon Chinese",
    "cuisine": "Chinese",
    "rating": 4.5,
    "delivery_time_min": 25,
    "delivery_time_max": 40,
    "price_range": "$$",
    "address": "123 Market St, San Francisco, CA",
    "lat": 37.7749,
    "lng": -122.4194,
    "popular_items": ["Kung Pao Chicken", "Fried Rice", "Spring Rolls", "Wonton Soup"],
    "is_open": true,
    "delivery_fee": 2.99
  },
  {
    "id": 2,
    "name": "Pizza Palace",
    "cuisine": "Italian",
    "rating": 4.3,
    "delivery_time_min": 20,
    "delivery_time_max": 35,
    "price_range": "$$",
    "address": "456 Mission St, San Francisco, CA",
    "lat": 37.7851,
    "lng": -122.4008,
    "popular_items": ["Margherita Pizza", "Pepperoni Pizza", "Caesar Salad", "Garlic Bread"],
    "is_open": true,
    "delivery_fee": 1.99
  },
  {
    "id": 3,
    "name": "Sushi Master",
    "cuisine": "Japanese",
    "rating": 4.7,
    "delivery_time_min": 30,
    "delivery_time_max": 45,
    "price_range": "$$$",
    "address": "789 Valencia St, San Francisco, CA",
    "lat": 37.7599,
    "lng": -122.4214,
    "popular_items": ["Dragon Roll", "Salmon Sashimi", "Miso Soup", "Edamame"],
    "is_open": true,
    "delivery_fee": 3.99
  },
  {
    "id": 4,
    "name": "Burger Barn",
    "cuisine": "American",
    "rating": 4.1,
    "delivery_time_min": 15,
    "delivery_time_max": 30,
    "price_range": "$",
    "address": "321 Haight St, San Francisco, CA",
    "lat": 37.7718,
    "lng": -122.4468,
    "popular_items": ["Classic Burger", "Bacon Cheeseburger", "Fries", "Milkshake"],
    "is_open": true,
    "delivery_fee": 0.99
  },
  {
    "id": 5,
    "name": "Taco Fiesta",
    "cuisine": "Mexican",
    "rating": 4.4,
    "delivery_time_min": 20,
    "delivery_time_max": 35,
    "price_range": "$",
    "address": "555 24th St, San Francisco, CA",
    "lat": 37.7525,
    "lng": -122.4185,
    "popular_items": ["Carne Asada Tacos", "Burrito Bowl", "Chips & Guacamole", "Churros"],
    "is_open": true,
    "delivery_fee": 1.49
  },
  {
    "id": 6,
    "name": "Pho Saigon",
    "cuisine": "Vietnamese",
    "rating": 4.6,
    "delivery_time_min": 25,
    "delivery_time_max": 40,
    "price_range": "$",
    "address": "888 Clement St, San Francisco, CA",
    "lat": 37.7832,
    "lng": -122.4677,
    "popular_items": ["Pho Bo", "Banh Mi", "Spring Rolls", "Vietnamese Coffee"],
    "is_open": true,
    "delivery_fee": 2.49
  },
  {
    "id": 7,
    "name": "Mumbai Spice",
    "cuisine": "Indian",
    "rating": 4.5,
    "delivery_time_min": 30,
    "delivery_time_max": 50,
    "price_range": "$$",
    "address": "222 Geary St, San Francisco, CA",
    "lat": 37.7873,
    "lng": -122.4084,
    "popular_items": ["Butter Chicken", "Tikka Masala", "Naan Bread", "Samosas"],
    "is_open": true,
    "delivery_fee": 2.99
  },
  {
    "id": 8,
    "name": "Mediterranean Delight",
    "cuisine": "Mediterranean",
    "rating": 4.2,
    "delivery_time_min": 25,
    "delivery_time_max": 40,
    "price_range": "$$",
    "address": "444 Columbus Ave, San Francisco, CA",
    "lat": 37.7998,
    "lng": -122.4082,
    "popular_items": ["Falafel Wrap", "Shawarma Plate", "Hummus & Pita", "Greek Salad"],
    "is_open": true,
    "delivery_fee": 2.49
  },
  {
    "id": 9,
    "name": "Thai Orchid",
    "cuisine": "Thai",
    "rating": 4.4,
    "delivery_time_min": 25,
    "delivery_time_max": 40,
    "price_range": "$$",
    "address": "999 Irving St, San Francisco, CA",
    "lat": 37.7638,
    "lng": -122.4687,
    "popular_items": ["Pad Thai", "Green Curry", "Tom Yum Soup", "Mango Sticky Rice"],
    "is_open": true,
    "delivery_fee": 2.99
  },
  {
    "id": 10,
    "name": "Seoul Kitchen",
    "cuisine": "Korean",
    "rating": 4.6,
    "delivery_time_min": 30,
    "delivery_time_max": 45,
    "price_range": "$$",
    "address": "777 Geary Blvd, San Francisco, CA",
    "lat": 37.7842,
    "lng": -122.4209,
    "popular_items": ["Korean BBQ", "Bibimbap", "Kimchi Jjigae", "Japchae"],
    "is_open": true,
    "delivery_fee": 3.49
  }
]' > /dev/null 2>&1 || true

# Configure searchable & filterable attributes
curl -sf -X PATCH "http://localhost:7700/indexes/restaurants/settings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MEILI_KEY" \
  -d '{
  "searchableAttributes": ["name", "cuisine", "popular_items", "address"],
  "filterableAttributes": ["cuisine", "rating", "price_range", "is_open", "delivery_fee"],
  "sortableAttributes": ["rating", "delivery_time_min", "delivery_fee"]
}' > /dev/null 2>&1 || true

# Create the menu-items index
curl -sf -X POST "http://localhost:7700/indexes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MEILI_KEY" \
  -d '{"uid": "menu-items", "primaryKey": "id"}' > /dev/null 2>&1 || true

# Seed menu items
curl -sf -X POST "http://localhost:7700/indexes/menu-items/documents" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MEILI_KEY" \
  -d '[
  {"id": 101, "restaurant_id": 1, "name": "Kung Pao Chicken", "description": "Spicy diced chicken with peanuts and vegetables", "price": 14.99, "category": "Entrees", "is_popular": true},
  {"id": 102, "restaurant_id": 1, "name": "Fried Rice", "description": "Wok-fried rice with eggs, vegetables, and soy sauce", "price": 10.99, "category": "Entrees", "is_popular": true},
  {"id": 201, "restaurant_id": 2, "name": "Margherita Pizza", "description": "Classic pizza with fresh mozzarella, tomatoes, and basil", "price": 16.99, "category": "Pizza", "is_popular": true},
  {"id": 202, "restaurant_id": 2, "name": "Pepperoni Pizza", "description": "Traditional pepperoni with mozzarella cheese", "price": 17.99, "category": "Pizza", "is_popular": true},
  {"id": 301, "restaurant_id": 3, "name": "Dragon Roll", "description": "Shrimp tempura, avocado, eel, and tobiko", "price": 18.99, "category": "Specialty Rolls", "is_popular": true},
  {"id": 302, "restaurant_id": 3, "name": "Salmon Sashimi", "description": "Fresh Atlantic salmon, 8 pieces", "price": 15.99, "category": "Sashimi", "is_popular": true},
  {"id": 401, "restaurant_id": 4, "name": "Classic Burger", "description": "Angus beef patty with lettuce, tomato, and special sauce", "price": 11.99, "category": "Burgers", "is_popular": true},
  {"id": 501, "restaurant_id": 5, "name": "Carne Asada Tacos", "description": "Three tacos with grilled steak, onions, and cilantro", "price": 12.99, "category": "Tacos", "is_popular": true},
  {"id": 601, "restaurant_id": 6, "name": "Pho Bo", "description": "Traditional beef pho with rice noodles and herbs", "price": 13.99, "category": "Soups", "is_popular": true},
  {"id": 701, "restaurant_id": 7, "name": "Butter Chicken", "description": "Tender chicken in a creamy tomato-butter sauce", "price": 15.99, "category": "Entrees", "is_popular": true}
]' > /dev/null 2>&1 || true

ok "Meilisearch seeded with 10 restaurants and sample menu items."

# =============================================================================
# Print Status
# =============================================================================
echo ""
echo "============================================="
echo " DoorDash Demo — Service Status"
echo "============================================="
echo ""

print_status() {
  local name="$1"
  local url="$2"
  local port="$3"
  if curl -sf "$url" > /dev/null 2>&1; then
    printf "  %-20s  %-6s  %s\n" "$name" "$port" "RUNNING"
  else
    printf "  %-20s  %-6s  %s\n" "$name" "$port" "NOT READY"
  fi
}

printf "  %-20s  %-6s  %s\n" "SERVICE" "PORT" "STATUS"
printf "  %-20s  %-6s  %s\n" "-------" "----" "------"
print_status "Meilisearch"  "http://localhost:7700/health" "7700"
print_status "Medusa"       "http://localhost:9000/health" "9000"
print_status "OSRM"         "http://localhost:5000/route/v1/driving/-122.4194,37.7749;-122.4094,37.7849" "5000"
print_status "Chatwoot"     "http://localhost:3001" "3001"
print_status "Novu Mock"    "http://localhost:4000/health" "4000"

echo ""
echo "============================================="
echo " Demo is ready! Try these endpoints:"
echo "============================================="
echo ""
echo "  Meilisearch:  http://localhost:7700"
echo "  Medusa:       http://localhost:9000"
echo "  OSRM:         http://localhost:5000"
echo "  Chatwoot:     http://localhost:3001"
echo "  Novu Mock:    http://localhost:4000"
echo ""
echo "  Example search:"
echo "    curl 'http://localhost:7700/indexes/restaurants/search' \\"
echo "      -H 'Authorization: Bearer demo-master-key' \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"q\": \"pizza\"}'"
echo ""
echo "  Example route:"
echo "    curl 'http://localhost:5000/route/v1/driving/-122.4194,37.7749;-122.4094,37.7849'"
echo ""
echo "  Example notification:"
echo "    curl -X POST 'http://localhost:4000/v1/events/trigger' \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"name\": \"order-confirmed\", \"to\": \"user-1\", \"payload\": {\"orderId\": \"DD-1234\", \"restaurantName\": \"Pizza Palace\"}}'"
echo ""

if [ "$HEALTHY" = false ]; then
  echo ""
  warn "Some services may not be fully healthy yet."
  echo "  Run 'docker compose -f docker-compose.demo.yml ps' to check status."
  echo ""
fi

#!/usr/bin/env bash
# seed-meilisearch.sh — Seed a Meilisearch instance with restaurant and menu data.
# Usage: ./scripts/seed-meilisearch.sh
#
# Environment variables:
#   MEILISEARCH_URL        (default: http://localhost:7700)
#   MEILISEARCH_MASTER_KEY (default: demo-master-key)

set -euo pipefail

MEILI_URL="${MEILISEARCH_URL:-http://localhost:7700}"
MEILI_KEY="${MEILISEARCH_MASTER_KEY:-demo-master-key}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RESTAURANTS_FILE="$REPO_ROOT/seed-data/restaurants.json"
MENU_ITEMS_FILE="$REPO_ROOT/seed-data/menu_items.json"

# ── helpers ─────────────────────────────────────────────────────────────────

meili() {
  local method="$1" path="$2"
  shift 2
  curl -sf -X "$method" \
    "$MEILI_URL$path" \
    -H "Authorization: Bearer $MEILI_KEY" \
    -H "Content-Type: application/json" \
    "$@"
}

info()  { echo "✓ $*"; }
step()  { echo ""; echo "── $* ──"; }
fail()  { echo "✗ $*" >&2; exit 1; }

# ── wait for Meilisearch ────────────────────────────────────────────────────

step "Waiting for Meilisearch at $MEILI_URL"

MAX_RETRIES=30
for i in $(seq 1 "$MAX_RETRIES"); do
  if curl -sf "$MEILI_URL/health" > /dev/null 2>&1; then
    info "Meilisearch is healthy"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    fail "Meilisearch did not become healthy after $MAX_RETRIES retries"
  fi
  echo "  waiting… ($i/$MAX_RETRIES)"
  sleep 2
done

# ── restaurants index ───────────────────────────────────────────────────────

step "Configuring restaurants index"

meili POST "/indexes" -d '{"uid":"restaurants","primaryKey":"id"}' > /dev/null 2>&1 || true
info "Index 'restaurants' created (or already exists)"

meili PATCH "/indexes/restaurants/settings" -d '{
  "searchableAttributes": ["name", "cuisine", "description", "tags"],
  "filterableAttributes": ["cuisine", "price_range", "rating", "is_open", "_geo"],
  "sortableAttributes": ["rating", "delivery_fee", "review_count"]
}' > /dev/null
info "Searchable / filterable / sortable attributes configured"

step "Uploading restaurants"

meili POST "/indexes/restaurants/documents" -d "@$RESTAURANTS_FILE" > /dev/null
info "Uploaded $(python3 -c "import json; print(len(json.load(open('$RESTAURANTS_FILE'))))" 2>/dev/null || echo '?') restaurants"

# ── menu_items index ────────────────────────────────────────────────────────

step "Configuring menu_items index"

meili POST "/indexes" -d '{"uid":"menu_items","primaryKey":"id"}' > /dev/null 2>&1 || true
info "Index 'menu_items' created (or already exists)"

meili PATCH "/indexes/menu_items/settings" -d '{
  "searchableAttributes": ["name", "description", "category", "dietary_tags", "restaurant_name"],
  "filterableAttributes": ["restaurant_id", "category", "dietary_tags", "is_popular"],
  "sortableAttributes": ["price", "calories"]
}' > /dev/null
info "Searchable / filterable / sortable attributes configured"

step "Uploading menu items"

meili POST "/indexes/menu_items/documents" -d "@$MENU_ITEMS_FILE" > /dev/null
info "Uploaded $(python3 -c "import json; print(len(json.load(open('$MENU_ITEMS_FILE'))))" 2>/dev/null || echo '?') menu items"

# ── wait for indexing ───────────────────────────────────────────────────────

step "Waiting for indexing to complete"

sleep 3

# ── verification ────────────────────────────────────────────────────────────

step "Verifying with test searches"

RESTAURANT_HITS=$(meili POST "/indexes/restaurants/search" -d '{"q":"sushi","limit":3}' | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('hits',[])))" 2>/dev/null || echo "0")
info "Restaurant search for 'sushi': $RESTAURANT_HITS hit(s)"

MENU_HITS=$(meili POST "/indexes/menu_items/search" -d '{"q":"burger","limit":3}' | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('hits',[])))" 2>/dev/null || echo "0")
info "Menu item search for 'burger': $MENU_HITS hit(s)"

if [ "$RESTAURANT_HITS" -gt 0 ] && [ "$MENU_HITS" -gt 0 ]; then
  echo ""
  echo "🎉 Seeding complete! Meilisearch is ready."
else
  echo ""
  echo "⚠️  Seeding finished but verification returned zero hits."
  echo "   Indexing may still be in progress — try searching again in a few seconds."
fi

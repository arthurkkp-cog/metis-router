#!/usr/bin/env bash
# =============================================================================
# demo-teardown.sh
# Stops and cleans up all DoorDash demo services.
#
# Usage:
#   ./scripts/demo-teardown.sh          # Stop services, keep volumes
#   ./scripts/demo-teardown.sh --clean  # Stop services and remove volumes
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.demo.yml"
ENV_FILE="$REPO_ROOT/.env.demo"

echo "============================================="
echo " DoorDash Demo — Teardown"
echo "============================================="

REMOVE_VOLUMES=false
if [ "${1:-}" = "--clean" ]; then
  REMOVE_VOLUMES=true
  echo "[INFO] --clean flag detected: volumes will be removed."
fi

echo ""
echo "[INFO] Stopping demo services..."
if [ "$REMOVE_VOLUMES" = true ]; then
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down -v --remove-orphans
else
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down --remove-orphans
fi

echo ""
echo "============================================="
echo " Demo services stopped."
if [ "$REMOVE_VOLUMES" = true ]; then
  echo " Volumes have been removed."
fi
echo "============================================="

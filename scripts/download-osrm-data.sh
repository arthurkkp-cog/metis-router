#!/usr/bin/env bash
# =============================================================================
# download-osrm-data.sh
# Downloads a small OSM extract (San Francisco area) from Geofabrik and
# pre-processes it for OSRM using the MLD algorithm.
#
# Usage:
#   ./scripts/download-osrm-data.sh [output_dir]
#
# The output directory defaults to ./osrm-data if not specified.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${1:-$REPO_ROOT/osrm-data}"

# Use the small US California extract from Geofabrik — about 1 GB.
# For an even smaller dataset you can swap to a metro extract from
# download.bbbike.org, but Geofabrik is the most reliable source.
REGION_URL="https://download.geofabrik.de/north-america/us/california-latest.osm.pbf"
REGION_FILE="california-latest.osm.pbf"
OSRM_IMAGE="osrm/osrm-backend:latest"

echo "============================================="
echo " OSRM Data Preparation for DoorDash Demo"
echo "============================================="

mkdir -p "$OUTPUT_DIR"

# -------------------------------------------------------------------------
# Step 1 — Download the OSM extract
# -------------------------------------------------------------------------
if [ -f "$OUTPUT_DIR/$REGION_FILE" ]; then
  echo "[INFO] OSM extract already exists at $OUTPUT_DIR/$REGION_FILE — skipping download."
else
  echo "[INFO] Downloading OSM extract from Geofabrik..."
  echo "       URL: $REGION_URL"
  curl -L -o "$OUTPUT_DIR/$REGION_FILE" "$REGION_URL"
  echo "[INFO] Download complete."
fi

# -------------------------------------------------------------------------
# Step 2 — Extract routing data
# -------------------------------------------------------------------------
if [ -f "$OUTPUT_DIR/california-latest.osrm" ]; then
  echo "[INFO] OSRM extract already exists — skipping osrm-extract."
else
  echo "[INFO] Running osrm-extract (this may take a few minutes)..."
  docker run --rm -t \
    -v "$OUTPUT_DIR:/data" \
    "$OSRM_IMAGE" \
    osrm-extract -p /opt/car.lua "/data/$REGION_FILE"
  echo "[INFO] osrm-extract complete."
fi

# -------------------------------------------------------------------------
# Step 3 — Partition the graph
# -------------------------------------------------------------------------
if [ -f "$OUTPUT_DIR/california-latest.osrm.partition" ]; then
  echo "[INFO] Partition data already exists — skipping osrm-partition."
else
  echo "[INFO] Running osrm-partition..."
  docker run --rm -t \
    -v "$OUTPUT_DIR:/data" \
    "$OSRM_IMAGE" \
    osrm-partition "/data/california-latest.osrm"
  echo "[INFO] osrm-partition complete."
fi

# -------------------------------------------------------------------------
# Step 4 — Customize (compute edge weights)
# -------------------------------------------------------------------------
if [ -f "$OUTPUT_DIR/california-latest.osrm.cell_metrics" ]; then
  echo "[INFO] Customized data already exists — skipping osrm-customize."
else
  echo "[INFO] Running osrm-customize..."
  docker run --rm -t \
    -v "$OUTPUT_DIR:/data" \
    "$OSRM_IMAGE" \
    osrm-customize "/data/california-latest.osrm"
  echo "[INFO] osrm-customize complete."
fi

echo ""
echo "============================================="
echo " OSRM data preparation complete!"
echo " Data directory: $OUTPUT_DIR"
echo "============================================="
echo ""
echo "You can test the routing server with:"
echo "  docker run -t -i -p 5000:5000 -v $OUTPUT_DIR:/data $OSRM_IMAGE osrm-routed --algorithm mld /data/california-latest.osrm"
echo ""
echo "Then open: http://localhost:5000/route/v1/driving/-122.4194,37.7749;-122.4094,37.7849"

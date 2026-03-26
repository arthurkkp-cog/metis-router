#!/bin/bash
# DoorDash Demo Startup Script
# Usage: ./demo-start.sh [--with-services] [--mock]

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Defaults
WITH_SERVICES=false
MOCK_MODE=true

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --with-services)
            WITH_SERVICES=true
            shift
            ;;
        --mock)
            MOCK_MODE=true
            shift
            ;;
        --no-mock)
            MOCK_MODE=false
            shift
            ;;
        --help|-h)
            echo "DoorDash Demo Startup Script"
            echo "============================="
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --with-services    Start backing services via docker-compose (Meilisearch, Medusa, OSRM, Chatwoot, Novu)"
            echo "  --mock             Run MCP servers in mock mode (default)"
            echo "  --no-mock          Run MCP servers against real backing services"
            echo "  --help, -h         Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                         # Start demo in mock mode (no backing services needed)"
            echo "  $0 --with-services         # Start backing services + demo"
            echo "  $0 --no-mock               # Run against real services (must be running already)"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "=========================================="
echo "  DoorDash Demo - Metis MCP Router"
echo "=========================================="
echo ""

# Step 1: Install MCP server dependencies
if [ -f "mcp-servers/package.json" ]; then
    print_status "Installing MCP server dependencies..."
    cd mcp-servers
    npm install
    cd ..
    print_success "MCP server dependencies installed"
else
    print_warning "No mcp-servers/package.json found, skipping dependency install"
fi

# Step 2: Optionally start backing services
if [ "$WITH_SERVICES" = true ]; then
    if [ -f "docker-compose.services.yml" ]; then
        print_status "Starting backing services via docker-compose..."
        docker-compose -f docker-compose.services.yml up -d
        print_success "Backing services started"
        echo ""
        print_status "Waiting for services to be ready..."
        sleep 10
    else
        print_warning "No docker-compose.services.yml found. Skipping service startup."
        print_warning "Make sure backing services are running manually, or use --mock mode."
    fi
fi

# Step 3: Set environment for mock mode
if [ "$MOCK_MODE" = true ]; then
    export MOCK_MODE=true
    print_status "Running in MOCK MODE - no backing services required"
else
    export MOCK_MODE=false
    print_status "Running in LIVE MODE - backing services must be available"
fi

# Step 4: Install router dependencies if needed
if [ ! -d "server/node_modules" ]; then
    print_status "Installing router server dependencies..."
    cd server
    npm install
    cd ..
fi

# Step 5: Install backend dependencies if needed
if [ -f "client/backend/requirements.txt" ]; then
    print_status "Installing backend Python dependencies..."
    cd client/backend
    pip install -r requirements.txt -q
    cd ../..
fi

# Step 6: Install frontend dependencies if needed
if [ ! -d "client/frontend/node_modules" ]; then
    print_status "Installing frontend dependencies..."
    cd client/frontend
    npm install
    cd ../..
fi

# Step 7: Start the full stack
print_status "Starting Metis Router full stack..."
echo ""

# Function to cleanup background processes
cleanup() {
    print_warning "Shutting down all services..."
    jobs -p | xargs -r kill 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start MCP Router
print_status "Starting MCP Router on http://localhost:9999..."
cd server
npm run dev:http &
ROUTER_PID=$!
cd ..

sleep 3

# Start Backend
print_status "Starting Backend on http://localhost:8000..."
cd client/backend
uvicorn app:app --host localhost --port 8000 --log-level info &
BACKEND_PID=$!
cd ../..

sleep 3

# Start Frontend
print_status "Starting Frontend on http://localhost:3000..."
cd client/frontend
npm start &
FRONTEND_PID=$!
cd ../..

sleep 3

# Step 8: Print status and URLs
echo ""
echo "=========================================="
print_success "DoorDash Demo is running!"
echo "=========================================="
echo ""
echo "  Frontend:     http://localhost:3000"
echo "  Backend API:  http://localhost:8000"
echo "  MCP Router:   http://localhost:9999"
echo ""
echo "  MCP Servers ($([ "$MOCK_MODE" = true ] && echo 'mock mode' || echo 'live mode')):"
echo "    - doordash-search       (Meilisearch - Restaurant & Menu Search)"
echo "    - doordash-orders       (Medusa - Order & Commerce)"
echo "    - doordash-routing      (OSRM - Delivery Routing & ETA)"
echo "    - doordash-support      (Chatwoot - Customer Support)"
echo "    - doordash-notifications (Novu - Notifications)"
echo ""
echo "  Press Ctrl+C to stop all services."
echo "=========================================="
echo ""

# Wait for all background processes
wait

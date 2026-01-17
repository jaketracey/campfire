#!/bin/bash

# Load Test Runner Script
# Runs k6 load tests against the application

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Campfire Load Test Suite ===${NC}\n"

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}k6 is not installed${NC}"
    echo "Please install k6:"
    echo "  macOS: brew install k6"
    echo "  Linux: See https://k6.io/docs/getting-started/installation/"
    exit 1
fi

# Configuration
BASE_URL=${BASE_URL:-http://localhost:3000}
WS_URL=${WS_URL:-ws://localhost:3000}
TEST_PROFILE=${1:-quick}

echo -e "${YELLOW}Configuration:${NC}"
echo "  Base URL: $BASE_URL"
echo "  WebSocket URL: $WS_URL"
echo "  Test Profile: $TEST_PROFILE"
echo ""

# Check if application is running
echo -e "${YELLOW}Checking if application is running...${NC}"
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" | grep -q "200"; then
    echo -e "${RED}Application is not running on $BASE_URL${NC}"
    echo "Please start the application first:"
    echo "  pnpm --filter @campfire/gateway build"
    echo "  pnpm --filter @campfire/gateway start"
    exit 1
fi
echo -e "${GREEN}Application is running${NC}\n"

# Create results directory
RESULTS_DIR="k6-results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

echo -e "${YELLOW}Results will be saved to: $RESULTS_DIR${NC}\n"

# Define test profiles
case "$TEST_PROFILE" in
    quick)
        API_VUS=10
        API_DURATION=30s
        WS_VUS=20
        WS_DURATION=1m
        ;;
    standard)
        API_VUS=50
        API_DURATION=2m
        WS_VUS=50
        WS_DURATION=2m
        ;;
    stress)
        API_VUS=100
        API_DURATION=5m
        WS_VUS=100
        WS_DURATION=3m
        ;;
    *)
        echo -e "${RED}Invalid test profile: $TEST_PROFILE${NC}"
        echo "Valid profiles: quick, standard, stress"
        exit 1
        ;;
esac

# Run API Load Tests
echo -e "${BLUE}Running API Load Tests...${NC}"
echo "  VUs: $API_VUS"
echo "  Duration: $API_DURATION"

k6 run \
    --vus $API_VUS \
    --duration $API_DURATION \
    --out json="$RESULTS_DIR/api-load.json" \
    --summary-export="$RESULTS_DIR/api-summary.json" \
    -e BASE_URL=$BASE_URL \
    packages/gateway/tests/load/k6-api-load.js

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ API Load Tests passed${NC}\n"
else
    echo -e "${RED}✗ API Load Tests failed${NC}\n"
fi

# Run WebSocket Load Tests
echo -e "${BLUE}Running WebSocket Load Tests...${NC}"
echo "  VUs: $WS_VUS"
echo "  Duration: $WS_DURATION"

k6 run \
    --vus $WS_VUS \
    --duration $WS_DURATION \
    --out json="$RESULTS_DIR/websocket-load.json" \
    --summary-export="$RESULTS_DIR/websocket-summary.json" \
    -e WS_URL=$WS_URL \
    packages/gateway/tests/load/k6-websocket-load.js

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ WebSocket Load Tests passed${NC}\n"
else
    echo -e "${RED}✗ WebSocket Load Tests failed${NC}\n"
fi

# Summary
echo -e "${BLUE}=== Load Test Complete ===${NC}"
echo -e "Results saved to: ${GREEN}$RESULTS_DIR${NC}"
echo ""
echo "To view detailed results:"
echo "  cat $RESULTS_DIR/api-summary.json | jq"
echo "  cat $RESULTS_DIR/websocket-summary.json | jq"

#!/bin/bash

# Performance Test Runner Script
# Runs all performance tests with proper setup and teardown

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Campfire Performance Test Suite ===${NC}\n"

# Check if services are running
echo -e "${YELLOW}Checking required services...${NC}"

if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo -e "${RED}PostgreSQL is not running on localhost:5432${NC}"
    echo "Please start PostgreSQL or run: pnpm docker:up"
    exit 1
fi

if ! redis-cli -h localhost -p 6379 ping > /dev/null 2>&1; then
    echo -e "${RED}Redis is not running on localhost:6379${NC}"
    echo "Please start Redis or run: pnpm docker:up"
    exit 1
fi

echo -e "${GREEN}All services are running${NC}\n"

# Function to run a test suite
run_test_suite() {
    local name=$1
    local command=$2
    
    echo -e "${BLUE}Running $name...${NC}"
    
    if eval $command; then
        echo -e "${GREEN}✓ $name passed${NC}\n"
        return 0
    else
        echo -e "${RED}✗ $name failed${NC}\n"
        return 1
    fi
}

# Track failures
FAILED_TESTS=()

# Run migrations
echo -e "${YELLOW}Running database migrations...${NC}"
pnpm db:migrate
echo -e "${GREEN}Migrations complete${NC}\n"

# API Performance Tests
if ! run_test_suite "API Latency Tests" "pnpm --filter @campfire/gateway test tests/performance/api-latency.test.ts"; then
    FAILED_TESTS+=("API Latency Tests")
fi

# Database Performance Tests
if ! run_test_suite "Database Performance Tests" "pnpm --filter @campfire/gateway test tests/performance/database.test.ts"; then
    FAILED_TESTS+=("Database Performance Tests")
fi

# WebSocket Performance Tests
if ! run_test_suite "WebSocket Performance Tests" "pnpm --filter @campfire/gateway test tests/performance/websocket.test.ts"; then
    FAILED_TESTS+=("WebSocket Performance Tests")
fi

# Worker Performance Tests
if ! run_test_suite "Worker Performance Tests" "pnpm --filter @campfire/workers test tests/performance/worker-jobs.test.ts"; then
    FAILED_TESTS+=("Worker Performance Tests")
fi

# E2E Performance Tests
if ! run_test_suite "E2E Performance Tests" "pnpm --filter @campfire/gateway test tests/e2e/conversation-flow.test.ts"; then
    FAILED_TESTS+=("E2E Performance Tests")
fi

# Memory Leak Tests (with GC exposed)
if ! run_test_suite "Memory Leak Detection Tests" "NODE_OPTIONS=--expose-gc pnpm --filter @campfire/gateway test tests/stability/memory-leak.test.ts"; then
    FAILED_TESTS+=("Memory Leak Detection Tests")
fi

# Recovery Tests
if ! run_test_suite "Recovery and Resilience Tests" "pnpm --filter @campfire/gateway test tests/stability/recovery.test.ts"; then
    FAILED_TESTS+=("Recovery and Resilience Tests")
fi

# Summary
echo -e "${BLUE}=== Test Summary ===${NC}"

if [ ${#FAILED_TESTS[@]} -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    exit 0
else
    echo -e "${RED}Failed tests:${NC}"
    for test in "${FAILED_TESTS[@]}"; do
        echo -e "${RED}  - $test${NC}"
    done
    exit 1
fi

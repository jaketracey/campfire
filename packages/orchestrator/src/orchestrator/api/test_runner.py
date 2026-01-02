"""Test Runner API for running orchestration tests programmatically."""

import asyncio
import subprocess
import sys
import time
from enum import Enum
from pathlib import Path
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = structlog.get_logger()

router = APIRouter(prefix="/tests", tags=["tests"])


class TestRunType(str, Enum):
    """Type of test run to execute."""

    ROUTING = "routing"
    MEMORY = "memory"
    INTEGRATION = "integration"
    PERFORMANCE = "performance"
    ALL = "all"


class TestStatus(str, Enum):
    """Status of a test result."""

    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"


class TestResultItem(BaseModel):
    """Individual test result."""

    test_name: str
    test_category: str
    status: TestStatus
    duration_ms: float
    error_message: str | None = None
    error_stack: str | None = None
    metrics: dict[str, Any] | None = None


class RunTestsRequest(BaseModel):
    """Request to run tests."""

    run_type: TestRunType = TestRunType.ALL
    run_id: UUID | None = None


class RunTestsResponse(BaseModel):
    """Response from running tests."""

    run_id: str
    status: str
    total_tests: int
    passed: int
    failed: int
    skipped: int
    duration_ms: float
    results: list[TestResultItem]
    summary: dict[str, Any] | None = None


class TestRunStatus(BaseModel):
    """Status of a test run."""

    run_id: str
    status: str
    progress: float = 0.0
    message: str | None = None


# Track running tests
_running_tests: dict[str, dict[str, Any]] = {}


def _get_test_path_pattern(run_type: TestRunType) -> str:
    """Get pytest path pattern for a given run type."""
    patterns = {
        TestRunType.ROUTING: "tests/routing/",
        TestRunType.MEMORY: "tests/test_memory_retention.py",
        TestRunType.INTEGRATION: "tests/routing/test_routing_integration.py",
        TestRunType.PERFORMANCE: "tests/",  # No dedicated perf tests yet
        TestRunType.ALL: "tests/",
    }
    return patterns.get(run_type, "tests/")


def _parse_pytest_json_output(output: str) -> dict[str, Any]:
    """Parse pytest JSON output from --json-report plugin or custom format."""
    import json

    try:
        # Try to find JSON output in the response
        lines = output.strip().split("\n")
        for line in reversed(lines):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                return json.loads(line)
    except (json.JSONDecodeError, IndexError):
        pass

    return {}


def _parse_pytest_output(output: str, stderr: str) -> tuple[list[TestResultItem], dict[str, int]]:
    """Parse pytest output to extract test results."""
    import re

    results: list[TestResultItem] = []
    summary = {"passed": 0, "failed": 0, "skipped": 0, "error": 0}

    # Parse test results from pytest output
    # Match patterns like: tests/routing/test_model_router.py::test_something PASSED
    test_pattern = re.compile(
        r"^(tests/[^\s]+\.py)::([^\s]+)\s+(PASSED|FAILED|SKIPPED|ERROR)",
        re.MULTILINE
    )

    for match in test_pattern.finditer(output):
        file_path, test_name, status = match.groups()

        # Extract category from file path
        category = "unknown"
        if "routing" in file_path:
            category = "routing"
        elif "memory" in file_path:
            category = "memory"
        elif "integration" in file_path:
            category = "integration"

        status_enum = TestStatus(status.lower())
        summary[status.lower()] = summary.get(status.lower(), 0) + 1

        # Try to extract error message for failed tests
        error_message = None
        error_stack = None
        if status_enum == TestStatus.FAILED:
            # Look for error details after the test name
            error_pattern = re.compile(
                rf"{re.escape(test_name)}.*?(?:AssertionError|Error):\s*(.+?)(?:\n\n|\Z)",
                re.DOTALL
            )
            error_match = error_pattern.search(output)
            if error_match:
                error_message = error_match.group(1).strip()[:500]

        results.append(TestResultItem(
            test_name=test_name,
            test_category=category,
            status=status_enum,
            duration_ms=0.0,  # pytest doesn't give individual timing without plugins
            error_message=error_message,
            error_stack=error_stack,
        ))

    # Parse summary line: "10 passed, 2 failed, 1 skipped"
    summary_pattern = re.compile(
        r"(\d+)\s+passed|(\d+)\s+failed|(\d+)\s+skipped|(\d+)\s+error"
    )
    for match in summary_pattern.finditer(output.lower()):
        if match.group(1):
            summary["passed"] = int(match.group(1))
        if match.group(2):
            summary["failed"] = int(match.group(2))
        if match.group(3):
            summary["skipped"] = int(match.group(3))
        if match.group(4):
            summary["error"] = int(match.group(4))

    return results, summary


async def _run_pytest(run_type: TestRunType, run_id: str) -> RunTestsResponse:
    """Run pytest and return results."""
    start_time = time.time()

    # Get the orchestrator package root
    orchestrator_root = Path(__file__).parent.parent.parent.parent

    # Build pytest command
    test_path = _get_test_path_pattern(run_type)
    cmd = [
        sys.executable, "-m", "pytest",
        str(orchestrator_root / test_path),
        "-v",
        "--tb=short",
        "-q",
        "--no-header",
    ]

    logger.info("running_pytest", cmd=" ".join(cmd), run_id=run_id, run_type=run_type.value)

    try:
        # Run pytest as subprocess
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(orchestrator_root),
        )

        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=300.0  # 5 minute timeout
        )

        stdout_str = stdout.decode("utf-8")
        stderr_str = stderr.decode("utf-8")

        duration_ms = (time.time() - start_time) * 1000

        # Parse results
        results, summary = _parse_pytest_output(stdout_str + stderr_str, stderr_str)

        total_tests = len(results) if results else (
            summary["passed"] + summary["failed"] + summary["skipped"] + summary["error"]
        )

        logger.info(
            "pytest_completed",
            run_id=run_id,
            run_type=run_type.value,
            total=total_tests,
            passed=summary["passed"],
            failed=summary["failed"],
            duration_ms=duration_ms,
            exit_code=process.returncode,
        )

        return RunTestsResponse(
            run_id=run_id,
            status="completed" if process.returncode == 0 else "failed",
            total_tests=total_tests,
            passed=summary["passed"],
            failed=summary["failed"],
            skipped=summary["skipped"],
            duration_ms=duration_ms,
            results=results,
            summary={
                "exit_code": process.returncode,
                "by_category": _group_by_category(results),
            },
        )

    except asyncio.TimeoutError:
        logger.error("pytest_timeout", run_id=run_id, run_type=run_type.value)
        return RunTestsResponse(
            run_id=run_id,
            status="failed",
            total_tests=0,
            passed=0,
            failed=0,
            skipped=0,
            duration_ms=(time.time() - start_time) * 1000,
            results=[],
            summary={"error": "Test run timed out after 5 minutes"},
        )

    except Exception as e:
        logger.exception("pytest_error", run_id=run_id, error=str(e))
        return RunTestsResponse(
            run_id=run_id,
            status="failed",
            total_tests=0,
            passed=0,
            failed=0,
            skipped=0,
            duration_ms=(time.time() - start_time) * 1000,
            results=[],
            summary={"error": str(e)},
        )


def _group_by_category(results: list[TestResultItem]) -> dict[str, dict[str, int]]:
    """Group results by test category."""
    by_category: dict[str, dict[str, int]] = {}

    for result in results:
        if result.test_category not in by_category:
            by_category[result.test_category] = {"passed": 0, "failed": 0, "skipped": 0}

        if result.status == TestStatus.PASSED:
            by_category[result.test_category]["passed"] += 1
        elif result.status == TestStatus.FAILED:
            by_category[result.test_category]["failed"] += 1
        elif result.status == TestStatus.SKIPPED:
            by_category[result.test_category]["skipped"] += 1

    return by_category


@router.post("/run", response_model=RunTestsResponse)
async def run_tests(request: RunTestsRequest) -> RunTestsResponse:
    """Run orchestration tests.

    Executes pytest for the specified test type and returns detailed results.
    This is a synchronous endpoint that waits for tests to complete.
    """
    run_id = str(request.run_id) if request.run_id else str(time.time_ns())

    logger.info(
        "test_run_requested",
        run_id=run_id,
        run_type=request.run_type.value,
    )

    # Run the tests
    result = await _run_pytest(request.run_type, run_id)

    return result


@router.get("/status/{run_id}", response_model=TestRunStatus)
async def get_test_status(run_id: str) -> TestRunStatus:
    """Get status of a running test.

    Currently returns immediate status as tests run synchronously.
    """
    if run_id in _running_tests:
        return TestRunStatus(
            run_id=run_id,
            status="running",
            progress=_running_tests[run_id].get("progress", 0.0),
            message="Tests are running...",
        )

    return TestRunStatus(
        run_id=run_id,
        status="unknown",
        progress=0.0,
        message="Test run not found or already completed",
    )


@router.get("/categories")
async def list_test_categories() -> dict[str, Any]:
    """List available test categories and their descriptions."""
    return {
        "categories": [
            {
                "name": "routing",
                "description": "Model routing and intent detection tests",
                "test_count": "70+",
                "includes": ["Intent detection", "Model selection", "Safety level mapping"],
            },
            {
                "name": "memory",
                "description": "Memory retention and recall tests",
                "test_count": "20+",
                "includes": ["Repetition detection", "Fact recall", "Cross-session memory"],
            },
            {
                "name": "integration",
                "description": "Full pipeline integration tests",
                "test_count": "10+",
                "includes": ["End-to-end routing", "Provider fallback", "Context building"],
            },
            {
                "name": "performance",
                "description": "Performance and latency benchmarks",
                "test_count": "TBD",
                "includes": ["Response latency", "Token throughput", "Concurrent requests"],
            },
        ],
        "run_types": [t.value for t in TestRunType],
    }

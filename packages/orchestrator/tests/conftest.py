"""
Pytest configuration and fixtures for memory/consistency tests.
"""

import os

import pytest


def pytest_configure(config):
    """Configure pytest markers."""
    config.addinivalue_line(
        "markers", "llm_required: test requires real LLM calls (expensive)"
    )
    config.addinivalue_line("markers", "slow: slow running test")
    config.addinivalue_line("markers", "integration: integration test")


def pytest_collection_modifyitems(config, items):
    """Skip LLM tests unless explicitly enabled."""
    if not os.getenv("RUN_LLM_TESTS"):
        skip_llm = pytest.mark.skip(reason="LLM tests disabled. Set RUN_LLM_TESTS=1")
        for item in items:
            if "llm_required" in item.keywords:
                item.add_marker(skip_llm)

    if not os.getenv("RUN_INTEGRATION_TESTS"):
        skip_integration = pytest.mark.skip(
            reason="Integration tests disabled. Set RUN_INTEGRATION_TESTS=1"
        )
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip_integration)


@pytest.fixture(scope="session")
def test_settings():
    """Test settings with cheaper models."""
    return {
        "environment": "test",
        "anthropic_model": os.getenv("TEST_MODEL", "claude-3-haiku-20240307"),
        "max_context_tokens": 32000,
        "default_turn_window": 20,
        "safety_enabled": False,
    }


@pytest.fixture
def orchestrator_url():
    """Get orchestrator URL for integration tests."""
    return os.getenv("ORCHESTRATOR_URL", "http://localhost:8000")

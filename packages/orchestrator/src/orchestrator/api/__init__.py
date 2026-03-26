"""API routers for the orchestrator service."""

from orchestrator.api.test_runner import router as test_router
from orchestrator.api.health import router as health_router
from orchestrator.api.proactive import router as proactive_router

__all__ = ["test_router", "health_router", "proactive_router"]

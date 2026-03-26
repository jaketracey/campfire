"""Proactive outreach API endpoints.

Exposes evaluation and generation endpoints for the proactive outreach
system. Called by the scheduling worker to decide whether to send
check-in messages.
"""

from typing import Any

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from orchestrator.models.proactive import (
    EvaluateOutreachRequest,
    EvaluateOutreachResponse,
    GenerateOutreachRequest,
    GenerateOutreachResponse,
    OutreachConfig,
    OutreachConfigResponse,
    OutreachContext,
    OutreachTrigger,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/proactive", tags=["proactive"])


@router.post("/evaluate", response_model=EvaluateOutreachResponse)
async def evaluate_outreach(request: EvaluateOutreachRequest) -> EvaluateOutreachResponse:
    """Evaluate whether a companion should proactively reach out to a user.

    Checks eligibility, gathers context, and uses the LLM to decide
    whether to send a message and what to say.
    """
    try:
        from orchestrator.main import app_state

        if app_state.proactive_service is None:
            raise HTTPException(
                status_code=503,
                detail="Proactive outreach service not initialized",
            )

        decision = await app_state.proactive_service.evaluate_outreach(
            user_id=request.user_id,
            companion_id=request.companion_id,
        )

        return EvaluateOutreachResponse(decision=decision)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "proactive_evaluate_failed",
            user_id=request.user_id,
            companion_id=request.companion_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to evaluate outreach: {str(e)}",
        )


@router.post("/generate", response_model=GenerateOutreachResponse)
async def generate_outreach(request: GenerateOutreachRequest) -> GenerateOutreachResponse:
    """Generate an outreach message given pre-gathered context.

    Useful when the caller has already gathered context and just needs
    the LLM to produce a message.
    """
    try:
        from orchestrator.main import app_state

        if app_state.proactive_service is None:
            raise HTTPException(
                status_code=503,
                detail="Proactive outreach service not initialized",
            )

        message = await app_state.proactive_service.generate_outreach_message(
            context=request.context,
            trigger=request.trigger,
        )

        return GenerateOutreachResponse(
            message=message,
            trigger=request.trigger,
            confidence=0.85 if message else 0.0,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "proactive_generate_failed",
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate outreach message: {str(e)}",
        )


@router.get("/config/{companion_id}", response_model=OutreachConfigResponse)
async def get_outreach_config(companion_id: str) -> OutreachConfigResponse:
    """Get the outreach configuration for a companion.

    Returns default config if none is explicitly configured.
    """
    try:
        from orchestrator.main import app_state

        if app_state.proactive_service is None:
            raise HTTPException(
                status_code=503,
                detail="Proactive outreach service not initialized",
            )

        config = await app_state.proactive_service._get_outreach_config(companion_id)

        return OutreachConfigResponse(
            companion_id=companion_id,
            config=config,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "proactive_config_fetch_failed",
            companion_id=companion_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch outreach config: {str(e)}",
        )

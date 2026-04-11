"""Anthropic Batch API support for non-latency-sensitive operations.

The Batch API processes requests asynchronously at lower cost,
ideal for KG extraction, session summarization, and backstory generation.
"""

import asyncio
import json
from typing import Any
from uuid import uuid4

import anthropic
import structlog

from orchestrator.config import Settings

logger = structlog.get_logger()


class AnthropicBatchProcessor:
    """Processes multiple Anthropic API requests via the Batch API.

    The Batch API is ideal for:
    - KG extraction across multiple conversation turns
    - Session summarization of long conversations
    - Backstory generation for new companions
    - Any non-real-time Claude processing

    Benefits:
    - 50% cost reduction vs standard API
    - No rate limit pressure
    - Results available within 24h (usually minutes)
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.anthropic_timeout,
        )

    async def submit_batch(
        self,
        requests: list[dict[str, Any]],
        model: str | None = None,
        max_tokens: int = 1000,
        temperature: float = 0.1,
    ) -> str:
        """Submit a batch of requests for processing.

        Args:
            requests: List of dicts with 'custom_id' and 'messages' keys.
                      Each 'messages' is a standard messages array.
            model: Model to use (defaults to settings).
            max_tokens: Max tokens per response.
            temperature: Temperature for generation.

        Returns:
            Batch ID for polling results.
        """
        model = model or self.settings.kg_extraction_model

        batch_requests = []
        for req in requests:
            custom_id = req.get("custom_id", str(uuid4()))
            batch_requests.append({
                "custom_id": custom_id,
                "params": {
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": req["messages"],
                },
            })

        batch = await self.client.messages.batches.create(
            requests=batch_requests,
        )

        logger.info(
            "batch_submitted",
            batch_id=batch.id,
            request_count=len(batch_requests),
            model=model,
        )

        return batch.id

    async def get_batch_status(self, batch_id: str) -> dict[str, Any]:
        """Check the status of a batch.

        Returns:
            Dict with 'status', 'request_counts', etc.
        """
        batch = await self.client.messages.batches.retrieve(batch_id)

        return {
            "id": batch.id,
            "status": batch.processing_status,
            "request_counts": {
                "processing": batch.request_counts.processing,
                "succeeded": batch.request_counts.succeeded,
                "errored": batch.request_counts.errored,
                "canceled": batch.request_counts.canceled,
                "expired": batch.request_counts.expired,
            },
            "created_at": str(batch.created_at),
            "ended_at": str(batch.ended_at) if batch.ended_at else None,
        }

    async def get_batch_results(self, batch_id: str) -> list[dict[str, Any]]:
        """Retrieve results from a completed batch.

        Args:
            batch_id: The batch ID to retrieve results for.

        Returns:
            List of dicts with 'custom_id' and 'content' keys.
        """
        results = []

        async for result in await self.client.messages.batches.results(batch_id):
            if result.result.type == "succeeded":
                content = ""
                for block in result.result.message.content:
                    if block.type == "text":
                        content += block.text

                results.append({
                    "custom_id": result.custom_id,
                    "content": content,
                    "usage": {
                        "input_tokens": result.result.message.usage.input_tokens,
                        "output_tokens": result.result.message.usage.output_tokens,
                    },
                })
            else:
                logger.warning(
                    "batch_result_error",
                    custom_id=result.custom_id,
                    result_type=result.result.type,
                )
                results.append({
                    "custom_id": result.custom_id,
                    "content": None,
                    "error": result.result.type,
                })

        logger.info(
            "batch_results_retrieved",
            batch_id=batch_id,
            total_results=len(results),
            successful=sum(1 for r in results if r["content"] is not None),
        )

        return results

    async def submit_and_poll(
        self,
        requests: list[dict[str, Any]],
        model: str | None = None,
        max_tokens: int = 1000,
        temperature: float = 0.1,
        poll_interval: float = 2.0,
        timeout: float = 300.0,
    ) -> list[dict[str, Any]]:
        """Submit a batch and wait for results.

        Convenience method that submits, polls, and returns results.

        Args:
            requests: List of request dicts.
            model: Model to use.
            max_tokens: Max tokens per response.
            temperature: Temperature.
            poll_interval: Seconds between status checks.
            timeout: Maximum seconds to wait.

        Returns:
            List of result dicts.

        Raises:
            TimeoutError: If batch doesn't complete within timeout.
        """
        batch_id = await self.submit_batch(
            requests=requests,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        elapsed = 0.0
        while elapsed < timeout:
            status = await self.get_batch_status(batch_id)

            if status["status"] == "ended":
                return await self.get_batch_results(batch_id)

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(
            f"Batch {batch_id} did not complete within {timeout}s"
        )

    async def cancel_batch(self, batch_id: str) -> None:
        """Cancel a pending batch."""
        await self.client.messages.batches.cancel(batch_id)
        logger.info("batch_canceled", batch_id=batch_id)

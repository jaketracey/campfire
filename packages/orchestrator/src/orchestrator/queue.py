"""Job queue client for publishing to BullMQ workers."""

import json
import time
from typing import Any
from uuid import uuid4

import redis.asyncio as redis
import structlog

from orchestrator.config import Settings

logger = structlog.get_logger()


class JobQueue:
    """Publishes jobs to BullMQ queues via Redis."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: redis.Redis | None = None

    async def connect(self) -> None:
        """Connect to Redis."""
        self._client = redis.from_url(
            str(self.settings.redis_url),
            encoding="utf-8",
            decode_responses=True,
        )
        logger.info("job_queue_connected", redis_url=str(self.settings.redis_url))

    async def disconnect(self) -> None:
        """Disconnect from Redis."""
        if self._client:
            await self._client.close()
            self._client = None
            logger.info("job_queue_disconnected")

    async def add_job(
        self,
        queue_name: str,
        data: dict[str, Any],
        job_id: str | None = None,
        delay_ms: int = 0,
    ) -> str:
        """Add a job to a BullMQ queue.

        BullMQ stores jobs in Redis using specific keys:
        - bull:<queue>:id - Counter for job IDs
        - bull:<queue>:<job_id> - Job data (hash)
        - bull:<queue>:wait - List of waiting job IDs
        - bull:<queue>:meta - Queue metadata
        """
        if not self._client:
            raise RuntimeError("Job queue not connected")

        job_id = job_id or str(uuid4())
        timestamp = int(time.time() * 1000)

        # BullMQ job format
        job_data = {
            "id": job_id,
            "name": "__default__",
            "data": json.dumps(data),
            "opts": json.dumps({
                "attempts": 3,
                "backoff": {"type": "exponential", "delay": 1000},
                "delay": delay_ms,
                "timestamp": timestamp,
            }),
            "progress": 0,
            "delay": delay_ms,
            "timestamp": timestamp,
            "attemptsMade": 0,
            "stacktrace": "[]",
            "returnvalue": "null",
            "finishedOn": "",
            "processedOn": "",
        }

        prefix = f"bull:{queue_name}"

        # Store job data as hash
        await self._client.hset(f"{prefix}:{job_id}", mapping=job_data)

        # Add to waiting list (or delayed if delay > 0)
        if delay_ms > 0:
            # Add to delayed sorted set with score = timestamp + delay
            await self._client.zadd(
                f"{prefix}:delayed",
                {job_id: timestamp + delay_ms}
            )
        else:
            # Add to waiting list
            await self._client.lpush(f"{prefix}:wait", job_id)

        logger.debug(
            "job_added",
            queue=queue_name,
            job_id=job_id,
            delay_ms=delay_ms,
        )

        return job_id

    async def add_kg_proposal_job(
        self,
        user_id: str,
        companion_id: str,
        edge: dict[str, Any],
        entities: list[dict[str, Any]],
    ) -> str:
        """Add a knowledge graph proposal job."""
        return await self.add_job(
            queue_name="kg-projection",
            data={
                "type": "propose",
                "userId": user_id,
                "companionId": companion_id,
                "edge": edge,
                "entities": entities,
            },
        )


# Singleton instance
_job_queue: JobQueue | None = None


def get_job_queue(settings: Settings | None = None) -> JobQueue:
    """Get the job queue singleton."""
    global _job_queue
    if _job_queue is None:
        if settings is None:
            from orchestrator.config import get_settings
            settings = get_settings()
        _job_queue = JobQueue(settings)
    return _job_queue

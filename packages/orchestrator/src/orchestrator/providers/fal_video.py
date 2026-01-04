"""FAL AI video generation provider implementation."""

import asyncio
import time
from typing import Any

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import VideoProvider, VideoResult

logger = structlog.get_logger()

# Model ID to FAL endpoint mapping for video models
VIDEO_MODEL_TO_FAL_ENDPOINT: dict[str, str] = {
    # Kling models (image-to-video)
    "fal/kling-1.6-pro": "fal-ai/kling-video/v1.6/pro/image-to-video",
    "fal/kling-1.6-standard": "fal-ai/kling-video/v1.6/standard/image-to-video",
    "fal/kling-2.0-master": "fal-ai/kling-video/v2.0/master/image-to-video",
    # Runway Gen-3 models
    "fal/runway-gen3-turbo": "fal-ai/runway-gen3/turbo/image-to-video",
    "fal/runway-gen3-alpha": "fal-ai/runway-gen3/alpha/image-to-video",
    # MiniMax / Hailuo
    "fal/minimax-video-01": "fal-ai/minimax/video-01/image-to-video",
    "fal/hailuo-minimax": "fal-ai/hailuo-ai/minimax-video-01",
    # Luma Dream Machine
    "fal/luma-dream-machine": "fal-ai/luma-dream-machine",
    "fal/luma-ray-2": "fal-ai/luma-dream-machine/ray-2",
    # Hunyuan
    "fal/hunyuan-video": "fal-ai/hunyuan-video",
    # Veo 2
    "fal/veo-2": "fal-ai/veo-2",
    # Wan (text-to-video)
    "fal/wan-2.1": "fal-ai/wan/v2.1/1.3b/text-to-video",
}

# Model metadata for capabilities and pricing info
VIDEO_MODEL_METADATA: dict[str, dict[str, Any]] = {
    "fal/kling-1.6-pro": {
        "display_name": "Kling 1.6 Pro",
        "max_duration_seconds": 10,
        "cost_per_second_cents": 10,
        "capabilities": ["image_to_video"],
        "supported_resolutions": [
            {"width": 1080, "height": 1920},
            {"width": 1920, "height": 1080},
            {"width": 720, "height": 1280},
        ],
    },
    "fal/kling-1.6-standard": {
        "display_name": "Kling 1.6 Standard",
        "max_duration_seconds": 5,
        "cost_per_second_cents": 5,
        "capabilities": ["image_to_video"],
        "supported_resolutions": [
            {"width": 1080, "height": 1920},
            {"width": 1920, "height": 1080},
        ],
    },
    "fal/kling-2.0-master": {
        "display_name": "Kling 2.0 Master",
        "max_duration_seconds": 10,
        "cost_per_second_cents": 15,
        "capabilities": ["image_to_video", "motion_control"],
        "supported_resolutions": [
            {"width": 1080, "height": 1920},
            {"width": 1920, "height": 1080},
        ],
    },
    "fal/runway-gen3-turbo": {
        "display_name": "Runway Gen-3 Turbo",
        "max_duration_seconds": 10,
        "cost_per_second_cents": 8,
        "capabilities": ["image_to_video", "text_to_video"],
        "supported_resolutions": [
            {"width": 1280, "height": 768},
            {"width": 768, "height": 1280},
        ],
    },
    "fal/runway-gen3-alpha": {
        "display_name": "Runway Gen-3 Alpha",
        "max_duration_seconds": 10,
        "cost_per_second_cents": 12,
        "capabilities": ["image_to_video", "text_to_video"],
        "supported_resolutions": [
            {"width": 1280, "height": 768},
            {"width": 768, "height": 1280},
        ],
    },
    "fal/minimax-video-01": {
        "display_name": "MiniMax Video-01",
        "max_duration_seconds": 6,
        "cost_per_second_cents": 6,
        "capabilities": ["image_to_video", "text_to_video"],
        "supported_resolutions": [
            {"width": 1280, "height": 720},
            {"width": 720, "height": 1280},
        ],
    },
    "fal/hailuo-minimax": {
        "display_name": "Hailuo MiniMax",
        "max_duration_seconds": 6,
        "cost_per_second_cents": 6,
        "capabilities": ["image_to_video"],
        "supported_resolutions": [
            {"width": 1280, "height": 720},
            {"width": 720, "height": 1280},
        ],
    },
    "fal/luma-dream-machine": {
        "display_name": "Luma Dream Machine",
        "max_duration_seconds": 5,
        "cost_per_second_cents": 7,
        "capabilities": ["image_to_video", "text_to_video"],
        "supported_resolutions": [
            {"width": 1360, "height": 752},
            {"width": 752, "height": 1360},
        ],
    },
    "fal/luma-ray-2": {
        "display_name": "Luma Ray 2",
        "max_duration_seconds": 9,
        "cost_per_second_cents": 10,
        "capabilities": ["image_to_video", "text_to_video"],
        "supported_resolutions": [
            {"width": 1280, "height": 720},
            {"width": 720, "height": 1280},
        ],
    },
    "fal/hunyuan-video": {
        "display_name": "Hunyuan Video",
        "max_duration_seconds": 5,
        "cost_per_second_cents": 4,
        "capabilities": ["text_to_video"],
        "supported_resolutions": [
            {"width": 1280, "height": 720},
            {"width": 720, "height": 1280},
        ],
    },
    "fal/veo-2": {
        "display_name": "Veo 2",
        "max_duration_seconds": 8,
        "cost_per_second_cents": 20,
        "capabilities": ["image_to_video", "text_to_video"],
        "supported_resolutions": [
            {"width": 1920, "height": 1080},
            {"width": 1080, "height": 1920},
        ],
    },
    "fal/wan-2.1": {
        "display_name": "Wan 2.1",
        "max_duration_seconds": 5,
        "cost_per_second_cents": 3,
        "capabilities": ["text_to_video"],
        "supported_resolutions": [
            {"width": 832, "height": 480},
            {"width": 480, "height": 832},
        ],
    },
}


class FalVideoProvider(VideoProvider):
    """FAL AI video generation provider."""

    BASE_URL = "https://queue.fal.run"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.api_key = settings.fal_api_key
        self.default_model = "fal/kling-1.6-standard"
        self._client: httpx.AsyncClient | None = None

    @property
    def name(self) -> str:
        return "fal_video"

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                headers={
                    "Authorization": f"Key {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=300.0,  # Longer timeout for video generation
            )
        return self._client

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
    )
    async def generate(
        self,
        prompt: str,
        source_image_url: str | None = None,
        duration_seconds: int = 5,
        width: int = 1080,
        height: int = 1920,
        model_id: str | None = None,
    ) -> VideoResult:
        """Generate a video from prompt and/or source image.

        Args:
            prompt: Motion/action description for the video
            source_image_url: URL of image to animate (for image-to-video models)
            duration_seconds: Target video duration (model dependent)
            width: Video width in pixels
            height: Video height in pixels
            model_id: Specific video model to use

        Returns:
            VideoResult with video URL and metadata
        """
        start_time = time.time()

        client = await self._get_client()

        # Select endpoint based on model_id
        selected_model = model_id or self.default_model
        endpoint = VIDEO_MODEL_TO_FAL_ENDPOINT.get(selected_model)
        if not endpoint:
            raise ValueError(f"Unknown video model: {selected_model}")

        logger.info(
            "fal_video_generate_start",
            model_id=selected_model,
            endpoint=endpoint,
            has_source_image=source_image_url is not None,
            duration_seconds=duration_seconds,
        )

        # Build input parameters based on model type
        input_params: dict[str, Any] = {
            "prompt": prompt,
        }

        # Add source image for image-to-video models
        if source_image_url:
            input_params["image_url"] = source_image_url

        # Add duration if supported
        model_meta = VIDEO_MODEL_METADATA.get(selected_model, {})
        max_duration = model_meta.get("max_duration_seconds", 5)
        input_params["duration"] = min(duration_seconds, max_duration)

        # Some models accept aspect ratio instead of explicit dimensions
        # Map common aspect ratios
        if width > height:
            input_params["aspect_ratio"] = "16:9"
        else:
            input_params["aspect_ratio"] = "9:16"

        try:
            # Submit to queue
            response = await client.post(
                f"{self.BASE_URL}/{endpoint}",
                json=input_params,
            )
            response.raise_for_status()

            result = response.json()
            request_id = result.get("request_id")

            logger.info(
                "fal_video_queued",
                request_id=request_id,
                model_id=selected_model,
            )

            if request_id:
                # Poll for completion (videos take longer)
                result = await self._wait_for_result(
                    request_id,
                    endpoint=endpoint,
                    max_wait_seconds=600,  # 10 minutes max for video
                )

            latency_ms = (time.time() - start_time) * 1000

            # Extract video URL from result
            # Different models return video in different formats
            video_url = None
            thumbnail_url = None

            # Common response formats
            if "video" in result:
                video_data = result["video"]
                if isinstance(video_data, dict):
                    video_url = video_data.get("url")
                elif isinstance(video_data, str):
                    video_url = video_data
            elif "video_url" in result:
                video_url = result["video_url"]
            elif "output" in result:
                output = result["output"]
                if isinstance(output, dict):
                    video_url = output.get("video_url") or output.get("url")
                elif isinstance(output, str):
                    video_url = output

            # Try to get thumbnail
            if "thumbnail" in result:
                thumbnail_url = result["thumbnail"]
            elif "thumbnail_url" in result:
                thumbnail_url = result["thumbnail_url"]

            if not video_url:
                logger.error(
                    "fal_video_no_url",
                    result_keys=list(result.keys()),
                    result=result,
                )
                raise RuntimeError("No video URL in response")

            logger.info(
                "fal_video_completed",
                request_id=request_id,
                latency_ms=latency_ms,
                video_url=video_url[:100] if video_url else None,
            )

            return VideoResult(
                video_url=video_url,
                request_id=request_id or "",
                status="succeeded",
                duration_seconds=float(input_params.get("duration", duration_seconds)),
                width=width,
                height=height,
                latency_ms=latency_ms,
                thumbnail_url=thumbnail_url,
            )

        except httpx.HTTPStatusError as e:
            logger.error(
                "fal_video_api_error",
                status_code=e.response.status_code,
                error=str(e),
                response_text=e.response.text[:500] if e.response.text else None,
            )
            raise
        except Exception as e:
            logger.error("fal_video_generation_error", error=str(e))
            raise

    async def _wait_for_result(
        self,
        request_id: str,
        endpoint: str,
        max_wait_seconds: int = 600,
        poll_interval: float = 2.0,
    ) -> dict[str, Any]:
        """Poll for video result completion.

        Video generation takes longer than images, so we use longer intervals.
        """
        client = await self._get_client()

        status_url = f"https://queue.fal.run/{endpoint}/requests/{request_id}/status"
        result_url = f"https://queue.fal.run/{endpoint}/requests/{request_id}"

        elapsed = 0.0
        last_status = None

        while elapsed < max_wait_seconds:
            # Check status
            response = await client.get(status_url)
            response.raise_for_status()

            status_data = response.json()
            status = status_data.get("status")

            # Log status changes
            if status != last_status:
                logger.info(
                    "fal_video_status",
                    request_id=request_id,
                    status=status,
                    elapsed_seconds=elapsed,
                )
                last_status = status

            if status == "COMPLETED":
                # Fetch result
                result_response = await client.get(result_url)
                result_response.raise_for_status()
                return result_response.json()
            elif status == "FAILED":
                error = status_data.get("error", "Unknown error")
                logger.error(
                    "fal_video_failed",
                    request_id=request_id,
                    error=error,
                )
                raise RuntimeError(f"Video generation failed: {error}")

            # Increase poll interval as time goes on
            current_interval = min(poll_interval + (elapsed / 60), 10.0)
            await asyncio.sleep(current_interval)
            elapsed += current_interval

        raise TimeoutError(f"Video request {request_id} timed out after {max_wait_seconds}s")

    async def list_models(self) -> list[dict[str, Any]]:
        """List available video models with their capabilities."""
        models = []
        for model_id, metadata in VIDEO_MODEL_METADATA.items():
            models.append({
                "id": model_id,
                "display_name": metadata["display_name"],
                "provider": "fal",
                "max_duration_seconds": metadata["max_duration_seconds"],
                "cost_per_second_cents": metadata["cost_per_second_cents"],
                "capabilities": metadata["capabilities"],
                "supported_resolutions": metadata["supported_resolutions"],
            })
        return models

    async def health_check(self) -> bool:
        """Check if FAL API is reachable."""
        try:
            client = await self._get_client()
            response = await client.get(
                "https://fal.run/",
                timeout=5.0,
            )
            # Any response means the API is reachable
            return True
        except Exception:
            return False

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

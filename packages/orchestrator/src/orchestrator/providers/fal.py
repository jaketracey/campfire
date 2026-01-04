"""FAL AI image generation provider implementation."""

import asyncio
import time
from typing import Any

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import ImageProvider

logger = structlog.get_logger()


class FalProvider(ImageProvider):
    """FAL AI image generation provider."""

    BASE_URL = "https://queue.fal.run"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.api_key = settings.fal_api_key
        self.default_model = settings.fal_model
        self._client: httpx.AsyncClient | None = None

    @property
    def name(self) -> str:
        return "fal"

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                headers={
                    "Authorization": f"Key {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=120.0,
            )
        return self._client

    # Default negative prompt for quality photorealistic generation
    DEFAULT_NEGATIVE_PROMPT = (
        "ugly, deformed, disfigured, low quality, blurry, pixelated, "
        "bad anatomy, extra limbs, missing limbs, floating limbs, disconnected limbs, "
        "mutation, mutated, extra fingers, fewer fingers, bad hands, "
        "watermark, text, signature, logo"
    )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def generate(
        self,
        prompt: str,
        size: str = "512x512",
        style: str | None = None,  # Deprecated - ignored, always photorealistic
        negative_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Generate an image from a text prompt.

        Uses Juggernaut XL for photorealistic portrait generation.
        Style parameter is deprecated and ignored - all output is photorealistic.
        """
        start_time = time.time()

        client = await self._get_client()

        # Parse size
        width, height = self._parse_size(size)

        # Build input parameters for Juggernaut XL
        input_params: dict[str, Any] = {
            "prompt": prompt,
            "image_size": {
                "width": width,
                "height": height,
            },
            "num_images": 1,
            "enable_safety_checker": False,  # Disabled for adult companion content
            "guidance_scale": 7.5,  # Recommended for Juggernaut photorealism
            "num_inference_steps": 30,  # Higher quality
        }

        # Use provided negative prompt or default quality enhancer
        input_params["negative_prompt"] = negative_prompt or self.DEFAULT_NEGATIVE_PROMPT

        # Style parameter is deprecated - always photorealistic now
        if style:
            logger.debug("fal_style_deprecated", style=style)

        try:
            # Submit to queue
            response = await client.post(
                f"{self.BASE_URL}/{self.default_model}",
                json=input_params,
            )
            response.raise_for_status()

            result = response.json()
            request_id = result.get("request_id")

            if request_id:
                # Poll for completion
                result = await self._wait_for_result(request_id)

            latency_ms = (time.time() - start_time) * 1000

            # Extract image URL from result
            images = result.get("images", [])
            image_url = images[0].get("url") if images else None

            logger.info(
                "fal_generation",
                request_id=request_id,
                latency_ms=latency_ms,
            )

            return {
                "image_url": image_url,
                "request_id": request_id,
                "status": "succeeded",
                "latency_ms": latency_ms,
                "width": width,
                "height": height,
            }

        except httpx.HTTPStatusError as e:
            logger.error(
                "fal_api_error",
                status_code=e.response.status_code,
                error=str(e),
            )
            raise
        except Exception as e:
            logger.error("fal_generation_error", error=str(e))
            raise

    async def analyze(
        self,
        image_url: str,
        prompt: str | None = None,
    ) -> str:
        """Analyze an image using a vision model.

        Note: FAL doesn't have a direct vision model, so this falls back
        to a description based on the prompt used to generate the image.
        For full vision analysis, use Anthropic or OpenAI vision.
        """
        # FAL doesn't support image analysis directly
        # Return a placeholder indicating this limitation
        logger.warning("fal_analyze_not_supported")
        return "Image analysis not supported by FAL provider. Use Anthropic or OpenAI vision instead."

    async def _wait_for_result(
        self,
        request_id: str,
        max_wait_seconds: int = 120,
        poll_interval: float = 0.5,
    ) -> dict[str, Any]:
        """Poll for result completion."""
        client = await self._get_client()

        status_url = f"https://queue.fal.run/{self.default_model}/requests/{request_id}/status"
        result_url = f"https://queue.fal.run/{self.default_model}/requests/{request_id}"

        elapsed = 0.0
        while elapsed < max_wait_seconds:
            # Check status
            response = await client.get(status_url)
            response.raise_for_status()

            status_data = response.json()
            status = status_data.get("status")

            if status == "COMPLETED":
                # Fetch result
                result_response = await client.get(result_url)
                result_response.raise_for_status()
                return result_response.json()
            elif status == "FAILED":
                error = status_data.get("error", "Unknown error")
                raise RuntimeError(f"Generation failed: {error}")

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(f"Request {request_id} timed out")

    def _parse_size(self, size: str) -> tuple[int, int]:
        """Parse size string to width and height."""
        try:
            parts = size.lower().replace(" ", "").split("x")
            return int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            return 512, 512

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

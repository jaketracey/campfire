"""Replicate image generation provider implementation."""

import asyncio
import time
from typing import Any

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import ImageProvider

logger = structlog.get_logger()


class ReplicateProvider(ImageProvider):
    """Replicate image generation provider."""

    BASE_URL = "https://api.replicate.com/v1"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.api_key = settings.replicate_api_key
        self.default_model = settings.replicate_model
        self._client: httpx.AsyncClient | None = None

    @property
    def name(self) -> str:
        return "replicate"

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.BASE_URL,
                headers={
                    "Authorization": f"Token {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=120.0,
            )
        return self._client

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def generate(
        self,
        prompt: str,
        size: str = "512x512",
        style: str | None = None,
        negative_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Generate an image from a text prompt."""
        start_time = time.time()

        client = await self._get_client()

        # Parse size
        width, height = self._parse_size(size)

        # Build input parameters for SDXL
        input_params: dict[str, Any] = {
            "prompt": prompt,
            "width": width,
            "height": height,
            "num_outputs": 1,
            "num_inference_steps": 25,
            "guidance_scale": 7.5,
        }

        if negative_prompt:
            input_params["negative_prompt"] = negative_prompt

        if style:
            # Append style to prompt for SDXL
            style_prompts = {
                "realistic": "photorealistic, highly detailed, 8k",
                "artistic": "artistic, painting style, creative",
                "cartoon": "cartoon style, animated, colorful",
                "abstract": "abstract art, surreal, modern art",
            }
            if style in style_prompts:
                input_params["prompt"] = f"{prompt}, {style_prompts[style]}"

        try:
            # Create prediction
            response = await client.post(
                "/predictions",
                json={
                    "version": self._get_model_version(),
                    "input": input_params,
                },
            )
            response.raise_for_status()

            prediction = response.json()
            prediction_id = prediction["id"]

            # Poll for completion
            result = await self._wait_for_prediction(prediction_id)

            latency_ms = (time.time() - start_time) * 1000

            # Extract image URL
            output = result.get("output", [])
            image_url = output[0] if output else None

            logger.info(
                "replicate_generation",
                prediction_id=prediction_id,
                status=result.get("status"),
                latency_ms=latency_ms,
            )

            return {
                "image_url": image_url,
                "prediction_id": prediction_id,
                "status": result.get("status"),
                "latency_ms": latency_ms,
                "width": width,
                "height": height,
            }

        except httpx.HTTPStatusError as e:
            logger.error(
                "replicate_api_error",
                status_code=e.response.status_code,
                error=str(e),
            )
            raise
        except Exception as e:
            logger.error("replicate_generation_error", error=str(e))
            raise

    async def analyze(
        self,
        image_url: str,
        prompt: str | None = None,
    ) -> str:
        """Analyze an image using a vision model.

        Note: This would typically use a vision-capable model like LLaVA
        through Replicate, or fall back to Anthropic/OpenAI vision.
        """
        start_time = time.time()

        client = await self._get_client()

        # Use LLaVA for image analysis
        llava_version = "yorickvp/llava-13b:latest"

        analysis_prompt = prompt or "Describe this image in detail."

        try:
            response = await client.post(
                "/predictions",
                json={
                    "version": llava_version,
                    "input": {
                        "image": image_url,
                        "prompt": analysis_prompt,
                    },
                },
            )
            response.raise_for_status()

            prediction = response.json()
            prediction_id = prediction["id"]

            result = await self._wait_for_prediction(prediction_id)

            latency_ms = (time.time() - start_time) * 1000

            # Output is typically a list of text chunks
            output = result.get("output", [])
            description = "".join(output) if isinstance(output, list) else str(output)

            logger.info(
                "replicate_analysis",
                prediction_id=prediction_id,
                description_length=len(description),
                latency_ms=latency_ms,
            )

            return description

        except httpx.HTTPStatusError as e:
            logger.error(
                "replicate_analysis_error",
                status_code=e.response.status_code,
                error=str(e),
            )
            raise

    async def _wait_for_prediction(
        self,
        prediction_id: str,
        max_wait_seconds: int = 120,
        poll_interval: float = 1.0,
    ) -> dict[str, Any]:
        """Poll for prediction completion."""
        client = await self._get_client()

        elapsed = 0.0
        while elapsed < max_wait_seconds:
            response = await client.get(f"/predictions/{prediction_id}")
            response.raise_for_status()

            result = response.json()
            status = result.get("status")

            if status == "succeeded":
                return result
            elif status == "failed":
                error = result.get("error", "Unknown error")
                raise RuntimeError(f"Prediction failed: {error}")
            elif status == "canceled":
                raise RuntimeError("Prediction was canceled")

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(f"Prediction {prediction_id} timed out")

    def _parse_size(self, size: str) -> tuple[int, int]:
        """Parse size string to width and height."""
        try:
            parts = size.lower().replace(" ", "").split("x")
            return int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            return 512, 512

    def _get_model_version(self) -> str:
        """Get the model version ID."""
        # For SDXL, this would be the specific version hash
        # In production, this should be configurable or fetched dynamically
        model = self.default_model

        # Map common model names to version hashes
        version_map = {
            "stability-ai/sdxl:latest": (
                "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b"
            ),
            "stability-ai/stable-diffusion:latest": (
                "db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf"
            ),
        }

        return version_map.get(model, model)

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

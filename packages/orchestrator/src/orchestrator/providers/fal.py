"""FAL AI image generation provider implementation."""

import asyncio
import time
from typing import Any

import httpx
import structlog
from tenacity import retry, retry_if_not_exception_type, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import ImageProvider

logger = structlog.get_logger()

# Model ID to FAL endpoint mapping
MODEL_TO_FAL_ENDPOINT: dict[str, str] = {
    # Original FLUX 1.x models
    "fal/dreamina-v3.1": "fal-ai/bytedance/dreamina/v3.1/text-to-image",
    "fal/flux-1.1-pro": "fal-ai/flux-pro/v1.1",
    "fal/flux-schnell": "fal-ai/flux/schnell",
    "fal/flux-dev": "fal-ai/flux/dev",
    # FLUX 2 Series
    "fal/flux-2-max": "fal-ai/flux-2-max",
    "fal/flux-2-pro": "fal-ai/flux-2-pro",
    "fal/flux-2": "fal-ai/flux-2",
    "fal/flux-2-turbo": "fal-ai/flux-2/turbo",
    "fal/flux-2-flash": "fal-ai/flux-2/flash",
    "fal/flux-2-flex": "fal-ai/flux-2-flex",
    # FLUX Kontext (Editing)
    "fal/flux-kontext-pro": "fal-ai/flux-pro/kontext",
    "fal/flux-kontext-max": "fal-ai/flux-pro/kontext/max",
    "fal/flux-kontext-lora": "fal-ai/flux-kontext-lora",
    "fal/flux-lora": "fal-ai/flux-lora",
    # Identity-Preserving (PuLID)
    "fal/flux-pulid": "fal-ai/flux-pulid",
    # Other providers
    "fal/recraft-v3": "fal-ai/recraft/v3/text-to-image",
    "fal/seedream-4.5": "fal-ai/bytedance/seedream/v4.5/text-to-image",
    "fal/z-image-turbo": "fal-ai/z-image/turbo",
    "fal/qwen-image-2512": "fal-ai/qwen-image-2512",
    "fal/longcat-image": "fal-ai/longcat-image",
}


class FalProvider(ImageProvider):
    """FAL AI image generation provider using sync API."""

    BASE_URL = "https://fal.run"

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

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_not_exception_type(ValueError),
    )
    async def generate(
        self,
        prompt: str,
        size: str = "512x512",
        style: str | None = None,  # Deprecated - ignored, always photorealistic
        negative_prompt: str | None = None,
        model_id: str | None = None,
        reference_image_url: str | None = None,
        reference_strength: float = 0.7,
        is_anchor: bool = False,
        loras: list[dict[str, Any]] | None = None,
        lora_trigger_word: str | None = None,
        seed: int | None = None,
        output_format: str | None = None,
    ) -> dict[str, Any]:
        """Generate an image from a text prompt.

        Uses Juggernaut XL for photorealistic portrait generation.
        Style parameter is deprecated and ignored - all output is photorealistic.

        Args:
            prompt: The text prompt for generation
            size: Image size as "WIDTHxHEIGHT"
            style: Optional style modifier (deprecated)
            negative_prompt: Things to avoid in the image
            model_id: The model ID to use (e.g., "fal/dreamina-v3.1").
                     Maps to a FAL endpoint. If None, uses default model.
            reference_image_url: URL of reference image (not yet supported by all FAL models)
            reference_strength: How strongly to follow reference (0.0-1.0)
            is_anchor: If True, use high-quality settings
            loras: Optional list of LoRAs (for LoRA-capable endpoints, e.g. flux-lora)
            lora_trigger_word: Optional trigger token to append to prompt when using LoRA
            seed: Optional seed for reproducibility (model support varies)
            output_format: Optional output format (e.g. "png", model support varies)
        """
        start_time = time.time()

        client = await self._get_client()

        model_spec = self._get_model_spec(model_id)
        endpoint = self._resolve_endpoint(model_id=model_id, model_spec=model_spec)
        logger.debug("fal_endpoint_selected", model_id=model_id, endpoint=endpoint)

        # Parse size
        width, height = self._parse_size(size)

        # If using LoRA, append trigger token late (after any upstream prompt enhancement)
        if lora_trigger_word:
            token = lora_trigger_word.strip()
            if token and token not in prompt:
                prompt = f"{prompt}, {token}"

        # Handle identity-preserving variation via PuLID.
        # PuLID REQUIRES a reference image and has a distinct schema.
        if endpoint == MODEL_TO_FAL_ENDPOINT.get("fal/flux-pulid"):
            if not reference_image_url:
                raise ValueError("reference_image_url is required for fal/flux-pulid")

            # Map reference_strength to PuLID's identity weight, but enforce a safe floor.
            # Companion identity should remain stable even if callers send the older 0.7 default.
            id_weight = min(1.0, max(0.85, float(reference_strength)))

            # Pull defaults from registry when available.
            guidance = getattr(model_spec, "default_cfg_scale", None) or 4.0
            steps = getattr(model_spec, "default_steps", None) or 20

            result = await self.generate_pulid_variation(
                prompt=prompt,
                reference_image_url=reference_image_url,
                width=width,
                height=height,
                negative_prompt=negative_prompt,
                id_weight=float(id_weight),
                guidance_scale=float(guidance),
                num_inference_steps=int(steps),
            )
            return result

        # Build input parameters - minimal set that works across FAL models
        input_params: dict[str, Any] = {
            "prompt": prompt,
            "image_size": {
                "width": width,
                "height": height,
            },
            "num_images": 1,
        }

        # Add optional params only for models that support them.
        # NOTE: FAL endpoints are not schema-uniform. Many endpoints will error on unknown fields.
        if endpoint.startswith("fal-ai/flux") or endpoint.startswith("fal-ai/z-image"):
            input_params["enable_safety_checker"] = False
            supports_guidance_scale = False
            supports_steps = False

            # Flux family
            if endpoint.startswith("fal-ai/flux"):
                # Flux 2 "pro"/"max" are zero-config (no guidance/steps knobs).
                if endpoint in {"fal-ai/flux-2-pro", "fal-ai/flux-2-max"}:
                    supports_guidance_scale = False
                    supports_steps = False
                # Flux 2 turbo/flash expose guidance but not steps.
                elif endpoint in {"fal-ai/flux-2/turbo", "fal-ai/flux-2/flash"}:
                    supports_guidance_scale = True
                    supports_steps = False
                else:
                    supports_guidance_scale = True
                    supports_steps = True

                # Defaults: Flux 1.x typically uses CFG ~3.5; Flux 2 [dev] defaults to ~2.5.
                default_cfg = getattr(model_spec, "default_cfg_scale", None)
                if default_cfg is None:
                    if endpoint.startswith("fal-ai/flux-2"):
                        default_cfg = 3.5 if endpoint == "fal-ai/flux-2-flex" else 2.5
                    else:
                        default_cfg = 3.5

                default_steps = getattr(model_spec, "default_steps", None)
                if default_steps is None and supports_steps:
                    default_steps = 4 if "schnell" in endpoint else 28

                if supports_guidance_scale:
                    input_params["guidance_scale"] = float(default_cfg)
                if supports_steps and default_steps is not None:
                    input_params["num_inference_steps"] = int(default_steps)

            # Z-Image family
            if endpoint.startswith("fal-ai/z-image"):
                # Z-Image Turbo exposes steps but not guidance_scale.
                supports_steps = True
                default_steps = getattr(model_spec, "default_steps", None)
                if default_steps is None:
                    default_steps = 8
                input_params["num_inference_steps"] = int(default_steps)

        # Seed/output format are best-effort across models.
        if seed is not None:
            input_params["seed"] = seed
        if output_format:
            input_params["output_format"] = output_format

        # LoRA support (Flux LoRA endpoints).
        if loras:
            if "lora" not in endpoint:
                logger.warning(
                    "fal_loras_ignored_for_endpoint",
                    endpoint=endpoint,
                    model_id=model_id,
                    lora_count=len(loras),
                )
            else:
                input_params["loras"] = loras

        # Style parameter is deprecated - always photorealistic now
        if style:
            logger.debug("fal_style_deprecated", style=style)

        # Note: reference_image_url support varies by model. We only guarantee it
        # for PuLID in this provider. Other models may ignore or error.
        if reference_image_url:
            logger.debug(
                "fal_reference_image",
                endpoint=endpoint,
                reference_url=reference_image_url[:50] if reference_image_url else None,
                reference_strength=reference_strength,
            )
            if endpoint != MODEL_TO_FAL_ENDPOINT.get("fal/flux-pulid"):
                logger.warning(
                    "fal_reference_image_not_applied",
                    endpoint=endpoint,
                    model_id=model_id,
                    message="Reference images are only applied for fal/flux-pulid currently",
                )

        try:
            # Use sync API - POST and wait for response directly
            response = await client.post(
                f"{self.BASE_URL}/{endpoint}",
                json=input_params,
            )
            response.raise_for_status()

            result = response.json()
            latency_ms = (time.time() - start_time) * 1000

            # Extract image URL from result
            images = result.get("images", [])
            image_url = images[0].get("url") if images else None

            logger.info(
                "fal_generation_success",
                latency_ms=latency_ms,
                has_image=image_url is not None,
            )

            return {
                "image_url": image_url,
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
        endpoint: str | None = None,
    ) -> dict[str, Any]:
        """Poll for result completion."""
        client = await self._get_client()

        # Use provided endpoint or fall back to default model
        model_endpoint = endpoint or self.default_model
        # FAL queue API: status and result are both at the same URL (no /status suffix)
        result_url = f"https://queue.fal.run/{model_endpoint}/requests/{request_id}"

        elapsed = 0.0
        while elapsed < max_wait_seconds:
            # Check status (same URL returns status and result when complete)
            response = await client.get(result_url)
            response.raise_for_status()

            result_data = response.json()
            status = result_data.get("status")

            if status == "COMPLETED":
                # Result is already in the response
                return result_data
            elif status == "FAILED":
                error = result_data.get("error", "Unknown error")
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

    def _get_model_spec(self, model_id: str | None) -> Any | None:
        """Best-effort lookup of model defaults from the in-memory registry."""
        if not model_id:
            return None
        if model_id.startswith("fal-ai/"):
            return None
        try:
            from orchestrator.routing.image_model_registry import IMAGE_MODEL_REGISTRY

            return IMAGE_MODEL_REGISTRY.get(model_id)
        except Exception:
            return None

    def _resolve_endpoint(self, model_id: str | None, model_spec: Any | None) -> str:
        """Resolve a FAL endpoint from a model_id or model registry spec."""
        if model_id and model_id.startswith("fal-ai/"):
            return model_id
        if model_spec is not None:
            endpoint = getattr(model_spec, "fal_endpoint", None)
            if endpoint:
                return str(endpoint)
        if model_id:
            endpoint = MODEL_TO_FAL_ENDPOINT.get(model_id)
            if endpoint:
                return endpoint
        return self.default_model

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def health_check(self) -> bool:
        """Check if FAL API is reachable.

        Returns:
            True if the FAL API is accessible, False otherwise.
        """
        try:
            client = await self._get_client()
            # FAL doesn't have a dedicated health endpoint, so we just check
            # if we can reach the API with a simple request that should fail quickly
            # Using a HEAD request to the base URL or checking a known endpoint
            response = await client.get(
                "https://fal.run/",
                timeout=5.0,
            )
            # Any response (even 404) means the API is reachable
            return True
        except Exception:
            return False

    # =========================================================================
    # Anchor Generation Methods (Dreamina + PuLID)
    # =========================================================================

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def generate_dreamina_seed(
        self,
        prompt: str,
        width: int = 768,
        height: int = 1024,
        seed: int | None = None,
    ) -> dict[str, Any]:
        """Generate a seed image using Dreamina v3.1 for anchor generation.

        Dreamina v3.1 produces high-quality photorealistic portraits with
        superior aesthetics, ideal for establishing character identity.

        Args:
            prompt: The character description prompt
            width: Image width (default 768)
            height: Image height (default 1024)
            seed: Optional seed for reproducibility

        Returns:
            Dict with image_url, seed, latency_ms, width, height
        """
        start_time = time.time()
        client = await self._get_client()

        endpoint = MODEL_TO_FAL_ENDPOINT["fal/dreamina-v3.1"]

        input_params: dict[str, Any] = {
            "prompt": prompt,
            "image_size": {"width": width, "height": height},
            "num_images": 1,
            "enable_safety_checker": False,
        }

        if seed is not None:
            input_params["seed"] = seed

        try:
            response = await client.post(
                f"{self.BASE_URL}/{endpoint}",
                json=input_params,
            )
            response.raise_for_status()

            result = response.json()
            latency_ms = (time.time() - start_time) * 1000

            images = result.get("images", [])
            image_url = images[0].get("url") if images else None
            result_seed = result.get("seed", seed)

            logger.info(
                "dreamina_seed_generation_success",
                latency_ms=latency_ms,
                seed=result_seed,
                has_image=image_url is not None,
            )

            return {
                "image_url": image_url,
                "seed": result_seed,
                "status": "succeeded",
                "latency_ms": latency_ms,
                "width": width,
                "height": height,
            }

        except Exception as e:
            logger.error("dreamina_seed_generation_error", error=str(e))
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def generate_pulid_variation(
        self,
        prompt: str,
        reference_image_url: str,
        width: int = 768,
        height: int = 1024,
        negative_prompt: str | None = None,
        id_weight: float = 1.0,
        guidance_scale: float = 4.0,
        num_inference_steps: int = 20,
    ) -> dict[str, Any]:
        """Generate a variation using PuLID Flux for 88-93% facial identity preservation.

        PuLID Flux takes a reference image and generates variations that maintain
        the same facial identity while allowing scene/outfit changes.

        Args:
            prompt: The scene/context description
            reference_image_url: URL of the seed image (face reference)
            width: Image width (default 768)
            height: Image height (default 1024)
            id_weight: Identity preservation weight 0.0-1.0 (default 1.0 for maximum)
            guidance_scale: Prompt adherence 0-20 (default 4.0)
            num_inference_steps: Generation steps 1-50 (default 20)

        Returns:
            Dict with image_url, latency_ms, width, height
        """
        start_time = time.time()
        client = await self._get_client()

        endpoint = MODEL_TO_FAL_ENDPOINT["fal/flux-pulid"]

        input_params: dict[str, Any] = {
            "prompt": prompt,
            "reference_image_url": reference_image_url,
            "id_weight": id_weight,
            "image_size": {"width": width, "height": height},
            "guidance_scale": guidance_scale,
            "num_inference_steps": num_inference_steps,
            "num_images": 1,
            "enable_safety_checker": False,
        }
        if negative_prompt:
            input_params["negative_prompt"] = negative_prompt

        try:
            response = await client.post(
                f"{self.BASE_URL}/{endpoint}",
                json=input_params,
            )
            response.raise_for_status()

            result = response.json()
            latency_ms = (time.time() - start_time) * 1000

            images = result.get("images", [])
            image_url = images[0].get("url") if images else None

            logger.info(
                "pulid_variation_generation_success",
                latency_ms=latency_ms,
                id_weight=id_weight,
                has_image=image_url is not None,
            )

            return {
                "image_url": image_url,
                "status": "succeeded",
                "latency_ms": latency_ms,
                "width": width,
                "height": height,
                "id_weight": id_weight,
            }

        except Exception as e:
            logger.error("pulid_variation_generation_error", error=str(e))
            raise

"""ComfyUI provider implementation (local/self-hosted image generation)."""

import asyncio
import time
import uuid
from typing import Any

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.providers.base import ImageProvider

logger = structlog.get_logger()


class ComfyUIProvider(ImageProvider):
    """ComfyUI image generation provider for local/self-hosted SDXL."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.comfyui_base_url.rstrip("/")
        self.default_checkpoint = settings.comfyui_default_checkpoint
        self.timeout = settings.comfyui_timeout

        # SDXL-specific settings
        self.sdxl_checkpoint = getattr(settings, "comfyui_sdxl_checkpoint", "sd_xl_base_1.0.safetensors")
        self.sdxl_vae = getattr(settings, "comfyui_sdxl_vae", "sdxl_vae.safetensors")
        self.ipadapter_model = getattr(settings, "comfyui_ipadapter_model", "ip-adapter-plus_sdxl_vit-h.safetensors")
        self.clip_vision_model = getattr(settings, "comfyui_clip_vision_model", "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors")

    @property
    def name(self) -> str:
        return "comfyui"

    async def generate(
        self,
        prompt: str,
        size: str = "768x1024",
        style: str | None = None,
        negative_prompt: str | None = None,
        reference_image_url: str | None = None,
        reference_strength: float = 0.7,
    ) -> dict[str, Any]:
        """Generate an image using ComfyUI.

        Args:
            prompt: The text prompt for generation
            size: Image size as "WIDTHxHEIGHT"
            style: Optional style modifier
            negative_prompt: Things to avoid in the image
            reference_image_url: URL of reference image for IP-Adapter (character consistency)
            reference_strength: How strongly to follow reference (0.0-1.0)
        """
        start_time = time.time()

        # Parse size
        try:
            width, height = map(int, size.split("x"))
        except ValueError:
            width, height = 768, 1024

        # Default negative prompt for sexy companion images
        if not negative_prompt:
            negative_prompt = (
                "ugly, deformed, blurry, low quality, bad anatomy, "
                "watermark, text, signature, disfigured, "
                "bad hands, bad fingers, extra limbs, mutation"
            )

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Download and upload reference image if provided
                reference_image_filename = None
                if reference_image_url:
                    try:
                        # Download reference image
                        ref_response = await client.get(reference_image_url)
                        ref_response.raise_for_status()
                        reference_image_bytes = ref_response.content
                        logger.info("reference_image_downloaded", url=reference_image_url[:50])

                        # Upload to ComfyUI
                        reference_image_filename = await self._upload_reference_image(
                            client, reference_image_bytes
                        )
                        logger.info("reference_image_uploaded", filename=reference_image_filename)
                    except Exception as e:
                        logger.warning("reference_image_failed", error=str(e))

                # Build workflow (with or without IP-Adapter)
                if reference_image_filename:
                    workflow = self._build_workflow_with_ipadapter(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        width=width,
                        height=height,
                        checkpoint=self.default_checkpoint,
                        reference_image_filename=reference_image_filename,
                        reference_strength=reference_strength,
                    )
                else:
                    workflow = self._build_workflow(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        width=width,
                        height=height,
                        checkpoint=self.default_checkpoint,
                    )

                # Queue the prompt
                response = await client.post(
                    f"{self.base_url}/prompt",
                    json={"prompt": workflow},
                )
                response.raise_for_status()
                data = response.json()
                prompt_id = data["prompt_id"]

                logger.info("comfyui_queued", prompt_id=prompt_id, has_reference=bool(reference_image_filename))

                # Poll for completion
                image_data = await self._wait_for_completion(client, prompt_id)

                latency_ms = (time.time() - start_time) * 1000

                logger.info(
                    "comfyui_generated",
                    prompt_id=prompt_id,
                    latency_ms=latency_ms,
                    size=f"{width}x{height}",
                )

                return {
                    "image_data": image_data,
                    "format": "png",
                    "width": width,
                    "height": height,
                    "prompt_id": prompt_id,
                    "latency_ms": latency_ms,
                }

        except httpx.HTTPStatusError as e:
            logger.error(
                "comfyui_http_error",
                error=str(e),
                status_code=e.response.status_code,
            )
            raise
        except asyncio.TimeoutError:
            logger.error("comfyui_timeout")
            raise

    async def analyze(
        self,
        image_url: str,
        prompt: str | None = None,
    ) -> str:
        """ComfyUI doesn't support image analysis - use LLM vision instead."""
        raise NotImplementedError("ComfyUI does not support image analysis")

    async def _wait_for_completion(
        self,
        client: httpx.AsyncClient,
        prompt_id: str,
        poll_interval: float = 1.0,
        max_wait: float = 300.0,
    ) -> bytes:
        """Poll for completion and return image data."""
        start_time = time.time()

        while (time.time() - start_time) < max_wait:
            response = await client.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()

            if prompt_id in history:
                outputs = history[prompt_id].get("outputs", {})
                # Find the SaveImage node output (typically node 9)
                for node_id, output in outputs.items():
                    images = output.get("images", [])
                    if images:
                        image_info = images[0]
                        filename = image_info["filename"]
                        subfolder = image_info.get("subfolder", "")
                        img_type = image_info.get("type", "output")

                        # Fetch the image
                        params = {
                            "filename": filename,
                            "type": img_type,
                        }
                        if subfolder:
                            params["subfolder"] = subfolder

                        img_response = await client.get(
                            f"{self.base_url}/view",
                            params=params,
                        )
                        img_response.raise_for_status()
                        return img_response.content

            await asyncio.sleep(poll_interval)

        raise asyncio.TimeoutError(f"ComfyUI generation timed out after {max_wait}s")

    def _build_workflow(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        checkpoint: str,
        seed: int | None = None,
        steps: int = 25,
        cfg: float = 7.0,
    ) -> dict[str, Any]:
        """Build a ComfyUI workflow for image generation."""
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        return {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["4", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0],
                },
            },
            "4": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint,
                },
            },
            "5": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1,
                },
            },
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["4", 1],
                },
            },
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["4", 1],
                },
            },
            "8": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["3", 0],
                    "vae": ["4", 2],
                },
            },
            "9": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": f"api_{uuid.uuid4().hex[:8]}",
                    "images": ["8", 0],
                },
            },
        }

    async def _upload_reference_image(
        self,
        client: httpx.AsyncClient,
        image_data: bytes,
    ) -> str:
        """Upload reference image to ComfyUI and return filename."""
        filename = f"ref_{uuid.uuid4().hex[:8]}.png"

        # ComfyUI expects multipart form data
        files = {
            "image": (filename, image_data, "image/png"),
        }
        data = {
            "overwrite": "true",
            "subfolder": "campfire_refs",
        }

        response = await client.post(
            f"{self.base_url}/upload/image",
            files=files,
            data=data,
        )
        response.raise_for_status()
        result = response.json()

        # Return the path to use in LoadImage node
        subfolder = result.get("subfolder", "")
        name = result.get("name", filename)
        if subfolder:
            return f"{subfolder}/{name}"
        return name

    def _build_workflow_with_ipadapter(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        checkpoint: str,
        reference_image_filename: str,
        reference_strength: float = 0.7,
        seed: int | None = None,
        steps: int = 25,
        cfg: float = 7.0,
    ) -> dict[str, Any]:
        """Build a ComfyUI workflow with IP-Adapter for character consistency.

        Uses reference image to maintain visual consistency across generations.
        The reference_image_filename should be uploaded first via _upload_reference_image.
        """
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        return {
            # Load checkpoint
            "4": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint,
                },
            },
            # Load IP-Adapter with unified loader (loads both ipadapter and clip_vision)
            "10": {
                "class_type": "IPAdapterUnifiedLoader",
                "inputs": {
                    "model": ["4", 0],
                    "preset": "PLUS (high strength)",
                    "ipadapter": None,
                },
            },
            # Load reference image (uploaded via API)
            "12": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": reference_image_filename,
                },
            },
            # Apply IP-Adapter Advanced
            "13": {
                "class_type": "IPAdapterAdvanced",
                "inputs": {
                    "model": ["10", 0],
                    "ipadapter": ["10", 1],
                    "image": ["12", 0],
                    "weight": reference_strength,
                    "weight_type": "ease in-out",
                    "combine_embeds": "concat",
                    "start_at": 0.0,
                    "end_at": 1.0,
                    "embeds_scaling": "V only",
                },
            },
            # Positive prompt
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["4", 1],
                },
            },
            # Negative prompt
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["4", 1],
                },
            },
            # Empty latent
            "5": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1,
                },
            },
            # KSampler with IP-Adapter model
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["13", 0],  # Use IP-Adapter enhanced model
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0],
                },
            },
            # VAE Decode
            "8": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["3", 0],
                    "vae": ["4", 2],
                },
            },
            # Save Image
            "9": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": f"api_{uuid.uuid4().hex[:8]}",
                    "images": ["8", 0],
                },
            },
        }

    def _build_sdxl_workflow(
        self,
        prompt: str,
        negative_prompt: str,
        width: int = 832,
        height: int = 1216,
        seed: int | None = None,
        steps: int = 35,
        cfg: float = 9.0,
        sampler: str = "dpmpp_2m",
        scheduler: str = "karras",
    ) -> dict[str, Any]:
        """Build SDXL workflow with explicit VAE and optimized sampler settings.

        This workflow is optimized for high-quality portrait generation with:
        - Explicit VAE loading for better color/detail
        - DPM++ 2M sampler with Karras scheduler
        - Higher CFG for stronger prompt adherence
        """
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        return {
            # Load SDXL checkpoint
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": self.sdxl_checkpoint},
            },
            # Load VAE explicitly for better quality
            "2": {
                "class_type": "VAELoader",
                "inputs": {"vae_name": self.sdxl_vae},
            },
            # Positive prompt
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1],
                },
            },
            # Negative prompt
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["1", 1],
                },
            },
            # Empty latent at SDXL native resolution
            "5": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1,
                },
            },
            # KSampler with optimized settings
            "6": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": sampler,
                    "scheduler": scheduler,
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["3", 0],
                    "negative": ["4", 0],
                    "latent_image": ["5", 0],
                },
            },
            # VAE Decode with explicit VAE
            "7": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["6", 0],
                    "vae": ["2", 0],
                },
            },
            # Save Image
            "8": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": f"sdxl_{uuid.uuid4().hex[:8]}",
                    "images": ["7", 0],
                },
            },
        }

    def _build_sdxl_workflow_with_ipadapter(
        self,
        prompt: str,
        negative_prompt: str,
        reference_image_filename: str,
        width: int = 832,
        height: int = 1216,
        reference_strength: float = 0.6,
        seed: int | None = None,
        steps: int = 30,
        cfg: float = 8.5,
        sampler: str = "dpmpp_2m",
        scheduler: str = "karras",
    ) -> dict[str, Any]:
        """Build SDXL workflow with IP-Adapter for character consistency.

        Uses a reference image to maintain facial identity while allowing
        body type and hair color variations via text prompt.
        """
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        return {
            # Load SDXL checkpoint
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": self.sdxl_checkpoint},
            },
            # Load VAE explicitly
            "2": {
                "class_type": "VAELoader",
                "inputs": {"vae_name": self.sdxl_vae},
            },
            # Load CLIP Vision for IP-Adapter
            "3": {
                "class_type": "CLIPVisionLoader",
                "inputs": {"clip_name": self.clip_vision_model},
            },
            # Load IP-Adapter model
            "4": {
                "class_type": "IPAdapterModelLoader",
                "inputs": {"ipadapter_file": self.ipadapter_model},
            },
            # Load reference image (must be pre-uploaded to ComfyUI input folder)
            "5": {
                "class_type": "LoadImage",
                "inputs": {"image": reference_image_filename},
            },
            # Apply IP-Adapter
            "6": {
                "class_type": "IPAdapterApply",
                "inputs": {
                    "ipadapter": ["4", 0],
                    "clip_vision": ["3", 0],
                    "image": ["5", 0],
                    "model": ["1", 0],
                    "weight": reference_strength,
                    "noise": 0.0,
                    "weight_type": "linear",
                    "start_at": 0.0,
                    "end_at": 1.0,
                    "unfold_batch": False,
                },
            },
            # Positive prompt
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1],
                },
            },
            # Negative prompt
            "8": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["1", 1],
                },
            },
            # Empty latent
            "9": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1,
                },
            },
            # KSampler with IP-Adapter enhanced model
            "10": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": sampler,
                    "scheduler": scheduler,
                    "denoise": 1.0,
                    "model": ["6", 0],  # Use IP-Adapter enhanced model
                    "positive": ["7", 0],
                    "negative": ["8", 0],
                    "latent_image": ["9", 0],
                },
            },
            # VAE Decode with explicit VAE
            "11": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["10", 0],
                    "vae": ["2", 0],
                },
            },
            # Save Image
            "12": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": f"sdxl_ipa_{uuid.uuid4().hex[:8]}",
                    "images": ["11", 0],
                },
            },
        }

    async def health_check(self) -> bool:
        """Check if ComfyUI is reachable."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/system_stats")
                return response.status_code == 200
        except Exception:
            return False

    async def list_checkpoints(self) -> list[str]:
        """List available checkpoints."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/object_info")
                response.raise_for_status()
                data = response.json()

                # Get checkpoint list from CheckpointLoaderSimple node
                checkpoint_info = data.get("CheckpointLoaderSimple", {})
                input_info = checkpoint_info.get("input", {})
                required = input_info.get("required", {})
                ckpt_info = required.get("ckpt_name", [])

                if ckpt_info and len(ckpt_info) > 0:
                    return ckpt_info[0]
                return []
        except Exception as e:
            logger.error("comfyui_list_checkpoints_error", error=str(e))
            return []

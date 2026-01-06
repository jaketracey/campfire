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

# Model ID to checkpoint file mapping for ComfyUI
MODEL_TO_CHECKPOINT: dict[str, str] = {
    "comfyui/epicrealism": "epiCRealismXL_Pure_fix.safetensors",
    "comfyui/sdxl-base": "sd_xl_base_1.0.safetensors",
    "comfyui/sdxl-turbo": "sd_xl_turbo_1.0_fp16.safetensors",
}


class ComfyUIProvider(ImageProvider):
    """ComfyUI image generation provider for local/self-hosted SDXL."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.comfyui_base_url.rstrip("/")
        self.default_checkpoint = settings.comfyui_default_checkpoint
        self.timeout = settings.comfyui_timeout

        # SDXL-specific settings
        self.sdxl_checkpoint = getattr(settings, "comfyui_sdxl_checkpoint", "RealVisXL_V4.0.safetensors")
        self.sdxl_vae = getattr(settings, "comfyui_sdxl_vae", "sdxl_vae.safetensors")
        self.ipadapter_model = getattr(settings, "comfyui_ipadapter_model", "ip-adapter-plus_sdxl_vit-h.safetensors")
        self.clip_vision_model = getattr(settings, "comfyui_clip_vision_model", "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors")

        # Quality enhancement settings
        self.detail_lora = getattr(settings, "comfyui_detail_lora", "detail_tweaker_xl.safetensors")
        self.detail_lora_strength = getattr(settings, "comfyui_detail_lora_strength", 0.3)
        self.skin_lora = getattr(settings, "comfyui_skin_lora", "skin_realism_sdxl.safetensors")
        self.skin_lora_strength = getattr(settings, "comfyui_skin_lora_strength", 0.4)
        self.faces_lora = getattr(settings, "comfyui_faces_lora", "better_faces_sdxl.safetensors")
        self.faces_lora_strength = getattr(settings, "comfyui_faces_lora_strength", 0.5)
        self.upscale_model = getattr(settings, "comfyui_upscale_model", "RealESRGAN_x4plus.pth")
        self.enable_upscale = getattr(settings, "comfyui_enable_upscale", False)

    @property
    def name(self) -> str:
        return "comfyui"

    async def generate(
        self,
        prompt: str,
        size: str = "768x1024",
        style: str | None = None,
        negative_prompt: str | None = None,
        model_id: str | None = None,
        reference_image_url: str | None = None,
        reference_strength: float = 0.7,
        is_anchor: bool = False,
    ) -> dict[str, Any]:
        """Generate an image using ComfyUI.

        Args:
            prompt: The text prompt for generation
            size: Image size as "WIDTHxHEIGHT"
            style: Optional style modifier
            negative_prompt: Things to avoid in the image
            model_id: The model ID to use (e.g., "comfyui/epicrealism").
                     Maps to a checkpoint file. If None, uses default checkpoint.
            reference_image_url: URL of reference image for IP-Adapter (character consistency)
            reference_strength: How strongly to follow reference (0.0-1.0)
            is_anchor: If True, use high-quality anchor workflow (more steps, no upscaling)
        """
        start_time = time.time()

        # Select checkpoint based on model_id
        checkpoint = MODEL_TO_CHECKPOINT.get(model_id, self.default_checkpoint) if model_id else self.default_checkpoint
        logger.debug("comfyui_checkpoint_selected", model_id=model_id, checkpoint=checkpoint)

        # Parse size
        try:
            width, height = map(int, size.split("x"))
        except ValueError:
            width, height = 768, 1024

        negative_prompt = negative_prompt or ""

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Download and upload reference image if provided
                reference_image_filename = None
                if reference_image_url:
                    try:
                        # Download reference image
                        logger.info("reference_image_downloading", url=reference_image_url[:100])
                        ref_response = await client.get(reference_image_url)
                        ref_response.raise_for_status()
                        reference_image_bytes = ref_response.content
                        logger.info(
                            "reference_image_downloaded",
                            url=reference_image_url[:50],
                            size_bytes=len(reference_image_bytes),
                        )

                        # Upload to ComfyUI
                        reference_image_filename = await self._upload_reference_image(
                            client, reference_image_bytes
                        )
                        logger.info("reference_image_uploaded", filename=reference_image_filename)
                    except httpx.HTTPStatusError as e:
                        logger.error(
                            "reference_image_download_failed",
                            error=str(e),
                            status_code=e.response.status_code,
                            url=reference_image_url[:100],
                        )
                        # Re-raise so caller knows IP-Adapter won't work
                        raise RuntimeError(f"Failed to download reference image: {e}")
                    except Exception as e:
                        logger.error(
                            "reference_image_failed",
                            error=str(e),
                            error_type=type(e).__name__,
                            url=reference_image_url[:100] if reference_image_url else None,
                        )
                        # Re-raise so caller knows IP-Adapter won't work
                        raise RuntimeError(f"Reference image processing failed: {e}")

                # Build workflow based on image type
                use_ipadapter = bool(reference_image_filename)

                if use_ipadapter:
                    # Use high-quality anchor workflow for ALL images with references
                    # This ensures consistent quality between anchor and session images
                    # Settings: 45 steps, CFG 8.0, no LoRA, no upscaling, PrepImageForClipVision
                    workflow = self._build_anchor_workflow(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        width=width,
                        height=height,
                        checkpoint=checkpoint,
                        reference_image_filename=reference_image_filename,
                        reference_strength=reference_strength,
                    )
                    logger.info("using_anchor_workflow", is_anchor=is_anchor, model_id=model_id)
                else:
                    workflow = self._build_workflow(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        width=width,
                        height=height,
                        checkpoint=checkpoint,
                    )

                # Queue the prompt
                logger.info(
                    "comfyui_queueing",
                    workflow_type="anchor" if use_ipadapter else "basic",
                    has_reference=use_ipadapter,
                    reference_file=reference_image_filename,
                    width=width,
                    height=height,
                    prompt_preview=prompt[:100] if prompt else None,
                )
                response = await client.post(
                    f"{self.base_url}/prompt",
                    json={"prompt": workflow},
                )
                response.raise_for_status()
                data = response.json()
                prompt_id = data["prompt_id"]

                logger.info("comfyui_queued", prompt_id=prompt_id, has_reference=use_ipadapter)

                # Poll for completion - with fallback if IP-Adapter fails
                try:
                    image_data = await self._wait_for_completion(client, prompt_id)
                except RuntimeError as e:
                    if use_ipadapter and ("IPAdapter" in str(e) or "Resampler" in str(e)):
                        # IP-Adapter failed, fallback to regular workflow
                        logger.warning(
                            "ipadapter_fallback",
                            error=str(e),
                            message="IP-Adapter failed, falling back to regular workflow"
                        )

                        # Build and queue regular workflow
                        workflow = self._build_workflow(
                            prompt=prompt,
                            negative_prompt=negative_prompt,
                            width=width,
                            height=height,
                            checkpoint=checkpoint,
                        )

                        response = await client.post(
                            f"{self.base_url}/prompt",
                            json={"prompt": workflow},
                        )
                        response.raise_for_status()
                        data = response.json()
                        prompt_id = data["prompt_id"]

                        logger.info("comfyui_queued_fallback", prompt_id=prompt_id)
                        image_data = await self._wait_for_completion(client, prompt_id)
                    else:
                        raise

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
        max_wait: float = 120.0,  # Reduced from 300s
    ) -> bytes:
        """Poll for completion and return image data."""
        start_time = time.time()

        while (time.time() - start_time) < max_wait:
            response = await client.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()

            if prompt_id in history:
                # Check for execution errors
                status = history[prompt_id].get("status", {})
                if status.get("status_str") == "error":
                    # Extract error message from the last message
                    messages = status.get("messages", [])
                    error_msg = "Unknown error"
                    for msg in messages:
                        if msg[0] == "execution_error":
                            error_msg = msg[1].get("exception_message", "Unknown error")
                            break
                    raise RuntimeError(f"ComfyUI execution error: {error_msg}")

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
        steps: int = 25,  # Increased for higher quality
        cfg: float = 7.5,  # Slightly higher for better prompt adherence
        sampler: str = "dpmpp_2m",  # DPM++ 2M for higher quality
        scheduler: str = "karras",  # Karras scheduler for smoother results
    ) -> dict[str, Any]:
        """Build a ComfyUI workflow for image generation.

        Uses DPM++ 2M sampler with Karras scheduler for high-quality output.
        """
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        return {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": sampler,
                    "scheduler": scheduler,
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
        steps: int = 25,  # Increased for higher quality
        cfg: float = 7.5,  # Slightly higher for better prompt adherence
        sampler: str = "dpmpp_2m",  # DPM++ 2M for higher quality
        scheduler: str = "karras",  # Karras scheduler for smoother results
    ) -> dict[str, Any]:
        """Build a ComfyUI workflow with IP-Adapter for character consistency.

        Uses reference image to maintain visual consistency across generations.
        The reference_image_filename should be uploaded first via _upload_reference_image.
        Uses DPM++ 2M sampler with Karras scheduler for high-quality output.
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
                    "sampler_name": sampler,
                    "scheduler": scheduler,
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

    def _build_hq_workflow_with_ipadapter(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        checkpoint: str,
        reference_image_filename: str,
        reference_strength: float = 0.7,
        seed: int | None = None,
        steps: int = 30,  # More steps for higher quality
        cfg: float = 7.5,
        sampler: str = "dpmpp_2m",
        scheduler: str = "karras",
        lora_name: str | None = None,
        lora_strength: float = 0.5,
        upscale_model: str | None = None,
    ) -> dict[str, Any]:
        """Build a high-quality ComfyUI workflow with IP-Adapter, LoRA, and upscaling.

        Enhanced version of the IP-Adapter workflow with:
        - Optional LoRA loading for quality enhancement (detail_tweaker_xl)
        - Optional RealESRGAN upscaling for higher resolution output
        - Optimized sampler settings for portrait quality
        """
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        workflow: dict[str, Any] = {
            # Load checkpoint
            "4": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint,
                },
            },
        }

        # Model source for IP-Adapter - either from checkpoint or LoRA
        model_source = ["4", 0]
        clip_source = ["4", 1]

        # Optionally add LoRA for quality enhancement
        if lora_name:
            workflow["14"] = {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": lora_name,
                    "strength_model": lora_strength,
                    "strength_clip": lora_strength,
                    "model": ["4", 0],
                    "clip": ["4", 1],
                },
            }
            model_source = ["14", 0]
            clip_source = ["14", 1]

        # Add IP-Adapter nodes
        workflow.update({
            # Load IP-Adapter with unified loader
            "10": {
                "class_type": "IPAdapterUnifiedLoader",
                "inputs": {
                    "model": model_source,
                    "preset": "PLUS (high strength)",
                    "ipadapter": None,
                },
            },
            # Load reference image
            "12": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": reference_image_filename,
                },
            },
            # Prep image for CLIP Vision (proper scaling, not center crop)
            "17": {
                "class_type": "PrepImageForClipVision",
                "inputs": {
                    "image": ["12", 0],
                    "interpolation": "LANCZOS",
                    "crop_position": "center",
                    "sharpening": 0.0,
                },
            },
            # Apply IP-Adapter Advanced with prepped image
            "13": {
                "class_type": "IPAdapterAdvanced",
                "inputs": {
                    "model": ["10", 0],
                    "ipadapter": ["10", 1],
                    "image": ["17", 0],  # Use prepped image for proper scaling
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
                    "clip": clip_source,
                },
            },
            # Negative prompt
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": clip_source,
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
                    "sampler_name": sampler,
                    "scheduler": scheduler,
                    "denoise": 1.0,
                    "model": ["13", 0],
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
        })

        # Final image source - either from VAE or upscaler
        image_source = ["8", 0]

        # Optionally add upscaling
        if upscale_model:
            workflow["15"] = {
                "class_type": "UpscaleModelLoader",
                "inputs": {
                    "model_name": upscale_model,
                },
            }
            workflow["16"] = {
                "class_type": "ImageUpscaleWithModel",
                "inputs": {
                    "upscale_model": ["15", 0],
                    "image": ["8", 0],
                },
            }
            image_source = ["16", 0]

        # Save Image (from upscaler if enabled, otherwise from VAE)
        workflow["9"] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": f"hq_{uuid.uuid4().hex[:8]}",
                "images": image_source,
            },
        }

        return workflow

    def _build_anchor_workflow(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        checkpoint: str,
        reference_image_filename: str | None = None,
        reference_strength: float = 0.85,
        seed: int | None = None,
        steps: int = 45,  # Higher steps for anchor quality
        cfg: float = 7.0,  # Balanced CFG for epiCRealism
        sampler: str = "dpmpp_2m",
        scheduler: str = "karras",
    ) -> dict[str, Any]:
        """Build a high-quality anchor image workflow optimized for character identity.

        Anchor images are the reference images used for all subsequent generations.
        This workflow prioritizes quality over speed:
        - 45 steps (vs 30 for regular)
        - CFG 7.0 (balanced for epiCRealism)
        - Quality LoRAs (skin, faces, detail)
        - No upscaling (native resolution)
        - PrepImageForClipVision for proper reference handling
        """
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        workflow: dict[str, Any] = {
            # Load checkpoint
            "4": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint,
                },
            },
            # LoRA chain for quality enhancement
            # Skin realism LoRA
            "20": {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": self.skin_lora,
                    "strength_model": self.skin_lora_strength,
                    "strength_clip": self.skin_lora_strength,
                    "model": ["4", 0],
                    "clip": ["4", 1],
                },
            },
            # Better faces LoRA
            "21": {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": self.faces_lora,
                    "strength_model": self.faces_lora_strength,
                    "strength_clip": self.faces_lora_strength,
                    "model": ["20", 0],
                    "clip": ["20", 1],
                },
            },
            # Detail tweaker LoRA
            "22": {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": self.detail_lora,
                    "strength_model": self.detail_lora_strength,
                    "strength_clip": self.detail_lora_strength,
                    "model": ["21", 0],
                    "clip": ["21", 1],
                },
            },
            # Positive prompt (uses LoRA-enhanced clip)
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["22", 1],
                },
            },
            # Negative prompt (uses LoRA-enhanced clip)
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["22", 1],
                },
            },
            # Empty latent at high resolution
            "5": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1,
                },
            },
        }

        # If reference image provided, add IP-Adapter with PrepImageForClipVision
        if reference_image_filename:
            workflow.update({
                # Load IP-Adapter (uses LoRA-enhanced model)
                "10": {
                    "class_type": "IPAdapterUnifiedLoader",
                    "inputs": {
                        "model": ["22", 0],
                        "preset": "PLUS (high strength)",
                        "ipadapter": None,
                    },
                },
                # Load reference image
                "12": {
                    "class_type": "LoadImage",
                    "inputs": {
                        "image": reference_image_filename,
                    },
                },
                # Prep image for CLIP Vision (proper scaling, not center crop)
                "17": {
                    "class_type": "PrepImageForClipVision",
                    "inputs": {
                        "image": ["12", 0],
                        "interpolation": "LANCZOS",
                        "crop_position": "center",
                        "sharpening": 0.0,
                    },
                },
                # Apply IP-Adapter with prepared image
                "13": {
                    "class_type": "IPAdapterAdvanced",
                    "inputs": {
                        "model": ["10", 0],
                        "ipadapter": ["10", 1],
                        "image": ["17", 0],  # Use prepped image
                        "weight": reference_strength,
                        "weight_type": "ease in-out",
                        "combine_embeds": "concat",
                        "start_at": 0.0,
                        "end_at": 1.0,
                        "embeds_scaling": "V only",
                    },
                },
            })
            model_source = ["13", 0]
        else:
            # Use LoRA-enhanced model (no IP-Adapter)
            model_source = ["22", 0]

        # KSampler with high quality settings
        workflow["3"] = {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": 1.0,
                "model": model_source,
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        }

        # VAE Decode
        workflow["8"] = {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2],
            },
        }

        # Save Image (no upscaling for anchors)
        workflow["9"] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": f"anchor_{uuid.uuid4().hex[:8]}",
                "images": ["8", 0],
            },
        }

        return workflow

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

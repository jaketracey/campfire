"""AnimateDiff video generation provider (via ComfyUI)."""

import asyncio
import time
import uuid
from typing import Any

import httpx
import structlog

from orchestrator.config import Settings

logger = structlog.get_logger()


class AnimateDiffProvider:
    """AnimateDiff video generation provider using ComfyUI backend.

    Generates short video clips using AnimateDiff motion module with
    optional IP-Adapter for character consistency.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.animatediff_base_url.rstrip("/")
        self.timeout = settings.animatediff_timeout
        self.checkpoint = settings.comfyui_default_checkpoint
        self.motion_module = settings.animatediff_motion_module
        self.default_frames = settings.animatediff_default_frames
        self.default_fps = settings.animatediff_default_fps
        self.default_width = settings.animatediff_default_width
        self.default_height = settings.animatediff_default_height
        self.video_format = settings.animatediff_video_format

    @property
    def name(self) -> str:
        return "animatediff"

    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int | None = None,
        height: int | None = None,
        frames: int | None = None,
        fps: int | None = None,
        reference_image_url: str | None = None,
        reference_strength: float = 0.7,
    ) -> dict[str, Any]:
        """Generate a video using AnimateDiff.

        Args:
            prompt: The text prompt describing the video action
            negative_prompt: Things to avoid in the video
            width: Video width in pixels
            height: Video height in pixels
            frames: Number of frames to generate
            fps: Frames per second for output
            reference_image_url: URL of reference image for IP-Adapter
            reference_strength: How strongly to follow reference (0.0-1.0)

        Returns:
            dict with video_data (bytes), format, dimensions, and latency info
        """
        start_time = time.time()

        # Use defaults if not specified
        width = width or self.default_width
        height = height or self.default_height
        frames = frames or self.default_frames
        fps = fps or self.default_fps

        # Default negative prompt for quality
        if not negative_prompt:
            negative_prompt = (
                "ugly, deformed, blurry, low quality, bad anatomy, "
                "watermark, text, signature, disfigured, cropped, "
                "bad hands, bad fingers, extra limbs, mutation, "
                "worst quality, low resolution, artifacts, noise, "
                "static, frozen, jerky motion, glitches"
            )

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Upload reference image if provided
                reference_image_filename = None
                if reference_image_url:
                    try:
                        logger.info("animatediff_downloading_reference", url=reference_image_url[:100])
                        ref_response = await client.get(reference_image_url)
                        ref_response.raise_for_status()
                        reference_image_bytes = ref_response.content

                        # Upload to ComfyUI
                        reference_image_filename = await self._upload_reference_image(
                            client, reference_image_bytes
                        )
                        logger.info("animatediff_reference_uploaded", filename=reference_image_filename)
                    except Exception as e:
                        logger.warning("animatediff_reference_failed", error=str(e))
                        # Continue without reference

                # Build the AnimateDiff workflow
                if reference_image_filename:
                    workflow = self._build_workflow_with_ipadapter(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        width=width,
                        height=height,
                        frames=frames,
                        fps=fps,
                        reference_image_filename=reference_image_filename,
                        reference_strength=reference_strength,
                    )
                else:
                    workflow = self._build_workflow(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        width=width,
                        height=height,
                        frames=frames,
                        fps=fps,
                    )

                # Queue the prompt
                logger.info(
                    "animatediff_queueing",
                    has_reference=bool(reference_image_filename),
                    width=width,
                    height=height,
                    frames=frames,
                    fps=fps,
                )

                response = await client.post(
                    f"{self.base_url}/prompt",
                    json={"prompt": workflow},
                )
                response.raise_for_status()
                data = response.json()
                prompt_id = data["prompt_id"]

                logger.info("animatediff_queued", prompt_id=prompt_id)

                # Poll for completion
                video_data = await self._wait_for_completion(client, prompt_id)

                latency_ms = (time.time() - start_time) * 1000
                duration_seconds = frames / fps

                logger.info(
                    "animatediff_generated",
                    prompt_id=prompt_id,
                    latency_ms=latency_ms,
                    duration_seconds=duration_seconds,
                )

                return {
                    "video_data": video_data,
                    "format": "mp4",
                    "width": width,
                    "height": height,
                    "frames": frames,
                    "fps": fps,
                    "duration_seconds": duration_seconds,
                    "prompt_id": prompt_id,
                    "latency_ms": latency_ms,
                }

        except httpx.HTTPStatusError as e:
            logger.error(
                "animatediff_http_error",
                error=str(e),
                status_code=e.response.status_code,
            )
            raise
        except asyncio.TimeoutError:
            logger.error("animatediff_timeout")
            raise

    async def _upload_reference_image(
        self,
        client: httpx.AsyncClient,
        image_data: bytes,
    ) -> str:
        """Upload reference image to ComfyUI and return filename."""
        filename = f"video_ref_{uuid.uuid4().hex[:8]}.png"

        files = {
            "image": (filename, image_data, "image/png"),
        }
        data = {
            "overwrite": "true",
            "subfolder": "campfire_video_refs",
        }

        response = await client.post(
            f"{self.base_url}/upload/image",
            files=files,
            data=data,
        )
        response.raise_for_status()
        result = response.json()

        subfolder = result.get("subfolder", "")
        name = result.get("name", filename)
        if subfolder:
            return f"{subfolder}/{name}"
        return name

    async def _wait_for_completion(
        self,
        client: httpx.AsyncClient,
        prompt_id: str,
        poll_interval: float = 2.0,
        max_wait: float = 600.0,
    ) -> bytes:
        """Poll for completion and return video data."""
        start_time = time.time()

        while (time.time() - start_time) < max_wait:
            response = await client.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()

            if prompt_id in history:
                # Check for execution errors
                status = history[prompt_id].get("status", {})
                if status.get("status_str") == "error":
                    messages = status.get("messages", [])
                    error_msg = "Unknown error"
                    for msg in messages:
                        if msg[0] == "execution_error":
                            error_msg = msg[1].get("exception_message", "Unknown error")
                            break
                    raise RuntimeError(f"AnimateDiff execution error: {error_msg}")

                outputs = history[prompt_id].get("outputs", {})
                # Find the VHS_VideoCombine node output
                for node_id, output in outputs.items():
                    gifs = output.get("gifs", [])
                    if gifs:
                        # VHS returns videos in 'gifs' key despite format
                        video_info = gifs[0]
                        filename = video_info["filename"]
                        subfolder = video_info.get("subfolder", "")

                        # Fetch the video file
                        params = {
                            "filename": filename,
                            "type": "output",
                        }
                        if subfolder:
                            params["subfolder"] = subfolder

                        video_response = await client.get(
                            f"{self.base_url}/view",
                            params=params,
                        )
                        video_response.raise_for_status()
                        return video_response.content

            await asyncio.sleep(poll_interval)

        raise asyncio.TimeoutError(f"AnimateDiff generation timed out after {max_wait}s")

    def _build_workflow(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        frames: int,
        fps: int,
        seed: int | None = None,
        steps: int = 25,
        cfg: float = 7.0,
    ) -> dict[str, Any]:
        """Build AnimateDiff workflow for video generation.

        Uses:
        - CheckpointLoaderSimple for the base model
        - ADE_AnimateDiffLoaderWithContext for motion module
        - EmptyLatentImage for frames
        - KSampler for generation
        - VHS_VideoCombine for MP4 output
        """
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        return {
            # Load checkpoint
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": self.checkpoint,
                },
            },
            # Load AnimateDiff motion module
            "2": {
                "class_type": "ADE_AnimateDiffLoaderWithContext",
                "inputs": {
                    "model_name": self.motion_module,
                    "beta_schedule": "sqrt_linear (AnimateDiff)",
                    "motion_scale": 1.0,
                    "apply_v2_models_properly": False,
                    "model": ["1", 0],
                    "context_options": ["3", 0],
                },
            },
            # AnimateDiff context options
            "3": {
                "class_type": "ADE_StandardUniformContextOptions",
                "inputs": {
                    "context_length": 16,
                    "context_stride": 1,
                    "context_overlap": 4,
                    "closed_loop": False,
                    "fuse_method": "flat",
                },
            },
            # Empty latent with frames
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": frames,
                },
            },
            # Positive prompt
            "5": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1],
                },
            },
            # Negative prompt
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["1", 1],
                },
            },
            # KSampler
            "7": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["2", 0],
                    "positive": ["5", 0],
                    "negative": ["6", 0],
                    "latent_image": ["4", 0],
                },
            },
            # VAE Decode
            "8": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["7", 0],
                    "vae": ["1", 2],
                },
            },
            # VHS Video Combine - output as MP4
            "9": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "frame_rate": fps,
                    "loop_count": 0,
                    "filename_prefix": f"video_{uuid.uuid4().hex[:8]}",
                    "format": self.video_format,
                    "pingpong": False,
                    "save_output": True,
                    "images": ["8", 0],
                },
            },
        }

    def _build_workflow_with_ipadapter(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        frames: int,
        fps: int,
        reference_image_filename: str,
        reference_strength: float = 0.7,
        seed: int | None = None,
        steps: int = 25,
        cfg: float = 7.0,
    ) -> dict[str, Any]:
        """Build AnimateDiff workflow with IP-Adapter for character consistency.

        Uses IP-Adapter to maintain character identity across video frames.
        """
        if seed is None:
            seed = int(time.time() * 1000) % (2**31)

        return {
            # Load checkpoint
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": self.checkpoint,
                },
            },
            # Load IP-Adapter with unified loader
            "10": {
                "class_type": "IPAdapterUnifiedLoader",
                "inputs": {
                    "model": ["1", 0],
                    "preset": "PLUS (high strength)",
                    "ipadapter": None,
                },
            },
            # Load reference image
            "11": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": reference_image_filename,
                },
            },
            # Prep image for CLIP Vision
            "12": {
                "class_type": "PrepImageForClipVision",
                "inputs": {
                    "image": ["11", 0],
                    "interpolation": "LANCZOS",
                    "crop_position": "center",
                    "sharpening": 0.0,
                },
            },
            # Apply IP-Adapter
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
            # Load AnimateDiff motion module (uses IP-Adapter enhanced model)
            "2": {
                "class_type": "ADE_AnimateDiffLoaderWithContext",
                "inputs": {
                    "model_name": self.motion_module,
                    "beta_schedule": "sqrt_linear (AnimateDiff)",
                    "motion_scale": 1.0,
                    "apply_v2_models_properly": False,
                    "model": ["13", 0],  # Use IP-Adapter enhanced model
                    "context_options": ["3", 0],
                },
            },
            # AnimateDiff context options
            "3": {
                "class_type": "ADE_StandardUniformContextOptions",
                "inputs": {
                    "context_length": 16,
                    "context_stride": 1,
                    "context_overlap": 4,
                    "closed_loop": False,
                    "fuse_method": "flat",
                },
            },
            # Empty latent with frames
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": frames,
                },
            },
            # Positive prompt
            "5": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1],
                },
            },
            # Negative prompt
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["1", 1],
                },
            },
            # KSampler with AnimateDiff model
            "7": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["2", 0],
                    "positive": ["5", 0],
                    "negative": ["6", 0],
                    "latent_image": ["4", 0],
                },
            },
            # VAE Decode
            "8": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["7", 0],
                    "vae": ["1", 2],
                },
            },
            # VHS Video Combine - output as MP4
            "9": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "frame_rate": fps,
                    "loop_count": 0,
                    "filename_prefix": f"video_{uuid.uuid4().hex[:8]}",
                    "format": self.video_format,
                    "pingpong": False,
                    "save_output": True,
                    "images": ["8", 0],
                },
            },
        }

    async def health_check(self) -> bool:
        """Check if AnimateDiff/ComfyUI is reachable."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/system_stats")
                return response.status_code == 200
        except Exception:
            return False

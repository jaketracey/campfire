#!/usr/bin/env python3
"""Generate companion portrait images using ComfyUI with SDXL and IP-Adapter.

Two-phase generation:
1. Anchors: Generate one base face per ethnicity (7 images)
2. Variations: Use IP-Adapter to generate body/hair variations (140 images)

Usage:
    # Set up SSH tunnel first (if not already running):
    ssh -L 8188:localhost:8188 -p 2222 jake@home

    # Use the orchestrator venv (has httpx installed):
    cd /Users/jake/Projects/campfire
    PYTHON=packages/orchestrator/.venv/bin/python

    # Generate anchors only (~5 min)
    $PYTHON scripts/generate_companion_portraits.py --phase anchors

    # Generate variations only (~2-3 hours, requires anchors)
    $PYTHON scripts/generate_companion_portraits.py --phase variations

    # Generate everything
    $PYTHON scripts/generate_companion_portraits.py --all

    # Resume from progress file
    $PYTHON scripts/generate_companion_portraits.py --resume

    # Check progress
    $PYTHON scripts/generate_companion_portraits.py --stats
"""

import argparse
import asyncio
import base64
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

import httpx

# Add scripts dir to path for imports
sys.path.insert(0, str(Path(__file__).parent))
from companion_prompts import (
    ETHNICITIES,
    BODY_TYPES,
    HAIR_COLORS,
    TOTAL_PERMUTATIONS,
    build_anchor_prompt,
    build_variation_prompt,
)

# Configuration
COMFYUI_URL = "http://localhost:8188"
OUTPUT_DIR = Path(__file__).parent.parent / "packages/web/public/images/companions"
ANCHORS_DIR = OUTPUT_DIR / "anchors"
PROGRESS_FILE = Path(__file__).parent / ".companion_progress.json"

# Generation parameters
SDXL_CHECKPOINT = "sd_xl_base_1.0.safetensors"
SDXL_VAE = "sdxl_vae.safetensors"
IPADAPTER_MODEL = "ip-adapter-plus_sdxl_vit-h.safetensors"

ANCHOR_CONFIG = {
    "width": 832,
    "height": 1216,
    "steps": 35,
    "cfg": 9.0,
    "sampler": "dpmpp_2m",
    "scheduler": "karras",
}

VARIATION_CONFIG = {
    "width": 832,
    "height": 1216,
    "steps": 30,
    "cfg": 8.5,
    "sampler": "dpmpp_2m",
    "scheduler": "karras",
    "ipadapter_weight": 0.6,
}


class ComfyUIClient:
    """Async client for ComfyUI API."""

    def __init__(self, base_url: str = COMFYUI_URL, timeout: float = 300.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=self.timeout)
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()

    @property
    def client(self) -> httpx.AsyncClient:
        if not self._client:
            raise RuntimeError("Client not initialized. Use 'async with' context.")
        return self._client

    async def health_check(self) -> bool:
        """Check if ComfyUI is reachable."""
        try:
            response = await self.client.get(f"{self.base_url}/system_stats")
            return response.status_code == 200
        except Exception:
            return False

    async def queue_prompt(self, workflow: dict[str, Any]) -> str:
        """Queue a prompt and return the prompt_id."""
        response = await self.client.post(
            f"{self.base_url}/prompt",
            json={"prompt": workflow},
        )
        response.raise_for_status()
        return response.json()["prompt_id"]

    async def wait_for_completion(
        self,
        prompt_id: str,
        poll_interval: float = 2.0,
        max_wait: float = 300.0,
    ) -> dict[str, Any] | None:
        """Poll for completion and return outputs."""
        start = time.time()
        while (time.time() - start) < max_wait:
            response = await self.client.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()

            if prompt_id in history:
                return history[prompt_id].get("outputs", {})

            await asyncio.sleep(poll_interval)

        return None

    async def download_image(self, filename: str, subfolder: str = "", img_type: str = "output") -> bytes:
        """Download a generated image."""
        params = {"filename": filename, "type": img_type}
        if subfolder:
            params["subfolder"] = subfolder

        response = await self.client.get(f"{self.base_url}/view", params=params)
        response.raise_for_status()
        return response.content

    async def upload_image(self, image_data: bytes, filename: str) -> dict[str, str]:
        """Upload an image to ComfyUI for use as input."""
        files = {"image": (filename, image_data, "image/png")}
        response = await self.client.post(f"{self.base_url}/upload/image", files=files)
        response.raise_for_status()
        return response.json()


def build_anchor_workflow(
    positive: str,
    negative: str,
    seed: int | None = None,
) -> dict[str, Any]:
    """Build SDXL workflow for anchor generation (no IP-Adapter)."""
    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    return {
        # Load checkpoint
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": SDXL_CHECKPOINT},
        },
        # Load VAE explicitly for better quality
        "2": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": SDXL_VAE},
        },
        # Positive prompt
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": positive,
                "clip": ["1", 1],
            },
        },
        # Negative prompt
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative,
                "clip": ["1", 1],
            },
        },
        # Empty latent
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": ANCHOR_CONFIG["width"],
                "height": ANCHOR_CONFIG["height"],
                "batch_size": 1,
            },
        },
        # KSampler
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": ANCHOR_CONFIG["steps"],
                "cfg": ANCHOR_CONFIG["cfg"],
                "sampler_name": ANCHOR_CONFIG["sampler"],
                "scheduler": ANCHOR_CONFIG["scheduler"],
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
                "filename_prefix": f"anchor_{seed}",
                "images": ["7", 0],
            },
        },
    }


def build_variation_workflow(
    positive: str,
    negative: str,
    reference_image_name: str,  # Unused for now - kept for future IP-Adapter support
    seed: int | None = None,
) -> dict[str, Any]:
    """Build SDXL workflow for variation generation.

    Note: IP-Adapter is disabled due to model compatibility issues.
    Using strong weighted prompts instead for differentiation.
    """
    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    return {
        # Load checkpoint
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": SDXL_CHECKPOINT},
        },
        # Load VAE explicitly for better quality
        "2": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": SDXL_VAE},
        },
        # Positive prompt
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": positive,
                "clip": ["1", 1],
            },
        },
        # Negative prompt
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative,
                "clip": ["1", 1],
            },
        },
        # Empty latent at SDXL resolution
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": VARIATION_CONFIG["width"],
                "height": VARIATION_CONFIG["height"],
                "batch_size": 1,
            },
        },
        # KSampler with SDXL settings
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": VARIATION_CONFIG["steps"],
                "cfg": VARIATION_CONFIG["cfg"],
                "sampler_name": VARIATION_CONFIG["sampler"],
                "scheduler": VARIATION_CONFIG["scheduler"],
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
                "filename_prefix": f"variation_{seed}",
                "images": ["7", 0],
            },
        },
    }


class ProgressTracker:
    """Track generation progress with JSON persistence."""

    def __init__(self, path: Path = PROGRESS_FILE):
        self.path = path
        self.data: dict[str, Any] = {
            "anchors": {},  # ethnicity -> {"completed": bool, "seed": int}
            "variations": {},  # "eth-body-hair" -> {"completed": bool, "seed": int}
            "started_at": None,
            "last_updated": None,
        }
        self.load()

    def load(self):
        if self.path.exists():
            with open(self.path) as f:
                self.data = json.load(f)

    def save(self):
        self.data["last_updated"] = time.strftime("%Y-%m-%d %H:%M:%S")
        if not self.data["started_at"]:
            self.data["started_at"] = self.data["last_updated"]
        with open(self.path, "w") as f:
            json.dump(self.data, f, indent=2)

    def is_anchor_done(self, ethnicity: str) -> bool:
        return self.data["anchors"].get(ethnicity, {}).get("completed", False)

    def mark_anchor_done(self, ethnicity: str, seed: int):
        self.data["anchors"][ethnicity] = {"completed": True, "seed": seed}
        self.save()

    def is_variation_done(self, ethnicity: str, body_type: str, hair_color: str) -> bool:
        key = f"{ethnicity}-{body_type}-{hair_color}"
        return self.data["variations"].get(key, {}).get("completed", False)

    def mark_variation_done(self, ethnicity: str, body_type: str, hair_color: str, seed: int):
        key = f"{ethnicity}-{body_type}-{hair_color}"
        self.data["variations"][key] = {"completed": True, "seed": seed}
        self.save()

    def get_stats(self) -> dict[str, int]:
        anchors_done = sum(1 for v in self.data["anchors"].values() if v.get("completed"))
        variations_done = sum(1 for v in self.data["variations"].values() if v.get("completed"))
        return {
            "anchors_done": anchors_done,
            "anchors_total": len(ETHNICITIES),
            "variations_done": variations_done,
            "variations_total": TOTAL_PERMUTATIONS,
        }


async def generate_anchor(
    client: ComfyUIClient,
    ethnicity: str,
    progress: ProgressTracker,
    max_retries: int = 3,
) -> bool:
    """Generate a single anchor image."""
    if progress.is_anchor_done(ethnicity):
        print(f"  [skip] {ethnicity} anchor already exists")
        return True

    output_path = ANCHORS_DIR / f"{ethnicity}.png"

    for attempt in range(max_retries):
        try:
            positive, negative = build_anchor_prompt(ethnicity)
            seed = random.randint(0, 2**31 - 1)
            workflow = build_anchor_workflow(positive, negative, seed)

            print(f"  [{attempt+1}/{max_retries}] Generating {ethnicity} anchor (seed: {seed})...")
            prompt_id = await client.queue_prompt(workflow)

            outputs = await client.wait_for_completion(prompt_id)
            if not outputs:
                print(f"    Timeout waiting for {ethnicity}")
                continue

            # Find the saved image
            for node_id, output in outputs.items():
                images = output.get("images", [])
                if images:
                    img_info = images[0]
                    image_data = await client.download_image(
                        img_info["filename"],
                        img_info.get("subfolder", ""),
                        img_info.get("type", "output"),
                    )

                    # Save locally
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.write_bytes(image_data)

                    # Also upload to ComfyUI input folder for IP-Adapter use
                    await client.upload_image(image_data, f"anchor_{ethnicity}.png")

                    progress.mark_anchor_done(ethnicity, seed)
                    print(f"    Saved: {output_path}")
                    return True

        except Exception as e:
            print(f"    Error: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)  # Exponential backoff

    return False


async def generate_variation(
    client: ComfyUIClient,
    ethnicity: str,
    body_type: str,
    hair_color: str,
    progress: ProgressTracker,
    max_retries: int = 3,
) -> bool:
    """Generate a single variation image using IP-Adapter."""
    if progress.is_variation_done(ethnicity, body_type, hair_color):
        print(f"  [skip] {ethnicity}-{body_type}-{hair_color} already exists")
        return True

    filename = f"{ethnicity}-{body_type}-{hair_color}.png"
    output_path = OUTPUT_DIR / filename
    reference_image = f"anchor_{ethnicity}.png"

    for attempt in range(max_retries):
        try:
            positive, negative = build_variation_prompt(ethnicity, body_type, hair_color)
            seed = random.randint(0, 2**31 - 1)
            workflow = build_variation_workflow(positive, negative, reference_image, seed)

            print(f"  [{attempt+1}/{max_retries}] Generating {filename} (seed: {seed})...")
            prompt_id = await client.queue_prompt(workflow)

            outputs = await client.wait_for_completion(prompt_id)
            if not outputs:
                print(f"    Timeout waiting for {filename}")
                continue

            # Find the saved image
            for node_id, output in outputs.items():
                images = output.get("images", [])
                if images:
                    img_info = images[0]
                    image_data = await client.download_image(
                        img_info["filename"],
                        img_info.get("subfolder", ""),
                        img_info.get("type", "output"),
                    )

                    # Save locally
                    output_path.write_bytes(image_data)
                    progress.mark_variation_done(ethnicity, body_type, hair_color, seed)
                    print(f"    Saved: {output_path}")
                    return True

        except Exception as e:
            print(f"    Error: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)

    return False


async def generate_all_anchors(client: ComfyUIClient, progress: ProgressTracker) -> int:
    """Generate all anchor images. Returns count of successful generations."""
    print("\n=== Phase 1: Generating Anchor Images ===\n")
    ANCHORS_DIR.mkdir(parents=True, exist_ok=True)

    success = 0
    for ethnicity in ETHNICITIES:
        if await generate_anchor(client, ethnicity, progress):
            success += 1
        else:
            print(f"  [FAILED] {ethnicity} anchor")

    print(f"\nAnchors complete: {success}/{len(ETHNICITIES)}")
    return success


async def generate_all_variations(client: ComfyUIClient, progress: ProgressTracker) -> int:
    """Generate all variation images. Returns count of successful generations."""
    print("\n=== Phase 2: Generating Variations with IP-Adapter ===\n")

    # Verify all anchors exist
    missing_anchors = [e for e in ETHNICITIES if not progress.is_anchor_done(e)]
    if missing_anchors:
        print(f"ERROR: Missing anchors: {missing_anchors}")
        print("Run with --phase anchors first")
        return 0

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    success = 0
    total = TOTAL_PERMUTATIONS
    current = 0

    for ethnicity in ETHNICITIES:
        for body_type in BODY_TYPES:
            for hair_color in HAIR_COLORS:
                current += 1
                print(f"\n[{current}/{total}] {ethnicity}-{body_type}-{hair_color}")

                if await generate_variation(client, ethnicity, body_type, hair_color, progress):
                    success += 1
                else:
                    print(f"  [FAILED] {ethnicity}-{body_type}-{hair_color}")

    print(f"\nVariations complete: {success}/{total}")
    return success


async def main():
    parser = argparse.ArgumentParser(description="Generate companion portraits using ComfyUI")
    parser.add_argument("--phase", choices=["anchors", "variations"], help="Run specific phase only")
    parser.add_argument("--all", action="store_true", help="Run both phases")
    parser.add_argument("--resume", action="store_true", help="Resume from progress file")
    parser.add_argument("--url", default=COMFYUI_URL, help="ComfyUI URL")
    parser.add_argument("--stats", action="store_true", help="Show progress stats only")
    args = parser.parse_args()

    progress = ProgressTracker()

    if args.stats:
        stats = progress.get_stats()
        print(f"Anchors: {stats['anchors_done']}/{stats['anchors_total']}")
        print(f"Variations: {stats['variations_done']}/{stats['variations_total']}")
        return

    if not args.phase and not args.all and not args.resume:
        parser.print_help()
        return

    async with ComfyUIClient(base_url=args.url) as client:
        # Health check
        print(f"Connecting to ComfyUI at {args.url}...")
        if not await client.health_check():
            print("ERROR: Cannot connect to ComfyUI. Is the SSH tunnel running?")
            print("  ssh -L 8188:localhost:8188 -p 2222 jake@home")
            return

        print("Connected!\n")

        if args.phase == "anchors" or args.all or args.resume:
            await generate_all_anchors(client, progress)

        if args.phase == "variations" or args.all or args.resume:
            await generate_all_variations(client, progress)

    # Final stats
    stats = progress.get_stats()
    print("\n=== Final Stats ===")
    print(f"Anchors: {stats['anchors_done']}/{stats['anchors_total']}")
    print(f"Variations: {stats['variations_done']}/{stats['variations_total']}")


if __name__ == "__main__":
    asyncio.run(main())

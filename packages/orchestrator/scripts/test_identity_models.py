#!/usr/bin/env python3
"""
Test identity-preserving image generation models on FAL.

Compares face consistency across multiple FAL models by generating
variations of a reference face image with different emotions/scenes.

Usage:
    python test_identity_models.py \
        --reference-url "https://example.com/face.png" \
        --subject "East Asian woman, slim build, black hair"
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FAL_KEY: str = os.environ.get("FAL_KEY", "")
SYNC_BASE = "https://fal.run"
QUEUE_BASE = "https://queue.fal.run"

POLL_INTERVAL = 2.0  # seconds between queue status polls
POLL_TIMEOUT = 300.0  # max seconds to wait for a queued job
REQUEST_TIMEOUT = 180.0  # httpx timeout for sync requests

OUTPUT_DIR = Path(__file__).resolve().parent / "test_output"

EMOTIONS: dict[str, str] = {
    "neutral": (
        "Casual iPhone photo of SUBJECT at a restaurant table. "
        "Relaxed, natural expression. Natural lighting, taken by a friend."
    ),
    "happy": (
        "Candid iPhone photo of SUBJECT caught mid-laugh at an outdoor brunch. "
        "Genuine joy. Natural daylight, taken by a friend."
    ),
    "thoughtful": (
        "Candid phone photo of SUBJECT, lost in thought, sitting by a window "
        "at a coffee shop. Natural light, intimate moment."
    ),
    "confident": (
        "iPhone photo of SUBJECT standing tall on a city street. "
        "Direct eye contact, self-assured smirk. Golden hour side lighting."
    ),
}

# Cost estimates per image (USD) -- rough public pricing as of early 2026
COST_ESTIMATES: dict[str, float] = {
    "flux-pulid": 0.025,
    "kontext-pro": 0.05,
    "kontext-max": 0.10,
    "instant-character": 0.05,
    "minimax-subject-ref": 0.04,
    "ideogram-character": 0.08,
}


# ---------------------------------------------------------------------------
# Model definitions
# ---------------------------------------------------------------------------

@dataclass
class ModelConfig:
    name: str
    endpoint: str
    build_payload: Any  # callable(prompt, reference_url) -> dict
    # Some models nest image URL differently in the response
    extract_image_url: Any = None  # callable(response_json) -> str | None


def _default_extract(resp: dict) -> str | None:
    """Default: response["images"][0]["url"]."""
    try:
        return resp["images"][0]["url"]
    except (KeyError, IndexError, TypeError):
        return None


def _data_images_extract(resp: dict) -> str | None:
    """Fallback: response["data"]["images"][0]["url"] or response["image"]["url"]."""
    try:
        return resp["data"]["images"][0]["url"]
    except (KeyError, IndexError, TypeError):
        pass
    try:
        return resp["image"]["url"]
    except (KeyError, TypeError):
        pass
    try:
        return resp["output"]["images"][0]["url"]
    except (KeyError, IndexError, TypeError):
        pass
    return None


def _combined_extract(resp: dict) -> str | None:
    return _default_extract(resp) or _data_images_extract(resp)


def build_models() -> list[ModelConfig]:
    return [
        ModelConfig(
            name="flux-pulid",
            endpoint="fal-ai/flux-pulid",
            build_payload=lambda prompt, ref: {
                "prompt": prompt,
                "reference_image_url": ref,
                "id_weight": 0.95,
                "image_size": {"width": 832, "height": 1248},
                "num_inference_steps": 20,
                "guidance_scale": 4.0,
            },
            extract_image_url=_combined_extract,
        ),
        ModelConfig(
            name="kontext-pro",
            endpoint="fal-ai/flux-pro/kontext",
            build_payload=lambda prompt, ref: {
                "prompt": prompt,
                "image_url": ref,
                "guidance_scale": 3.5,
                "num_inference_steps": 28,
                "image_size": {"width": 832, "height": 1248},
            },
            extract_image_url=_combined_extract,
        ),
        ModelConfig(
            name="kontext-max",
            endpoint="fal-ai/flux-pro/kontext/max",
            build_payload=lambda prompt, ref: {
                "prompt": prompt,
                "image_url": ref,
                "guidance_scale": 3.5,
                "num_inference_steps": 28,
                "image_size": {"width": 832, "height": 1248},
            },
            extract_image_url=_combined_extract,
        ),
        ModelConfig(
            name="instant-character",
            endpoint="fal-ai/instant-character",
            build_payload=lambda prompt, ref: {
                "prompt": prompt,
                "image_url": ref,
                "image_size": {"width": 832, "height": 1248},
            },
            extract_image_url=_combined_extract,
        ),
        ModelConfig(
            name="minimax-subject-ref",
            endpoint="fal-ai/minimax/image-01/subject-reference",
            build_payload=lambda prompt, ref: {
                "prompt": prompt,
                "subject_image_url": ref,
                "aspect_ratio": "9:16",
            },
            extract_image_url=_combined_extract,
        ),
        ModelConfig(
            name="ideogram-character",
            endpoint="fal-ai/ideogram/character",
            build_payload=lambda prompt, ref: {
                "prompt": prompt,
                "image_url": ref,
                "image_size": {"width": 832, "height": 1248},
            },
            extract_image_url=_combined_extract,
        ),
    ]


# ---------------------------------------------------------------------------
# Result tracking
# ---------------------------------------------------------------------------

@dataclass
class GenerationResult:
    model: str
    emotion: str
    success: bool
    latency_s: float = 0.0
    error: str = ""
    output_path: str = ""


@dataclass
class ModelSummary:
    name: str
    successes: int = 0
    failures: int = 0
    total_latency: float = 0.0
    results: list[GenerationResult] = field(default_factory=list)

    @property
    def avg_latency(self) -> float:
        if self.successes == 0:
            return 0.0
        return self.total_latency / self.successes

    @property
    def est_cost(self) -> float:
        return self.successes * COST_ESTIMATES.get(self.name, 0.0)


# ---------------------------------------------------------------------------
# FAL API helpers
# ---------------------------------------------------------------------------

def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Key {FAL_KEY}",
        "Content-Type": "application/json",
    }


async def _try_sync(
    client: httpx.AsyncClient,
    endpoint: str,
    payload: dict,
) -> dict | None:
    """Attempt a synchronous FAL call. Returns response JSON or None on failure."""
    url = f"{SYNC_BASE}/{endpoint}"
    try:
        resp = await client.post(
            url,
            json=payload,
            headers=_auth_headers(),
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code == 200:
            return resp.json()
        # 422 / 400 usually means sync not supported or bad params -- fall through
        if resp.status_code >= 500:
            return None  # server error, try queue
        # For 4xx, still try queue as some models only support queue
        return None
    except (httpx.TimeoutException, httpx.ConnectError):
        return None


async def _queue_submit(
    client: httpx.AsyncClient,
    endpoint: str,
    payload: dict,
) -> str:
    """Submit a job to the FAL queue. Returns request_id."""
    url = f"{QUEUE_BASE}/{endpoint}"
    resp = await client.post(
        url,
        json=payload,
        headers=_auth_headers(),
        timeout=60.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["request_id"]


async def _queue_poll(
    client: httpx.AsyncClient,
    endpoint: str,
    request_id: str,
) -> dict:
    """Poll until the queued job completes. Returns the result JSON."""
    status_url = f"{QUEUE_BASE}/{endpoint}/requests/{request_id}/status"
    result_url = f"{QUEUE_BASE}/{endpoint}/requests/{request_id}"
    deadline = time.monotonic() + POLL_TIMEOUT

    while time.monotonic() < deadline:
        resp = await client.get(status_url, headers=_auth_headers(), timeout=30.0)
        resp.raise_for_status()
        status = resp.json()

        state = status.get("status", "").upper()
        if state == "COMPLETED":
            result_resp = await client.get(
                result_url, headers=_auth_headers(), timeout=60.0
            )
            result_resp.raise_for_status()
            return result_resp.json()
        if state in ("FAILED", "CANCELLED"):
            error_msg = status.get("error", "Unknown queue error")
            raise RuntimeError(f"Queue job {state}: {error_msg}")

        await asyncio.sleep(POLL_INTERVAL)

    raise TimeoutError(f"Queue job {request_id} did not complete within {POLL_TIMEOUT}s")


async def generate_image(
    client: httpx.AsyncClient,
    model: ModelConfig,
    prompt: str,
    reference_url: str,
) -> dict:
    """Generate an image via FAL, trying sync first then falling back to queue."""
    payload = model.build_payload(prompt, reference_url)

    # Try sync first
    result = await _try_sync(client, model.endpoint, payload)
    if result is not None:
        return result

    # Fall back to queue
    request_id = await _queue_submit(client, model.endpoint, payload)
    return await _queue_poll(client, model.endpoint, request_id)


async def download_image(
    client: httpx.AsyncClient,
    url: str,
    dest: Path,
) -> None:
    """Download an image from a URL and save to disk."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    resp = await client.get(url, timeout=60.0, follow_redirects=True)
    resp.raise_for_status()
    dest.write_bytes(resp.content)


# ---------------------------------------------------------------------------
# Per-model runner
# ---------------------------------------------------------------------------

async def run_model(
    model: ModelConfig,
    reference_url: str,
    subject: str,
    semaphore: asyncio.Semaphore,
) -> ModelSummary:
    """Run all emotion prompts for a single model."""
    summary = ModelSummary(name=model.name)
    extract = model.extract_image_url or _combined_extract

    async with httpx.AsyncClient() as client:
        for emotion, template in EMOTIONS.items():
            prompt = template.replace("SUBJECT", subject)
            result = GenerationResult(model=model.name, emotion=emotion, success=False)

            async with semaphore:
                print(f"  [{model.name}] Generating {emotion}...")
                t0 = time.monotonic()
                try:
                    resp_json = await generate_image(
                        client, model, prompt, reference_url
                    )
                    elapsed = time.monotonic() - t0
                    result.latency_s = elapsed

                    image_url = extract(resp_json)
                    if not image_url:
                        result.error = (
                            f"Could not extract image URL from response keys: "
                            f"{list(resp_json.keys())}"
                        )
                        print(f"  [{model.name}] {emotion} FAILED: {result.error}")
                        summary.failures += 1
                        summary.results.append(result)
                        continue

                    # Download the image
                    out_path = OUTPUT_DIR / model.name / f"{emotion}.png"
                    await download_image(client, image_url, out_path)

                    result.success = True
                    result.output_path = str(out_path)
                    summary.successes += 1
                    summary.total_latency += elapsed
                    print(
                        f"  [{model.name}] {emotion} OK "
                        f"({elapsed:.1f}s) -> {out_path}"
                    )

                except Exception as exc:
                    elapsed = time.monotonic() - t0
                    result.latency_s = elapsed
                    result.error = f"{type(exc).__name__}: {exc}"
                    summary.failures += 1
                    print(f"  [{model.name}] {emotion} FAILED ({elapsed:.1f}s): {exc}")

                summary.results.append(result)

    return summary


# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------

def print_summary(summaries: list[ModelSummary]) -> None:
    header = f"{'Model':<25} {'OK':>4} {'Fail':>4} {'Avg Latency':>12} {'Est. Cost':>10}"
    sep = "-" * len(header)
    print(f"\n{sep}")
    print(header)
    print(sep)

    for s in summaries:
        latency_str = f"{s.avg_latency:.1f}s" if s.successes > 0 else "n/a"
        cost_str = f"${s.est_cost:.3f}" if s.successes > 0 else "$0.000"
        print(f"{s.name:<25} {s.successes:>4} {s.failures:>4} {latency_str:>12} {cost_str:>10}")

    print(sep)

    total_ok = sum(s.successes for s in summaries)
    total_fail = sum(s.failures for s in summaries)
    total_cost = sum(s.est_cost for s in summaries)
    print(f"{'TOTAL':<25} {total_ok:>4} {total_fail:>4} {'':>12} ${total_cost:.3f}")
    print()

    # Per-model detail for failures
    failures = [r for s in summaries for r in s.results if not r.success]
    if failures:
        print("Failures:")
        for r in failures:
            print(f"  [{r.model}] {r.emotion}: {r.error}")
        print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare identity-preserving FAL models for face consistency."
    )
    parser.add_argument(
        "--reference-url",
        required=True,
        help="URL of the reference/anchor face image.",
    )
    parser.add_argument(
        "--subject",
        default="young woman, athletic build, brown hair",
        help="Text description of the subject (replaces SUBJECT in prompts).",
    )
    parser.add_argument(
        "--models",
        nargs="*",
        default=None,
        help="Subset of model names to test (default: all). "
        "Choices: flux-pulid, kontext-pro, kontext-max, instant-character, "
        "minimax-subject-ref, ideogram-character",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=3,
        help="Max concurrent FAL API calls (default: 3).",
    )
    args = parser.parse_args()

    if not FAL_KEY:
        print("ERROR: FAL_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    all_models = build_models()
    if args.models:
        selected = {m.strip() for m in args.models}
        models = [m for m in all_models if m.name in selected]
        unknown = selected - {m.name for m in models}
        if unknown:
            print(f"WARNING: Unknown model names ignored: {unknown}", file=sys.stderr)
    else:
        models = all_models

    if not models:
        print("ERROR: No models selected.", file=sys.stderr)
        sys.exit(1)

    print(f"Reference image: {args.reference_url}")
    print(f"Subject: {args.subject}")
    print(f"Models: {', '.join(m.name for m in models)}")
    print(f"Emotions: {', '.join(EMOTIONS.keys())}")
    print(f"Output dir: {OUTPUT_DIR}")
    print(f"Concurrency: {args.concurrency}")
    print()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    semaphore = asyncio.Semaphore(args.concurrency)

    t_start = time.monotonic()
    tasks = [
        run_model(model, args.reference_url, args.subject, semaphore)
        for model in models
    ]
    summaries = await asyncio.gather(*tasks)
    wall_time = time.monotonic() - t_start

    print_summary(list(summaries))
    print(f"Wall time: {wall_time:.1f}s")
    print(f"Images saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())

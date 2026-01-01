"""Prompt enhancement service for image generation.

Enhances raw image prompts from the companion LLM with additional visual details,
lighting, composition, and quality keywords for better image generation results.
Uses local Ollama with abliterated models for uncensored prompt enhancement.
"""

from __future__ import annotations

import time

import httpx
import structlog

from orchestrator.config import Settings

logger = structlog.get_logger()

PROMPT_ENHANCEMENT_SYSTEM = """You are an expert at writing prompts for AI image generation (Stable Diffusion, SDXL, Flux).
Your task is to transform scene descriptions into effective image generation prompts.

CRITICAL RULES:
1. Output ONLY the enhanced prompt - no explanations, no preamble, no quotes
2. Write as comma-separated descriptive tags/phrases (how image gen prompts work)
3. Always include: subject description, composition/framing, lighting, mood, style
4. Keep the same scene content and emotional tone
5. Add quality boosters appropriate for the style (photorealistic, 8k, detailed, etc.)
6. Keep prompts concise (under 100 words)

Transform action descriptions into visual descriptions:
- "tilting head with intense gaze" → "woman with tilted head, intense eye contact, close-up portrait"
- "stretching in sunlight" → "woman stretching, morning sunlight, warm golden tones, bedroom"

Focus on WHAT THE IMAGE SHOWS, not what the subject is doing."""


class PromptEnhancer:
    """Enhances image prompts using local Ollama with abliterated models."""

    def __init__(self, settings: Settings):
        """Initialize the prompt enhancer.

        Args:
            settings: Application settings containing Ollama config.
        """
        self.settings = settings
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.prompt_enhancement_model
        self.max_tokens = settings.prompt_enhancement_max_tokens
        self.temperature = settings.prompt_enhancement_temperature
        self.timeout = 30.0  # Short timeout for prompt enhancement

    async def enhance_prompt(
        self,
        original_prompt: str,
        emotional_state: str,
        style: str,
    ) -> str:
        """Enhance an image prompt for better generation results.

        Args:
            original_prompt: The raw prompt from the companion LLM.
            emotional_state: Current emotional state (happy, thoughtful, etc.).
            style: Art style (realistic, anime, stylized, etc.).

        Returns:
            Enhanced prompt string. Falls back to original on error.
        """
        if not original_prompt or not original_prompt.strip():
            return original_prompt

        start_time = time.time()

        # Build the user message
        user_message = f"""Transform this into an effective AI image generation prompt for {style} style.

Original: {original_prompt}
Emotional state: {emotional_state}
Style: {style}

Enhanced prompt:"""

        # Build Ollama request payload
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": PROMPT_ENHANCEMENT_SYSTEM},
                {"role": "user", "content": user_message},
            ],
            "stream": False,
            "options": {
                "num_predict": self.max_tokens,
                "temperature": self.temperature,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/chat",
                    json=payload,
                )
                response.raise_for_status()
                result = response.json()

            # Extract the response content
            enhanced = result.get("message", {}).get("content", "").strip()

            # Clean up common issues - remove quotes, explanatory text
            if enhanced.startswith('"') and enhanced.endswith('"'):
                enhanced = enhanced[1:-1]
            if enhanced.startswith("'") and enhanced.endswith("'"):
                enhanced = enhanced[1:-1]

            # Remove any "Enhanced prompt:" prefix if the model added it
            if enhanced.lower().startswith("enhanced prompt:"):
                enhanced = enhanced[16:].strip()

            latency_ms = int((time.time() - start_time) * 1000)

            if enhanced and len(enhanced) > 10:
                logger.info(
                    "prompt_enhanced",
                    original_length=len(original_prompt),
                    enhanced_length=len(enhanced),
                    emotional_state=emotional_state,
                    style=style,
                    latency_ms=latency_ms,
                    model=self.model,
                )
                return enhanced

            # If response is too short or empty, fall back to original
            logger.warning(
                "prompt_enhancement_empty_response",
                original_prompt=original_prompt[:100],
                response=enhanced[:100] if enhanced else None,
            )
            return original_prompt

        except httpx.TimeoutException:
            logger.warning(
                "prompt_enhancement_timeout",
                original_prompt=original_prompt[:100],
            )
            return original_prompt

        except httpx.HTTPStatusError as e:
            logger.warning(
                "prompt_enhancement_http_error",
                status_code=e.response.status_code,
                original_prompt=original_prompt[:100],
            )
            return original_prompt

        except Exception as e:
            logger.warning(
                "prompt_enhancement_failed",
                error=str(e),
                error_type=type(e).__name__,
                original_prompt=original_prompt[:100],
            )
            return original_prompt

"""Prompt enhancement service for image generation.

Enhances raw image prompts from the companion LLM with additional visual details,
lighting, composition, and quality keywords for better image generation results.
Uses local Ollama with abliterated models for uncensored prompt enhancement.
"""

from __future__ import annotations

import re
import time

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.prompts.manager import PromptManager

logger = structlog.get_logger()


class PromptEnhancer:
    """Enhances image prompts using local Ollama with abliterated models."""

    def __init__(self, settings: Settings, prompt_manager: PromptManager):
        """Initialize the prompt enhancer.

        Args:
            settings: Application settings containing Ollama config.
        """
        self.settings = settings
        self.prompt_manager = prompt_manager
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

        system_message = self.prompt_manager.get_prompt("orchestrator.image_prompt_enhancement_system")
        user_message = self.prompt_manager.get_prompt(
            "orchestrator.image_prompt_enhancement_user",
            style=style,
            original_prompt=original_prompt,
            emotional_state=emotional_state,
        )

        # Build Ollama request payload
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_message},
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

            # Strip thinking/reasoning tags from models that output chain-of-thought
            # (e.g., Qwen, DeepSeek with reasoning enabled)
            # Common patterns: <think>, <thinking>, <reasoning>, <thought>
            thinking_patterns = [
                r'<think>.*?</think>',
                r'<thinking>.*?</thinking>',
                r'<reasoning>.*?</reasoning>',
                r'<thought>.*?</thought>',
            ]
            for pattern in thinking_patterns:
                enhanced = re.sub(pattern, '', enhanced, flags=re.DOTALL).strip()

            # Handle unclosed thinking tags - strip from tag to end
            unclosed_tags = ['<think>', '<thinking>', '<reasoning>', '<thought>']
            for tag in unclosed_tags:
                if tag in enhanced:
                    # Remove everything from the unclosed tag onwards
                    enhanced = enhanced[:enhanced.index(tag)].strip()

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

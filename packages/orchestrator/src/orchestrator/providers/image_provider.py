"""Image provider protocol for model routing.

This module defines the Protocol class for image providers, enabling
type-safe model selection and routing across different backends.
"""

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class ImageProviderProtocol(Protocol):
    """Protocol defining the interface for image generation providers.

    This protocol enables the image model router to work with any provider
    implementation that supports the required methods. Providers can support
    different capabilities (IP-Adapter, NSFW, etc.) as indicated by their
    model configurations.
    """

    @property
    def name(self) -> str:
        """Return the provider name (e.g., 'comfyui', 'fal')."""
        ...

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
        """Generate an image from a text prompt.

        Args:
            prompt: The text prompt describing the desired image.
            size: Image dimensions as "WIDTHxHEIGHT" (e.g., "768x1024").
            style: Optional style modifier (deprecated, may be ignored).
            negative_prompt: Things to avoid in the generated image.
            model_id: The model ID to use for generation (e.g., "comfyui/epicrealism").
                     If None, uses the provider's default model.
            reference_image_url: URL of reference image for IP-Adapter consistency.
            reference_strength: How strongly to follow reference (0.0-1.0).
            is_anchor: If True, use high-quality anchor workflow.

        Returns:
            Dictionary containing:
                - image_data (bytes) or image_url (str): The generated image
                - format: Image format (e.g., "png")
                - width: Image width
                - height: Image height
                - latency_ms: Generation time in milliseconds
                - Additional provider-specific fields
        """
        ...

    async def health_check(self) -> bool:
        """Check if the provider is reachable and operational.

        Returns:
            True if the provider is healthy, False otherwise.
        """
        ...

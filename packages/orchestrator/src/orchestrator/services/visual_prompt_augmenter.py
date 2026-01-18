"""Visual Prompt Augmentation Service.

This service auto-augments image generation prompts with character visual
details from the companion spec and context from recent conversation.
Implements the "Visual Prompt Augmentation from KG" pattern.
"""

from typing import Any
import structlog

logger = structlog.get_logger()


class VisualPromptAugmenter:
    """Augments image prompts with character visual details for consistency.

    This ensures that generated images maintain visual consistency with the
    companion's defined appearance, including:
    - Physical attributes (ethnicity, body type, hair color)
    - Style preferences (artistic style, palette)
    - Scene context from recent conversation
    """

    # Mapping of appearance attributes to natural language descriptions
    ETHNICITY_DESCRIPTIONS = {
        "east-asian": "East Asian",
        "south-asian": "South Asian",
        "black": "Black/African",
        "caucasian": "Caucasian/European",
        "latina": "Latina/Hispanic",
        "middle-eastern": "Middle Eastern",
        "mixed": "mixed ethnicity",
    }

    HAIR_COLOR_DESCRIPTIONS = {
        "black": "black hair",
        "brown": "brown hair",
        "blonde": "blonde hair",
        "red": "red hair",
        "fantasy": "fantasy-colored hair",
    }

    BODY_TYPE_DESCRIPTIONS = {
        # Female body types
        "slim": "slim figure",
        "athletic": "athletic build",
        "curvy": "curvy figure",
        "plus-size": "plus-size figure",
        # Male body types
        "muscular": "muscular build",
        "dad-bod": "dad-bod physique",
    }

    STYLE_TYPE_DESCRIPTIONS = {
        "photorealistic": "photorealistic, high quality photography style",
        "anime": "anime art style",
        "illustration": "digital illustration style",
        "fantasy": "fantasy art style",
        "portrait": "professional portrait photography",
    }

    def __init__(self):
        """Initialize the augmenter."""
        pass

    def build_character_description(
        self,
        appearance: dict[str, Any] | None,
        visual_style: dict[str, Any] | None = None,
    ) -> str:
        """Build a natural language description of the character's appearance.

        Args:
            appearance: The CompanionAppearance object (ethnicity, hairColor, bodyType, etc.)
            visual_style: Optional visual_style object with style_type, palette, constraints

        Returns:
            A text description suitable for including in image prompts
        """
        if not appearance:
            return ""

        parts = []

        # Gender
        gender = appearance.get("gender")
        if gender:
            parts.append(f"{gender}")

        # Ethnicity
        ethnicity = appearance.get("ethnicity")
        if ethnicity:
            desc = self.ETHNICITY_DESCRIPTIONS.get(ethnicity, ethnicity)
            parts.append(desc)

        # Body type
        body_type = appearance.get("bodyType")
        if body_type:
            desc = self.BODY_TYPE_DESCRIPTIONS.get(body_type, body_type)
            parts.append(f"with {desc}")

        # Hair color
        hair_color = appearance.get("hairColor")
        if hair_color:
            desc = self.HAIR_COLOR_DESCRIPTIONS.get(hair_color, hair_color)
            parts.append(f"with {desc}")

        # Additional style info
        if visual_style:
            style_type = visual_style.get("style_type")
            if style_type:
                style_desc = self.STYLE_TYPE_DESCRIPTIONS.get(style_type, style_type)
                parts.append(f"rendered in {style_desc}")

        description = " ".join(parts)

        logger.debug(
            "character_description_built",
            appearance=appearance,
            description=description,
        )

        return description

    def extract_scene_context(
        self,
        recent_turns: list[dict[str, Any]] | None,
        max_turns: int = 3,
    ) -> str:
        """Extract relevant scene context from recent conversation turns.

        Args:
            recent_turns: List of recent conversation turns
            max_turns: Maximum number of turns to consider

        Returns:
            Scene context text for prompt augmentation
        """
        if not recent_turns:
            return ""

        # Look for scene-related keywords in recent messages
        scene_keywords = [
            "wearing", "dressed", "outfit", "clothes",
            "sitting", "standing", "lying", "walking",
            "beach", "room", "outside", "inside", "park", "cafe",
            "morning", "evening", "night", "sunset",
            "smiling", "laughing", "looking", "expression",
        ]

        context_hints = []
        turns_to_check = recent_turns[:max_turns]

        for turn in turns_to_check:
            content = turn.get("content", "")
            if not content:
                continue

            content_lower = content.lower()
            for keyword in scene_keywords:
                if keyword in content_lower:
                    # Extract a short phrase around the keyword
                    # This is simplified - a more sophisticated approach
                    # would use NLP to extract meaningful phrases
                    context_hints.append(keyword)

        if context_hints:
            unique_hints = list(set(context_hints))[:5]  # Limit to 5 hints
            return ", ".join(unique_hints)

        return ""

    def augment_prompt(
        self,
        base_prompt: str,
        companion_spec: dict[str, Any] | None = None,
        recent_turns: list[dict[str, Any]] | None = None,
        include_style: bool = True,
        include_scene_context: bool = True,
    ) -> str:
        """Augment an image generation prompt with character visual details.

        Args:
            base_prompt: The original user/AI prompt
            companion_spec: The full companion spec including visual_style.appearance
            recent_turns: Recent conversation turns for scene context
            include_style: Whether to include style instructions
            include_scene_context: Whether to include scene context from conversation

        Returns:
            Augmented prompt with character visual details
        """
        parts = []

        # Add character description from companion spec
        if companion_spec:
            visual_style = companion_spec.get("visual_style", {})
            appearance = visual_style.get("appearance")

            if appearance:
                char_desc = self.build_character_description(
                    appearance,
                    visual_style if include_style else None,
                )
                if char_desc:
                    parts.append(f"Character: {char_desc}.")

            # Add any style constraints
            constraints = visual_style.get("constraints", [])
            if constraints:
                parts.append(f"Style constraints: {', '.join(constraints)}.")

        # Add scene context from recent conversation
        if include_scene_context and recent_turns:
            scene_context = self.extract_scene_context(recent_turns)
            if scene_context:
                parts.append(f"Context: {scene_context}.")

        # Add the base prompt
        parts.append(base_prompt)

        # Consistency keywords
        parts.append("Maintain character consistency.")

        augmented = " ".join(parts)

        logger.info(
            "prompt_augmented",
            base_prompt_length=len(base_prompt),
            augmented_prompt_length=len(augmented),
            has_appearance=companion_spec is not None,
            has_scene_context=bool(recent_turns),
        )

        return augmented

    def build_negative_prompt(
        self,
        companion_spec: dict[str, Any] | None = None,
        base_negative: str | None = None,
    ) -> str:
        """Build a negative prompt with character-specific exclusions.

        Args:
            companion_spec: The full companion spec
            base_negative: Base negative prompt to extend

        Returns:
            Negative prompt for image generation
        """
        negatives = []

        # Base quality negatives
        quality_negatives = [
            "low quality",
            "blurry",
            "distorted",
            "disfigured",
            "bad anatomy",
            "wrong proportions",
        ]
        negatives.extend(quality_negatives)

        # Add spec-specific negatives (things that contradict the character)
        if companion_spec:
            visual_style = companion_spec.get("visual_style", {})
            appearance = visual_style.get("appearance")

            if appearance:
                # If character is female, avoid male features and vice versa
                gender = appearance.get("gender")
                if gender == "female":
                    negatives.append("masculine features")
                elif gender == "male":
                    negatives.append("feminine features")

                # Avoid wrong hair colors
                hair_color = appearance.get("hairColor")
                wrong_colors = [c for c in self.HAIR_COLOR_DESCRIPTIONS.keys() if c != hair_color]
                if hair_color and hair_color != "fantasy":
                    negatives.append(f"wrong hair color")

        # Add base negative prompt if provided
        if base_negative:
            negatives.append(base_negative)

        return ", ".join(negatives)


# Singleton instance
_augmenter_instance: VisualPromptAugmenter | None = None


def get_visual_prompt_augmenter() -> VisualPromptAugmenter:
    """Get the singleton augmenter instance."""
    global _augmenter_instance
    if _augmenter_instance is None:
        _augmenter_instance = VisualPromptAugmenter()
    return _augmenter_instance

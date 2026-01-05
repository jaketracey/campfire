"""Anchor generation service for creating consistent companion identity images.

Uses a two-phase approach:
1. SEED: Generate base identity with Dreamina v3.1 + randomness
2. VARIATIONS: Generate scene anchors with PuLID Flux (88-93% face similarity)
"""

import random
from dataclasses import dataclass, field
from typing import Any

import structlog

from orchestrator.providers.fal import FalProvider

logger = structlog.get_logger()


@dataclass
class SceneConfig:
    """Configuration for a scene variation."""

    scene: str
    emotion: str
    setting: str
    female_outfit: str
    male_outfit: str


@dataclass
class AnchorResult:
    """Result of anchor image generation."""

    image_url: str
    emotional_state: str
    scene: str | None = None
    is_identity_seed: bool = False
    seed: int | None = None
    width: int = 768
    height: int = 1024
    latency_ms: float = 0.0


@dataclass
class AnchorGenerationResult:
    """Complete result of anchor generation for a companion."""

    seed_anchor: AnchorResult
    variation_anchors: list[AnchorResult]
    random_seed: int
    total_latency_ms: float


# Scene pool for random selection
SCENE_POOL: list[SceneConfig] = [
    SceneConfig(
        scene="resort",
        emotion="happy",
        setting="Beautiful beach resort setting, golden hour sunlight, vacation vibes",
        female_outfit="stylish summer dress",
        male_outfit="open linen shirt showing chest",
    ),
    SceneConfig(
        scene="dinner",
        emotion="flirty",
        setting="Upscale restaurant, warm candlelit ambiance, sophisticated atmosphere",
        female_outfit="elegant cocktail dress",
        male_outfit="tailored blazer with open collar",
    ),
    SceneConfig(
        scene="urban",
        emotion="confident",
        setting="Trendy rooftop bar with city skyline at dusk, modern atmosphere",
        female_outfit="chic trendy outfit",
        male_outfit="fitted henley shirt",
    ),
    SceneConfig(
        scene="cafe",
        emotion="relaxed",
        setting="Cozy coffee shop, soft natural light, comfortable atmosphere",
        female_outfit="casual sweater and jeans",
        male_outfit="soft casual sweater",
    ),
    SceneConfig(
        scene="park",
        emotion="playful",
        setting="Sunny park with natural greenery, bright daylight, outdoors",
        female_outfit="casual sundress",
        male_outfit="fitted polo shirt",
    ),
    SceneConfig(
        scene="studio",
        emotion="neutral",
        setting="Clean studio background with soft professional lighting, portrait photography",
        female_outfit="elegant casual top",
        male_outfit="fitted casual shirt",
    ),
]

# Visual randomization options
LIGHTING_OPTIONS = [
    "golden hour sunlight",
    "soft natural lighting",
    "dramatic side lighting",
    "warm ambient glow",
    "cool blue tones",
]

OUTFIT_COLORS = [
    "black",
    "navy blue",
    "deep burgundy",
    "emerald green",
    "white",
    "dusty rose",
    "champagne",
    "slate gray",
]

# Ethnicity descriptions for prompt building
ETHNICITY_DESCRIPTIONS: dict[str, dict[str, str]] = {
    "east-asian": {
        "female": "East Asian woman with delicate features, almond-shaped eyes, smooth porcelain skin",
        "male": "East Asian man with refined features, dark eyes, clean-shaven face",
    },
    "south-asian": {
        "female": "South Asian woman with rich brown skin, expressive dark eyes, elegant features",
        "male": "South Asian man with warm brown skin, strong features, well-groomed",
    },
    "black": {
        "female": "Black woman with beautiful dark skin, radiant complexion, striking features",
        "male": "Black man with rich dark skin, strong jawline, confident presence",
    },
    "caucasian": {
        "female": "Caucasian woman with fair skin, natural beauty, refined features",
        "male": "Caucasian man with light skin, defined features, masculine presence",
    },
    "latina": {
        "female": "Latina woman with warm olive skin, captivating features, vibrant beauty",
        "male": "Latino man with golden-tan skin, charismatic features, warm smile",
    },
    "middle-eastern": {
        "female": "Middle Eastern woman with olive skin, striking dark eyes, exotic beauty",
        "male": "Middle Eastern man with olive complexion, intense gaze, strong features",
    },
    "mixed": {
        "female": "Mixed-race woman with unique exotic features, warm skin tone, striking beauty",
        "male": "Mixed-race man with distinctive features, warm complexion, unique look",
    },
}

# Body type descriptions
FEMALE_BODY_DESCRIPTIONS: dict[str, str] = {
    "slim": "slim and toned figure with graceful proportions",
    "athletic": "athletic and fit physique with visible muscle definition",
    "curvy": "curvy figure with feminine curves and full hips",
    "plus-size": "plus-size body type with generous curves and confident presence",
}

MALE_BODY_DESCRIPTIONS: dict[str, str] = {
    "slim": "slim and lean build with toned muscles",
    "athletic": "athletic and fit physique with defined muscles",
    "muscular": "muscular and well-built frame with developed physique",
    "dad-bod": "relaxed dad-bod with approachable build",
}

# Hair color descriptions
HAIR_DESCRIPTIONS: dict[str, str] = {
    "black": "lustrous black hair",
    "brown": "rich brown hair",
    "blonde": "golden blonde hair",
    "red": "vibrant red hair",
    "fantasy": "pastel-colored fantasy hair with purple and pink tones",
}

# Size descriptions
FEMALE_SIZE_DESCRIPTIONS: dict[str, str] = {
    "S": "modest bust",
    "M": "medium bust",
    "L": "full bust",
}

MALE_SIZE_DESCRIPTIONS: dict[str, str] = {
    "S": "lean frame with narrow shoulders",
    "M": "balanced build with average shoulders",
    "L": "broad frame with wide shoulders",
}


class AnchorGenerationService:
    """Service for generating consistent companion anchor images.

    Uses a two-phase approach:
    1. SEED: Generate base identity with Dreamina v3.1 + visual randomness
    2. VARIATIONS: Generate scene anchors with PuLID Flux for 88-93% face similarity
    """

    def __init__(self, fal_provider: FalProvider):
        """Initialize the anchor generation service.

        Args:
            fal_provider: FAL provider for image generation
        """
        self.fal_provider = fal_provider

    async def generate_companion_anchors(
        self,
        companion_id: str,
        appearance: dict[str, Any],
        personality: dict[str, Any] | None = None,
        variation_count: int = 3,
        width: int = 768,
        height: int = 1024,
    ) -> AnchorGenerationResult:
        """Generate a complete set of anchor images for a companion.

        Args:
            companion_id: The companion's unique identifier
            appearance: Appearance data from onboarding (gender, ethnicity, bodyType, hairColor, size)
            personality: Optional personality traits for prompt influence
            variation_count: Number of scene variations to generate (default 3, max 5)
            width: Image width (default 768)
            height: Image height (default 1024)

        Returns:
            AnchorGenerationResult with seed and variation anchors
        """
        # Generate random seed for reproducibility
        random_seed = random.randint(0, 2**32 - 1)

        logger.info(
            "anchor_generation_starting",
            companion_id=companion_id,
            random_seed=random_seed,
            variation_count=variation_count,
        )

        total_start_time = 0.0

        # Phase 1: Generate SEED image with Dreamina v3.1
        seed_prompt = self._build_seed_prompt(appearance, random_seed)
        seed_result = await self.fal_provider.generate_dreamina_seed(
            prompt=seed_prompt,
            width=width,
            height=height,
            seed=random_seed,
        )

        seed_anchor = AnchorResult(
            image_url=seed_result["image_url"],
            emotional_state="neutral",
            scene="studio",
            is_identity_seed=True,
            seed=seed_result.get("seed", random_seed),
            width=width,
            height=height,
            latency_ms=seed_result["latency_ms"],
        )

        total_start_time += seed_result["latency_ms"]

        logger.info(
            "anchor_seed_generated",
            companion_id=companion_id,
            seed=seed_anchor.seed,
            latency_ms=seed_anchor.latency_ms,
        )

        # Phase 2: Generate VARIATIONS with PuLID Flux
        # Select random scenes (excluding studio which is used for seed)
        available_scenes = [s for s in SCENE_POOL if s.scene != "studio"]
        selected_scenes = random.sample(
            available_scenes, min(variation_count, len(available_scenes))
        )

        variation_anchors: list[AnchorResult] = []

        for scene_config in selected_scenes:
            variation_prompt = self._build_variation_prompt(appearance, scene_config)

            variation_result = await self.fal_provider.generate_pulid_variation(
                prompt=variation_prompt,
                reference_image_url=seed_result["image_url"],
                width=width,
                height=height,
                id_weight=1.0,  # Maximum identity preservation
            )

            variation_anchor = AnchorResult(
                image_url=variation_result["image_url"],
                emotional_state=scene_config.emotion,
                scene=scene_config.scene,
                is_identity_seed=False,
                width=width,
                height=height,
                latency_ms=variation_result["latency_ms"],
            )

            variation_anchors.append(variation_anchor)
            total_start_time += variation_result["latency_ms"]

            logger.info(
                "anchor_variation_generated",
                companion_id=companion_id,
                scene=scene_config.scene,
                emotion=scene_config.emotion,
                latency_ms=variation_result["latency_ms"],
            )

        logger.info(
            "anchor_generation_complete",
            companion_id=companion_id,
            seed_count=1,
            variation_count=len(variation_anchors),
            total_latency_ms=total_start_time,
        )

        return AnchorGenerationResult(
            seed_anchor=seed_anchor,
            variation_anchors=variation_anchors,
            random_seed=random_seed,
            total_latency_ms=total_start_time,
        )

    def _build_seed_prompt(
        self,
        appearance: dict[str, Any],
        random_seed: int,
    ) -> str:
        """Build the prompt for seed image generation.

        Includes user's appearance selections plus visual randomness.
        """
        gender = appearance.get("gender", "female")
        ethnicity = appearance.get("ethnicity", "caucasian")
        body_type = appearance.get("bodyType", "athletic")
        hair_color = appearance.get("hairColor", "brown")
        size = appearance.get("breastSize") or appearance.get("build") or "M"

        # Get descriptions
        ethnicity_desc = ETHNICITY_DESCRIPTIONS.get(ethnicity, ETHNICITY_DESCRIPTIONS["caucasian"])
        ethnicity_text = ethnicity_desc.get(gender, ethnicity_desc["female"])

        body_desc = (
            FEMALE_BODY_DESCRIPTIONS.get(body_type, FEMALE_BODY_DESCRIPTIONS["athletic"])
            if gender == "female"
            else MALE_BODY_DESCRIPTIONS.get(body_type, MALE_BODY_DESCRIPTIONS["athletic"])
        )

        hair_desc = HAIR_DESCRIPTIONS.get(hair_color, HAIR_DESCRIPTIONS["brown"])

        size_desc = (
            FEMALE_SIZE_DESCRIPTIONS.get(size, FEMALE_SIZE_DESCRIPTIONS["M"])
            if gender == "female"
            else MALE_SIZE_DESCRIPTIONS.get(size, MALE_SIZE_DESCRIPTIONS["M"])
        )

        # Random visual elements based on seed
        rng = random.Random(random_seed)
        lighting = rng.choice(LIGHTING_OPTIONS)
        outfit_color = rng.choice(OUTFIT_COLORS)

        # Get studio scene config
        studio_scene = next(s for s in SCENE_POOL if s.scene == "studio")
        outfit = studio_scene.female_outfit if gender == "female" else studio_scene.male_outfit

        age_range = "25-35" if gender == "female" else "28-40"
        pronoun = "She" if gender == "female" else "He"

        prompt_parts = [
            f"Portrait of an attractive {age_range} year old {ethnicity_text}",
            f"with {hair_desc}, styled beautifully.",
            f"{pronoun} has a {body_desc}.",
            f"{pronoun} has a {size_desc}.",
            studio_scene.setting,
            f"Wearing a {outfit_color} {outfit}.",
            f"{lighting}.",
            "Warm genuine smile, confident and approachable.",
            "Looking directly at camera with friendly expressive eyes.",
            "Waist-up framing, shallow depth of field, shot on 85mm lens.",
            "Photorealistic, natural skin texture, high resolution.",
            "Professional portrait photography, soft bokeh background.",
        ]

        return " ".join(prompt_parts)

    def _build_variation_prompt(
        self,
        appearance: dict[str, Any],
        scene_config: SceneConfig,
    ) -> str:
        """Build the prompt for a scene variation.

        PuLID preserves the face from reference, so we focus on scene/outfit.
        """
        gender = appearance.get("gender", "female")
        ethnicity = appearance.get("ethnicity", "caucasian")
        body_type = appearance.get("bodyType", "athletic")
        hair_color = appearance.get("hairColor", "brown")

        # Get descriptions
        ethnicity_desc = ETHNICITY_DESCRIPTIONS.get(ethnicity, ETHNICITY_DESCRIPTIONS["caucasian"])
        ethnicity_text = ethnicity_desc.get(gender, ethnicity_desc["female"])

        body_desc = (
            FEMALE_BODY_DESCRIPTIONS.get(body_type, FEMALE_BODY_DESCRIPTIONS["athletic"])
            if gender == "female"
            else MALE_BODY_DESCRIPTIONS.get(body_type, MALE_BODY_DESCRIPTIONS["athletic"])
        )

        hair_desc = HAIR_DESCRIPTIONS.get(hair_color, HAIR_DESCRIPTIONS["brown"])
        outfit = scene_config.female_outfit if gender == "female" else scene_config.male_outfit

        age_range = "25-35" if gender == "female" else "28-40"

        prompt_parts = [
            f"{age_range} year old {ethnicity_text}",
            f"with {hair_desc}, {body_desc}.",
            scene_config.setting + ".",
            f"Wearing a {outfit}.",
            "Warm genuine smile, confident and approachable.",
            "Looking at camera with friendly eyes.",
            "Waist-up framing, shallow depth of field, shot on 85mm lens.",
            "Photorealistic, natural skin texture, high resolution.",
        ]

        return " ".join(prompt_parts)

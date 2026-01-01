"""Prompt definitions for companion portrait generation.

Uses SDXL-style weighted prompts for better differentiation between
ethnicities, body types, and hair colors.
"""

# Base quality prompts
BASE_POSITIVE = (
    "masterpiece, best quality, professional photography, portrait, "
    "beautiful woman, looking at viewer, soft smile, confident expression, "
    "studio lighting, sharp focus, 8k uhd, detailed skin texture"
)

BASE_NEGATIVE = (
    "ugly, deformed, blurry, low quality, bad anatomy, bad hands, "
    "missing fingers, extra limbs, disfigured, watermark, text, signature, "
    "amateur, oversaturated, undersaturated, overexposed, underexposed, "
    "grainy, noisy, jpeg artifacts, cropped, out of frame, "
    "duplicate, clone, twin, multiple people"
)

# Ethnicity descriptors with weights for SDXL
ETHNICITY_PROMPTS = {
    "east-asian": {
        "positive": (
            "(korean woman:1.3), (east asian:1.2), "
            "fair porcelain skin, almond-shaped eyes, delicate features, "
            "high cheekbones, small nose, natural beauty"
        ),
        "negative_add": "western features, european features, round eyes",
    },
    "south-asian": {
        "positive": (
            "(indian woman:1.3), (south asian:1.2), "
            "golden brown skin, dark expressive eyes, elegant features, "
            "rich complexion, defined eyebrows, beautiful bone structure"
        ),
        "negative_add": "pale skin, light skin, european features",
    },
    "black": {
        "positive": (
            "(african american woman:1.3), (black woman:1.2), "
            "dark glowing skin, full lips, beautiful dark complexion, "
            "high cheekbones, radiant skin, natural beauty"
        ),
        "negative_add": "pale skin, light skin, asian features",
    },
    "caucasian": {
        "positive": (
            "(european woman:1.3), (caucasian:1.2), "
            "fair skin, refined features, natural complexion, "
            "defined bone structure, clear skin"
        ),
        "negative_add": "",
    },
    "latina": {
        "positive": (
            "(latina woman:1.3), (hispanic:1.2), "
            "olive tan skin, warm complexion, passionate features, "
            "full lips, expressive eyes, sun-kissed glow"
        ),
        "negative_add": "",
    },
    "middle-eastern": {
        "positive": (
            "(persian woman:1.3), (middle eastern:1.2), "
            "olive skin, dark eyes, exotic elegant features, "
            "strong eyebrows, defined features, striking beauty"
        ),
        "negative_add": "",
    },
    "mixed": {
        "positive": (
            "(mixed race woman:1.3), (ambiguous ethnicity:1.1), "
            "unique stunning features, diverse heritage, "
            "striking combination, exotic beauty, harmonious features"
        ),
        "negative_add": "",
    },
}

# Body type descriptors with weights
BODY_TYPE_PROMPTS = {
    "slim": {
        "positive": (
            "(slim petite body:1.3), (slender figure:1.2), "
            "delicate frame, elegant proportions, thin waist, lithe build"
        ),
        "clothing": "fitted elegant top, flattering neckline",
    },
    "athletic": {
        "positive": (
            "(athletic toned body:1.3), (fit physique:1.2), "
            "toned muscles, strong yet feminine, defined arms, flat stomach"
        ),
        "clothing": "sporty fitted top, showing toned shoulders",
    },
    "curvy": {
        "positive": (
            "(curvy voluptuous body:1.3), (hourglass figure:1.2), "
            "wide hips, full bust, pronounced curves, shapely figure"
        ),
        "clothing": "form-fitting top, accentuating curves, tasteful cleavage",
    },
    "plus-size": {
        "positive": (
            "(plus size body:1.3), (full figured:1.2), "
            "thick curvy figure, soft curves, confident beauty, beautiful at any size"
        ),
        "clothing": "flattering wrap top, confident style",
    },
}

# Hair color descriptors with weights
HAIR_COLOR_PROMPTS = {
    "black": {
        "positive": (
            "(black hair:1.3), (dark silky hair:1.2), "
            "raven hair, lustrous shine, long flowing black hair"
        ),
        "style": "long flowing waves",
    },
    "brown": {
        "positive": (
            "(brown hair:1.3), (brunette:1.2), "
            "chestnut waves, warm brown tones, rich color, wavy brunette hair"
        ),
        "style": "soft wavy layers",
    },
    "blonde": {
        "positive": (
            "(blonde hair:1.3), (golden blonde:1.2), "
            "sunny blonde, honey highlights, golden locks, flowing blonde hair"
        ),
        "style": "flowing silky waves",
    },
    "red": {
        "positive": (
            "(red hair:1.3), (fiery auburn:1.2), "
            "ginger hair, copper tones, vibrant red, wavy auburn hair"
        ),
        "style": "wavy flowing",
    },
    "fantasy": {
        "positive": (
            "(fantasy colored hair:1.3), (pastel pink and purple:1.2), "
            "colorful vibrant hair, gradient colors, cotton candy colors, "
            "magical hair, ombre pastel"
        ),
        "style": "styled creative waves",
    },
}


def build_anchor_prompt(ethnicity: str) -> tuple[str, str]:
    """Build positive and negative prompts for anchor generation.

    Anchor images focus on facial features with neutral body/hair.

    Returns:
        Tuple of (positive_prompt, negative_prompt)
    """
    eth = ETHNICITY_PROMPTS.get(ethnicity, ETHNICITY_PROMPTS["mixed"])

    positive = f"{eth['positive']}, {BASE_POSITIVE}, neutral hairstyle, natural hair color"
    negative = BASE_NEGATIVE
    if eth["negative_add"]:
        negative = f"{negative}, {eth['negative_add']}"

    return positive, negative


def build_variation_prompt(
    ethnicity: str,
    body_type: str,
    hair_color: str,
) -> tuple[str, str]:
    """Build positive and negative prompts for variation generation.

    Variation images emphasize body type and hair color while
    IP-Adapter maintains facial identity from anchor.

    Returns:
        Tuple of (positive_prompt, negative_prompt)
    """
    eth = ETHNICITY_PROMPTS.get(ethnicity, ETHNICITY_PROMPTS["mixed"])
    body = BODY_TYPE_PROMPTS.get(body_type, BODY_TYPE_PROMPTS["athletic"])
    hair = HAIR_COLOR_PROMPTS.get(hair_color, HAIR_COLOR_PROMPTS["brown"])

    # Build positive prompt with body and hair first (most important for variation)
    positive_parts = [
        body["positive"],
        hair["positive"],
        body.get("clothing", "elegant fitted top"),
        eth["positive"],
        BASE_POSITIVE,
    ]
    positive = ", ".join(positive_parts)

    # Build negative prompt
    negative = BASE_NEGATIVE
    if eth["negative_add"]:
        negative = f"{negative}, {eth['negative_add']}"

    # Add hair color negatives to prevent wrong colors
    other_hair_colors = {
        "black": "blonde hair, red hair, light hair",
        "brown": "blonde hair, black hair, red hair",
        "blonde": "dark hair, black hair, brown hair",
        "red": "blonde hair, black hair, brown hair",
        "fantasy": "natural hair color, black hair, brown hair, blonde hair",
    }
    if hair_color in other_hair_colors:
        negative = f"{negative}, {other_hair_colors[hair_color]}"

    return positive, negative


# All permutations
ETHNICITIES = list(ETHNICITY_PROMPTS.keys())
BODY_TYPES = list(BODY_TYPE_PROMPTS.keys())
HAIR_COLORS = list(HAIR_COLOR_PROMPTS.keys())

# Total permutations: 7 * 4 * 5 = 140
TOTAL_PERMUTATIONS = len(ETHNICITIES) * len(BODY_TYPES) * len(HAIR_COLORS)

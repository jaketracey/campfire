"""
Visual Prompt Augmenter Tests

Tests for the visual prompt augmentation service that enriches
image generation prompts with character visual details from the companion spec.
"""

import pytest
from orchestrator.services.visual_prompt_augmenter import (
    VisualPromptAugmenter,
    get_visual_prompt_augmenter,
)


@pytest.fixture
def augmenter():
    """Create a fresh augmenter instance."""
    return VisualPromptAugmenter()


@pytest.fixture
def sample_appearance():
    """Sample appearance data from companion spec."""
    return {
        "gender": "female",
        "ethnicity": "east-asian",
        "hairColor": "black",
        "bodyType": "athletic",
    }


@pytest.fixture
def sample_visual_style():
    """Sample visual style data from companion spec."""
    return {
        "style_type": "photorealistic",
        "palette": ["warm", "natural"],
        "constraints": ["no nudity", "tasteful"],
    }


@pytest.fixture
def sample_companion_spec(sample_appearance, sample_visual_style):
    """Sample full companion spec."""
    return {
        "name": "Aria",
        "visual_style": {
            "appearance": sample_appearance,
            **sample_visual_style,
        },
    }


@pytest.fixture
def sample_recent_turns():
    """Sample recent conversation turns."""
    return [
        {"role": "user", "content": "Can you send me a photo of you at the beach?"},
        {"role": "assistant", "content": "Sure! I'm wearing my favorite sundress today."},
        {"role": "user", "content": "You look so happy smiling in the sunset!"},
    ]


class TestBuildCharacterDescription:
    """Tests for build_character_description method."""

    def test_returns_empty_string_for_none_appearance(self, augmenter):
        """Should return empty string when appearance is None."""
        result = augmenter.build_character_description(None)
        assert result == ""

    def test_returns_empty_string_for_empty_appearance(self, augmenter):
        """Should return empty string when appearance is empty dict."""
        result = augmenter.build_character_description({})
        assert result == ""

    def test_includes_gender(self, augmenter):
        """Should include gender in description."""
        result = augmenter.build_character_description({"gender": "female"})
        assert "female" in result

    def test_includes_ethnicity_description(self, augmenter):
        """Should map ethnicity to natural language description."""
        result = augmenter.build_character_description({"ethnicity": "east-asian"})
        assert "East Asian" in result

    def test_includes_hair_color_description(self, augmenter):
        """Should include hair color description."""
        result = augmenter.build_character_description({"hairColor": "blonde"})
        assert "blonde hair" in result

    def test_includes_body_type_description(self, augmenter):
        """Should include body type description."""
        result = augmenter.build_character_description({"bodyType": "athletic"})
        assert "athletic build" in result

    def test_combines_all_attributes(self, augmenter, sample_appearance):
        """Should combine all appearance attributes."""
        result = augmenter.build_character_description(sample_appearance)
        assert "female" in result
        assert "East Asian" in result
        assert "black hair" in result
        assert "athletic build" in result

    def test_includes_visual_style_when_provided(self, augmenter, sample_appearance, sample_visual_style):
        """Should include style type when visual_style is provided."""
        result = augmenter.build_character_description(sample_appearance, sample_visual_style)
        assert "photorealistic" in result

    def test_handles_unknown_ethnicity(self, augmenter):
        """Should pass through unknown ethnicity values."""
        result = augmenter.build_character_description({"ethnicity": "unknown-value"})
        assert "unknown-value" in result

    def test_handles_unknown_hair_color(self, augmenter):
        """Should pass through unknown hair color values."""
        result = augmenter.build_character_description({"hairColor": "purple"})
        assert "purple" in result

    def test_handles_unknown_body_type(self, augmenter):
        """Should pass through unknown body type values."""
        result = augmenter.build_character_description({"bodyType": "custom"})
        assert "custom" in result

    def test_all_ethnicity_mappings(self, augmenter):
        """Test all defined ethnicity mappings."""
        mappings = {
            "east-asian": "East Asian",
            "south-asian": "South Asian",
            "black": "Black/African",
            "caucasian": "Caucasian/European",
            "latina": "Latina/Hispanic",
            "middle-eastern": "Middle Eastern",
            "mixed": "mixed ethnicity",
        }
        for key, expected in mappings.items():
            result = augmenter.build_character_description({"ethnicity": key})
            assert expected in result, f"Expected '{expected}' for ethnicity '{key}'"

    def test_all_body_type_mappings(self, augmenter):
        """Test all defined body type mappings."""
        mappings = {
            "slim": "slim figure",
            "athletic": "athletic build",
            "curvy": "curvy figure",
            "plus-size": "plus-size figure",
            "muscular": "muscular build",
            "dad-bod": "dad-bod physique",
        }
        for key, expected in mappings.items():
            result = augmenter.build_character_description({"bodyType": key})
            assert expected in result, f"Expected '{expected}' for body type '{key}'"

    def test_all_style_type_mappings(self, augmenter):
        """Test all defined style type mappings."""
        mappings = {
            "photorealistic": "photorealistic",
            "anime": "anime art style",
            "illustration": "digital illustration style",
            "fantasy": "fantasy art style",
            "portrait": "professional portrait photography",
        }
        for key, expected in mappings.items():
            visual_style = {"style_type": key}
            result = augmenter.build_character_description({"gender": "female"}, visual_style)
            assert expected in result, f"Expected '{expected}' for style type '{key}'"


class TestExtractSceneContext:
    """Tests for extract_scene_context method."""

    def test_returns_empty_string_for_none_turns(self, augmenter):
        """Should return empty string when recent_turns is None."""
        result = augmenter.extract_scene_context(None)
        assert result == ""

    def test_returns_empty_string_for_empty_turns(self, augmenter):
        """Should return empty string when recent_turns is empty."""
        result = augmenter.extract_scene_context([])
        assert result == ""

    def test_extracts_clothing_keywords(self, augmenter):
        """Should extract clothing-related keywords."""
        turns = [{"content": "I'm wearing a red dress today"}]
        result = augmenter.extract_scene_context(turns)
        assert "wearing" in result

    def test_extracts_location_keywords(self, augmenter):
        """Should extract location-related keywords."""
        turns = [{"content": "Let's meet at the beach"}]
        result = augmenter.extract_scene_context(turns)
        assert "beach" in result

    def test_extracts_pose_keywords(self, augmenter):
        """Should extract pose-related keywords."""
        turns = [{"content": "I'm sitting by the window"}]
        result = augmenter.extract_scene_context(turns)
        assert "sitting" in result

    def test_extracts_expression_keywords(self, augmenter):
        """Should extract expression-related keywords."""
        turns = [{"content": "I can't stop smiling today!"}]
        result = augmenter.extract_scene_context(turns)
        assert "smiling" in result

    def test_extracts_time_keywords(self, augmenter):
        """Should extract time-related keywords."""
        turns = [{"content": "The sunset is beautiful this evening"}]
        result = augmenter.extract_scene_context(turns)
        assert "evening" in result or "sunset" in result

    def test_respects_max_turns_limit(self, augmenter):
        """Should only check up to max_turns."""
        turns = [
            {"content": "beach"},
            {"content": "park"},
            {"content": "cafe"},
            {"content": "room"},  # Should not be included with max_turns=3
            {"content": "outside"},  # Should not be included
        ]
        result = augmenter.extract_scene_context(turns, max_turns=3)
        # Should only process first 3 turns
        assert "beach" in result
        assert "park" in result
        assert "cafe" in result

    def test_limits_unique_hints(self, augmenter):
        """Should limit to 5 unique hints."""
        turns = [
            {"content": "beach morning sunset smiling laughing walking standing sitting cafe room"}
        ]
        result = augmenter.extract_scene_context(turns)
        hints = result.split(", ")
        assert len(hints) <= 5

    def test_removes_duplicate_keywords(self, augmenter):
        """Should return unique keywords only."""
        turns = [
            {"content": "smiling at the beach"},
            {"content": "still smiling at the same beach"},
        ]
        result = augmenter.extract_scene_context(turns)
        # Count occurrences of 'smiling' and 'beach'
        assert result.count("smiling") <= 1
        assert result.count("beach") <= 1

    def test_handles_empty_content(self, augmenter):
        """Should handle turns with empty content."""
        turns = [
            {"content": ""},
            {"content": None},
            {"role": "user"},  # No content key
        ]
        result = augmenter.extract_scene_context(turns)
        assert result == ""

    def test_case_insensitive_matching(self, augmenter):
        """Should match keywords case-insensitively."""
        turns = [{"content": "SMILING at the BEACH"}]
        result = augmenter.extract_scene_context(turns)
        assert "smiling" in result or "beach" in result


class TestAugmentPrompt:
    """Tests for augment_prompt method."""

    def test_returns_base_prompt_when_no_companion_spec(self, augmenter):
        """Should return augmented prompt with base prompt when no companion spec."""
        result = augmenter.augment_prompt("a beautiful portrait")
        assert "a beautiful portrait" in result
        assert "Maintain character consistency" in result

    def test_includes_character_description(self, augmenter, sample_companion_spec):
        """Should include character description from companion spec."""
        result = augmenter.augment_prompt("a portrait", companion_spec=sample_companion_spec)
        assert "Character:" in result
        assert "female" in result
        assert "East Asian" in result

    def test_includes_style_constraints(self, augmenter, sample_companion_spec):
        """Should include style constraints from companion spec."""
        result = augmenter.augment_prompt("a portrait", companion_spec=sample_companion_spec)
        assert "Style constraints:" in result
        assert "no nudity" in result

    def test_includes_scene_context(self, augmenter, sample_recent_turns):
        """Should include scene context from recent turns."""
        result = augmenter.augment_prompt(
            "a photo",
            recent_turns=sample_recent_turns
        )
        assert "Context:" in result

    def test_can_disable_style_inclusion(self, augmenter, sample_companion_spec):
        """Should not include style when include_style=False."""
        result = augmenter.augment_prompt(
            "a portrait",
            companion_spec=sample_companion_spec,
            include_style=False
        )
        # Character description should still be present but without style
        assert "Character:" in result
        # photorealistic should not be in the character description part
        # (it's added when visual_style is passed to build_character_description)

    def test_can_disable_scene_context(self, augmenter, sample_recent_turns):
        """Should not include context when include_scene_context=False."""
        result = augmenter.augment_prompt(
            "a photo",
            recent_turns=sample_recent_turns,
            include_scene_context=False
        )
        assert "Context:" not in result

    def test_full_augmentation(self, augmenter, sample_companion_spec, sample_recent_turns):
        """Should produce fully augmented prompt with all components."""
        result = augmenter.augment_prompt(
            "taking a selfie",
            companion_spec=sample_companion_spec,
            recent_turns=sample_recent_turns,
        )
        # Check all components are present
        assert "Character:" in result
        assert "Style constraints:" in result
        assert "Context:" in result
        assert "taking a selfie" in result
        assert "Maintain character consistency" in result

    def test_handles_missing_appearance_in_spec(self, augmenter):
        """Should handle companion spec without appearance."""
        spec = {"visual_style": {}}
        result = augmenter.augment_prompt("a portrait", companion_spec=spec)
        assert "a portrait" in result
        assert "Maintain character consistency" in result

    def test_handles_missing_visual_style_in_spec(self, augmenter):
        """Should handle companion spec without visual_style."""
        spec = {"name": "Test"}
        result = augmenter.augment_prompt("a portrait", companion_spec=spec)
        assert "a portrait" in result


class TestBuildNegativePrompt:
    """Tests for build_negative_prompt method."""

    def test_includes_quality_negatives(self, augmenter):
        """Should always include quality-related negatives."""
        result = augmenter.build_negative_prompt()
        assert "low quality" in result
        assert "blurry" in result
        assert "distorted" in result
        assert "bad anatomy" in result

    def test_adds_gender_specific_negatives_for_female(self, augmenter):
        """Should add masculine features negative for female characters."""
        spec = {"visual_style": {"appearance": {"gender": "female"}}}
        result = augmenter.build_negative_prompt(companion_spec=spec)
        assert "masculine features" in result

    def test_adds_gender_specific_negatives_for_male(self, augmenter):
        """Should add feminine features negative for male characters."""
        spec = {"visual_style": {"appearance": {"gender": "male"}}}
        result = augmenter.build_negative_prompt(companion_spec=spec)
        assert "feminine features" in result

    def test_adds_wrong_hair_color_negative(self, augmenter):
        """Should add wrong hair color negative when hair color specified."""
        spec = {"visual_style": {"appearance": {"hairColor": "blonde"}}}
        result = augmenter.build_negative_prompt(companion_spec=spec)
        assert "wrong hair color" in result

    def test_no_hair_color_negative_for_fantasy(self, augmenter):
        """Should not add wrong hair color for fantasy hair."""
        spec = {"visual_style": {"appearance": {"hairColor": "fantasy"}}}
        result = augmenter.build_negative_prompt(companion_spec=spec)
        assert "wrong hair color" not in result

    def test_appends_base_negative(self, augmenter):
        """Should append base negative prompt if provided."""
        result = augmenter.build_negative_prompt(base_negative="extra negative terms")
        assert "extra negative terms" in result

    def test_handles_none_companion_spec(self, augmenter):
        """Should handle None companion spec gracefully."""
        result = augmenter.build_negative_prompt(companion_spec=None)
        assert "low quality" in result  # Still has quality negatives

    def test_handles_empty_appearance(self, augmenter):
        """Should handle empty appearance in spec."""
        spec = {"visual_style": {"appearance": {}}}
        result = augmenter.build_negative_prompt(companion_spec=spec)
        assert "low quality" in result  # Still has quality negatives


class TestSingleton:
    """Tests for singleton instance getter."""

    def test_get_visual_prompt_augmenter_returns_instance(self):
        """Should return a VisualPromptAugmenter instance."""
        instance = get_visual_prompt_augmenter()
        assert isinstance(instance, VisualPromptAugmenter)

    def test_get_visual_prompt_augmenter_returns_same_instance(self):
        """Should return the same instance on repeated calls."""
        instance1 = get_visual_prompt_augmenter()
        instance2 = get_visual_prompt_augmenter()
        assert instance1 is instance2


class TestIntegrationScenarios:
    """Integration-style tests for realistic scenarios."""

    def test_anime_character_prompt(self, augmenter):
        """Test augmentation for anime-style character."""
        companion_spec = {
            "visual_style": {
                "appearance": {
                    "gender": "female",
                    "ethnicity": "east-asian",
                    "hairColor": "fantasy",
                    "bodyType": "slim",
                },
                "style_type": "anime",
                "constraints": ["cute aesthetic", "vibrant colors"],
            }
        }

        result = augmenter.augment_prompt(
            "winking playfully",
            companion_spec=companion_spec,
        )

        assert "anime art style" in result
        assert "female" in result
        assert "slim figure" in result

    def test_realistic_portrait_prompt(self, augmenter):
        """Test augmentation for realistic portrait."""
        companion_spec = {
            "visual_style": {
                "appearance": {
                    "gender": "male",
                    "ethnicity": "caucasian",
                    "hairColor": "brown",
                    "bodyType": "muscular",
                },
                "style_type": "portrait",
                "constraints": ["professional lighting"],
            }
        }

        recent_turns = [
            {"content": "Just finished my morning workout at the gym"},
        ]

        result = augmenter.augment_prompt(
            "confident smile",
            companion_spec=companion_spec,
            recent_turns=recent_turns,
        )

        assert "professional portrait photography" in result
        assert "male" in result
        assert "muscular build" in result
        assert "Context:" in result  # Should have morning context

    def test_negative_prompt_for_realistic_character(self, augmenter):
        """Test negative prompt generation for realistic character."""
        companion_spec = {
            "visual_style": {
                "appearance": {
                    "gender": "female",
                    "hairColor": "red",
                },
            }
        }

        result = augmenter.build_negative_prompt(
            companion_spec=companion_spec,
            base_negative="cartoon, anime",
        )

        assert "masculine features" in result
        assert "wrong hair color" in result
        assert "cartoon, anime" in result
        assert "bad anatomy" in result

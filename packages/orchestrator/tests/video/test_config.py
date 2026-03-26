"""Tests for video configuration."""

import pytest

from orchestrator.video.config import VideoSettings


class TestVideoSettings:
    """Test VideoSettings defaults and property logic."""

    def test_defaults(self):
        """Settings should load with sensible defaults."""
        settings = VideoSettings(
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.livekit_url == "ws://localhost:7880"
        assert settings.video_call_max_duration_minutes == 30
        assert settings.stt_sample_rate == 16000
        assert settings.tts_sample_rate == 24000
        assert settings.vad_threshold == 0.5

    def test_livekit_configured_false_when_empty(self):
        settings = VideoSettings(
            livekit_api_key="",
            livekit_api_secret="",
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.livekit_configured is False

    def test_livekit_configured_true(self):
        settings = VideoSettings(
            livekit_api_key="key123",
            livekit_api_secret="secret456",
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.livekit_configured is True

    def test_fully_configured_fal(self):
        settings = VideoSettings(
            avatar_provider="fal",
            livekit_api_key="k",
            livekit_api_secret="s",
            fal_api_key="fal",
            deepgram_api_key="dg",
            elevenlabs_api_key="el",
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.fully_configured is True

    def test_fully_configured_simli(self):
        settings = VideoSettings(
            avatar_provider="simli",
            livekit_api_key="k",
            livekit_api_secret="s",
            simli_api_key="simli",
            deepgram_api_key="dg",
            elevenlabs_api_key="el",
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.fully_configured is True

    def test_not_fully_configured_missing_avatar(self):
        settings = VideoSettings(
            avatar_provider="fal",
            livekit_api_key="k",
            livekit_api_secret="s",
            fal_api_key="",
            deepgram_api_key="dg",
            elevenlabs_api_key="el",
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.fully_configured is False

    def test_simli_configured(self):
        settings = VideoSettings(
            simli_api_key="abc",
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.simli_configured is True

    def test_deepgram_configured(self):
        settings = VideoSettings(
            deepgram_api_key="abc",
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.deepgram_configured is True

    def test_elevenlabs_configured(self):
        settings = VideoSettings(
            elevenlabs_api_key="abc",
            _env_file=None,  # type: ignore[call-arg]
        )
        assert settings.elevenlabs_configured is True

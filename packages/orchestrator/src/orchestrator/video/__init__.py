"""LiveKit-based video chat with AI companions.

This module provides real-time video chat by orchestrating:
- LiveKit for WebRTC transport
- Deepgram for streaming STT
- The existing ConversationOrchestrator for LLM processing
- ElevenLabs for TTS
- FAL live-avatar (or Simli) for avatar video rendering
"""

from orchestrator.video.config import VideoSettings, get_video_settings
from orchestrator.video.fal_avatar import FalAvatarClient, VideoFrame
from orchestrator.video.models import VideoCallConfig, VideoCallSession, VideoCallStatus

__all__ = [
    "FalAvatarClient",
    "VideoCallConfig",
    "VideoCallSession",
    "VideoCallStatus",
    "VideoFrame",
    "VideoSettings",
    "get_video_settings",
]

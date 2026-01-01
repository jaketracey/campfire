"""Game plugin framework for companion gaming features."""

from orchestrator.games.base import GamePlugin
from orchestrator.games.registry import GAME_PLUGINS, get_game_plugin

__all__ = [
    "GamePlugin",
    "GAME_PLUGINS",
    "get_game_plugin",
]

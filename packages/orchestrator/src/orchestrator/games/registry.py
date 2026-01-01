"""Game plugin registry."""

from orchestrator.games.base import GamePlugin
from orchestrator.games.tic_tac_toe import TicTacToePlugin
from orchestrator.models.games import GameType

# Registry of all available game plugins
GAME_PLUGINS: dict[GameType, GamePlugin] = {
    GameType.TIC_TAC_TOE: TicTacToePlugin(),
}


def get_game_plugin(game_type: GameType) -> GamePlugin | None:
    """Get a game plugin by type.

    Args:
        game_type: The type of game to get.

    Returns:
        The game plugin, or None if not found.
    """
    return GAME_PLUGINS.get(game_type)


def list_available_games() -> list[dict[str, str]]:
    """List all available games.

    Returns:
        List of dicts with game_type and display_name.
    """
    return [
        {"game_type": plugin.game_type.value, "display_name": plugin.display_name}
        for plugin in GAME_PLUGINS.values()
    ]

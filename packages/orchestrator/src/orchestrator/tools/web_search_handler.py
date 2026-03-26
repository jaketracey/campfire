"""Web search tool handler using DuckDuckGo search."""

import time
from typing import Any

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.tools.base import ToolHandler

logger = structlog.get_logger()


class WebSearchHandler(ToolHandler):
    """Handler for performing web searches via DuckDuckGo."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "web_search"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate search arguments."""
        query = arguments.get("query")
        if not query or not isinstance(query, str):
            return False, "query must be a non-empty string"
        if len(query.strip()) == 0:
            return False, "query must not be blank"
        max_results = arguments.get("max_results", 5)
        if not isinstance(max_results, int) or max_results < 1 or max_results > 20:
            return False, "max_results must be an integer between 1 and 20"
        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute a web search."""
        start_time = time.time()

        try:
            query = tool_call.arguments["query"]
            max_results = tool_call.arguments.get("max_results", 5)

            results = await self._search_duckduckgo(query, max_results)
            duration_ms = (time.time() - start_time) * 1000

            if not results:
                output = f"No web results found for: {query}"
            else:
                formatted = []
                for i, result in enumerate(results, 1):
                    title = result.get("title", "Untitled")
                    url = result.get("url", "")
                    snippet = result.get("snippet", "No description available.")
                    formatted.append(f"{i}. **{title}**\n   URL: {url}\n   {snippet}")
                output = f"Web search results for \"{query}\":\n\n" + "\n\n".join(formatted)

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                metadata={"result_count": len(results), "query": query},
            )

        except Exception as e:
            logger.exception("web_search_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=f"Web search failed: {str(e)}",
                duration_ms=duration_ms,
            )

    async def _search_duckduckgo(
        self, query: str, max_results: int
    ) -> list[dict[str, str]]:
        """Search using DuckDuckGo HTML endpoint.

        Uses the DuckDuckGo Lite HTML endpoint which does not require
        an API key. Falls back to the duckduckgo_search Python package
        if available.
        """
        # Try the duckduckgo_search package first (more reliable parsing)
        try:
            return await self._search_via_package(query, max_results)
        except ImportError:
            logger.debug("duckduckgo_search package not available, using HTTP fallback")
        except Exception as e:
            logger.warning("duckduckgo_search package failed", error=str(e))

        # Fallback: use DuckDuckGo JSON API (instant answers)
        try:
            return await self._search_via_api(query, max_results)
        except Exception as e:
            logger.warning("duckduckgo_api_fallback_failed", error=str(e))

        return []

    async def _search_via_package(
        self, query: str, max_results: int
    ) -> list[dict[str, str]]:
        """Search using the duckduckgo_search Python package."""
        import asyncio

        from duckduckgo_search import DDGS

        def _do_search() -> list[dict[str, str]]:
            results: list[dict[str, str]] = []
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=max_results):
                    results.append({
                        "title": r.get("title", ""),
                        "url": r.get("href", ""),
                        "snippet": r.get("body", ""),
                    })
            return results

        return await asyncio.get_event_loop().run_in_executor(None, _do_search)

    async def _search_via_api(
        self, query: str, max_results: int
    ) -> list[dict[str, str]]:
        """Search using DuckDuckGo Instant Answer API as fallback.

        This API returns structured instant answers but may not always
        return web search results. It is used as a best-effort fallback.
        """
        response = await self.http_client.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
            headers={"User-Agent": "CampfireAI/1.0"},
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()

        results: list[dict[str, str]] = []

        # Extract from RelatedTopics
        for topic in data.get("RelatedTopics", [])[:max_results]:
            if "Text" in topic and "FirstURL" in topic:
                results.append({
                    "title": topic.get("Text", "")[:80],
                    "url": topic.get("FirstURL", ""),
                    "snippet": topic.get("Text", ""),
                })

        # If there's an abstract, include it first
        if data.get("Abstract") and data.get("AbstractURL"):
            results.insert(0, {
                "title": data.get("Heading", "Result"),
                "url": data.get("AbstractURL", ""),
                "snippet": data.get("Abstract", ""),
            })

        return results[:max_results]

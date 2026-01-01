"""
ConversationRunner - Orchestrates multi-turn conversations for testing.

Design principles:
- Real LLM calls (configurable to use cheaper models in test mode)
- Response caching for cost reduction
- Full instrumentation for debugging
"""

from dataclasses import dataclass, field
from uuid import UUID, uuid4
from typing import Any
import hashlib
import json
import os
from pathlib import Path


@dataclass
class ConversationTurn:
    """A single turn in a test conversation."""

    turn_number: int
    user_message: str
    assistant_response: str
    latency_ms: float = 0.0
    tokens_used: int = 0


@dataclass
class ConversationSession:
    """A complete conversation session for testing."""

    session_id: UUID
    companion_id: UUID
    user_id: UUID
    turns: list[ConversationTurn] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class ResponseCache:
    """
    Persistent cache for LLM responses to reduce test costs.

    Cache key: hash(model + temperature + messages)
    Cache location: tests/.cache/responses/
    """

    def __init__(self, cache_dir: Path | None = None):
        self.cache_dir = cache_dir or Path(__file__).parent.parent / ".cache" / "responses"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _make_key(
        self,
        model: str,
        temperature: float,
        messages: list[dict[str, Any]],
    ) -> str:
        content = json.dumps(
            {
                "model": model,
                "temperature": temperature,
                "messages": messages,
            },
            sort_keys=True,
        )
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def get(
        self,
        model: str,
        temperature: float,
        messages: list[dict[str, Any]],
    ) -> str | None:
        key = self._make_key(model, temperature, messages)
        cache_file = self.cache_dir / f"{key}.json"

        if cache_file.exists():
            with open(cache_file) as f:
                return json.load(f).get("response")
        return None

    def set(
        self,
        model: str,
        temperature: float,
        messages: list[dict[str, Any]],
        response: str,
    ) -> None:
        key = self._make_key(model, temperature, messages)
        cache_file = self.cache_dir / f"{key}.json"

        with open(cache_file, "w") as f:
            json.dump(
                {
                    "model": model,
                    "temperature": temperature,
                    "messages": messages,
                    "response": response,
                },
                f,
            )


class ConversationRunner:
    """
    Runs multi-turn conversations against the orchestrator for testing.

    Features:
    - Configurable LLM provider (production vs cheaper test model)
    - Response caching based on (prompt_hash, model, temperature)
    - Turn-by-turn instrumentation
    - Session persistence for multi-session tests
    """

    def __init__(
        self,
        cache_responses: bool = True,
        test_model: str | None = None,
        api_base_url: str | None = None,
    ):
        self.cache_responses = cache_responses
        self.test_model = test_model or os.getenv("TEST_MODEL", "claude-3-haiku-20240307")
        self.api_base_url = api_base_url or os.getenv("ORCHESTRATOR_URL", "http://localhost:8000")
        self._response_cache = ResponseCache() if cache_responses else None

    async def run_conversation(
        self,
        companion_spec: dict[str, Any],
        user_messages: list[str],
        inject_facts: list[dict[str, Any]] | None = None,
    ) -> ConversationSession:
        """Run a full conversation and return instrumented results."""
        session_id = uuid4()
        user_id = uuid4()
        companion_id = UUID(companion_spec.get("id", str(uuid4())))

        turns: list[ConversationTurn] = []
        recent_turns: list[dict[str, Any]] = []

        for i, user_msg in enumerate(user_messages):
            import time

            start_time = time.time()

            # Build context with accumulated turns
            response = await self._call_orchestrator(
                session_id=session_id,
                user_id=user_id,
                companion_spec=companion_spec,
                user_message=user_msg,
                recent_turns=recent_turns,
            )

            latency_ms = (time.time() - start_time) * 1000

            turn = ConversationTurn(
                turn_number=i + 1,
                user_message=user_msg,
                assistant_response=response,
                latency_ms=latency_ms,
                tokens_used=len(response) // 4,  # Rough estimate
            )
            turns.append(turn)

            # Add to recent turns for next iteration
            recent_turns.append(
                {
                    "id": str(uuid4()),
                    "session_id": str(session_id),
                    "user_message": {"role": "user", "content": user_msg},
                    "assistant_message": {"role": "assistant", "content": response},
                }
            )

        return ConversationSession(
            session_id=session_id,
            companion_id=companion_id,
            user_id=user_id,
            turns=turns,
            metadata={"injected_facts": inject_facts},
        )

    async def run_multi_session(
        self,
        companion_spec: dict[str, Any],
        sessions: list[list[str]],
        session_gap_hours: float = 24.0,
    ) -> list[ConversationSession]:
        """Run multiple sessions to test cross-session memory."""
        results = []
        accumulated_context: list[dict[str, Any]] = []

        for session_messages in sessions:
            session = await self.run_conversation(
                companion_spec=companion_spec,
                user_messages=session_messages,
                inject_facts=accumulated_context,
            )
            results.append(session)

            # Extract facts from this session for next session's context
            accumulated_context.extend(self._extract_testable_facts(session))

        return results

    async def _call_orchestrator(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_spec: dict[str, Any],
        user_message: str,
        recent_turns: list[dict[str, Any]],
    ) -> str:
        """Call the orchestrator API to get a response."""
        import httpx

        # Check cache first
        if self._response_cache:
            messages = self._build_messages_for_cache(
                companion_spec, user_message, recent_turns
            )
            cached = self._response_cache.get(
                self.test_model, companion_spec.get("temperature", 0.7), messages
            )
            if cached:
                return cached

        # Make actual API call
        request_data = {
            "session_id": str(session_id),
            "user_id": str(user_id),
            "companion_spec": companion_spec,
            "user_message": user_message,
            "recent_turns": recent_turns,
            "session_summary": None,
            "long_term_memories": None,
            "companion_self_knowledge": None,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_base_url}/process",
                json=request_data,
                timeout=60.0,
            )
            response.raise_for_status()
            result = response.json()

        assistant_response = result.get("assistant_message", {}).get("content", "")

        # Cache the response
        if self._response_cache:
            messages = self._build_messages_for_cache(
                companion_spec, user_message, recent_turns
            )
            self._response_cache.set(
                self.test_model,
                companion_spec.get("temperature", 0.7),
                messages,
                assistant_response,
            )

        return assistant_response

    def _build_messages_for_cache(
        self,
        companion_spec: dict[str, Any],
        user_message: str,
        recent_turns: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Build a cacheable representation of the conversation."""
        messages = [{"role": "system", "content": companion_spec.get("system_prompt", "")}]

        for turn in recent_turns:
            if turn.get("user_message"):
                messages.append(turn["user_message"])
            if turn.get("assistant_message"):
                messages.append(turn["assistant_message"])

        messages.append({"role": "user", "content": user_message})
        return messages

    def _extract_testable_facts(self, session: ConversationSession) -> list[dict[str, Any]]:
        """Extract facts from a session for testing recall in future sessions."""
        # Simple extraction - in production this would use KG extraction
        facts = []
        for turn in session.turns:
            if any(
                keyword in turn.user_message.lower()
                for keyword in ["my name is", "i am", "i have", "i like", "i work"]
            ):
                facts.append(
                    {
                        "source": "user_message",
                        "content": turn.user_message,
                        "turn_number": turn.turn_number,
                    }
                )
        return facts

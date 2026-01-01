"""Context builder for assembling model input from various sources."""

import tiktoken
from typing import Any
from uuid import UUID

import structlog

from orchestrator.models.conversation import (
    BehavioralTenet,
    CompanionSpec,
    ConversationContext,
    ConversationTurn,
    Message,
    MessageRole,
    SessionSummary,
    SituationalTenetMatch,
)
from orchestrator.models.memory import LongTermMemory, MemoryQuery
from orchestrator.prompts.manager import PromptManager

logger = structlog.get_logger()


class ContextBuilder:
    """Builds model input context from various sources."""

    def __init__(
        self,
        prompt_manager: PromptManager,
        max_context_tokens: int = 128000,
        default_turn_window: int = 20,
    ):
        self.prompt_manager = prompt_manager
        self.max_context_tokens = max_context_tokens
        self.default_turn_window = default_turn_window
        self._tokenizer = tiktoken.get_encoding("cl100k_base")

    def count_tokens(self, text: str) -> int:
        """Count tokens in a text string."""
        return len(self._tokenizer.encode(text))

    def build_context(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_spec: CompanionSpec,
        recent_turns: list[ConversationTurn],
        session_summary: SessionSummary | None = None,
        long_term_memories: list[LongTermMemory] | None = None,
        safety_constraints: list[str] | None = None,
        active_tools: list[str] | None = None,
        situational_tenets: list[SituationalTenetMatch] | None = None,
        prompt_version: str = "1.0.0",
        policy_version: str = "1.0.0",
    ) -> ConversationContext:
        """Build a complete conversation context."""
        return ConversationContext(
            session_id=session_id,
            user_id=user_id,
            companion_spec=companion_spec,
            recent_turns=recent_turns,
            session_summary=session_summary,
            long_term_memories=long_term_memories or [],
            safety_constraints=safety_constraints or [],
            active_tools=active_tools or companion_spec.allowed_tools,
            situational_tenets=situational_tenets or [],
            prompt_version=prompt_version,
            policy_version=policy_version,
        )

    def build_system_prompt(
        self,
        companion_spec: CompanionSpec,
        session_summary: SessionSummary | None = None,
        long_term_memories: list[LongTermMemory] | None = None,
        safety_constraints: list[str] | None = None,
        situational_tenets: list[SituationalTenetMatch] | None = None,
        prompt_version: str = "1.0.0",
    ) -> str:
        """Build the system prompt from companion spec and context."""
        # Use adult template for adult safety level
        is_adult = companion_spec.safety_level == "adult"
        template_name = "system_base_adult" if is_adult else "system_base"

        # Get base prompt template
        base_prompt = self.prompt_manager.get_prompt(
            template_name,
            version=prompt_version,
            companion_name=companion_spec.name,
            personality_traits=", ".join(companion_spec.personality_traits),
            communication_style=companion_spec.communication_style,
            description=companion_spec.description,
        )

        # Add custom companion system prompt
        full_prompt = f"{base_prompt}\n\n{companion_spec.system_prompt}"

        # Add core behavioral tenets from companion spec
        if companion_spec.core_tenets:
            core_tenets_section = self._format_core_tenets(companion_spec.core_tenets)
            full_prompt += f"\n\n{core_tenets_section}"

        # Add situational tenets matched for this message
        if situational_tenets:
            situational_section = self._format_situational_tenets(situational_tenets)
            full_prompt += f"\n\n{situational_section}"

        # Add session context if available
        if session_summary:
            session_context = self._format_session_summary(session_summary)
            full_prompt += f"\n\n{session_context}"

        # Add long-term memories if available
        if long_term_memories:
            memory_context = self._format_memories(long_term_memories)
            full_prompt += f"\n\n{memory_context}"

        # Add safety constraints
        if safety_constraints:
            safety_section = self._format_safety_constraints(safety_constraints)
            full_prompt += f"\n\n{safety_section}"

        return full_prompt

    def build_messages(
        self,
        context: ConversationContext,
        current_user_message: str,
    ) -> list[dict[str, Any]]:
        """Build the message list for the model API call."""
        messages: list[dict[str, Any]] = []

        # Add system prompt
        system_prompt = self.build_system_prompt(
            companion_spec=context.companion_spec,
            session_summary=context.session_summary,
            long_term_memories=context.long_term_memories,
            safety_constraints=context.safety_constraints,
            situational_tenets=context.situational_tenets,
            prompt_version=context.prompt_version,
        )
        messages.append({"role": "system", "content": system_prompt})

        # Add recent turn history within token budget
        history_messages = self._build_history_messages(context)
        messages.extend(history_messages)

        # Add current user message
        messages.append({"role": "user", "content": current_user_message})

        # Trim if exceeding token limit
        messages = self._trim_to_token_limit(messages)

        return messages

    def _build_history_messages(
        self,
        context: ConversationContext,
    ) -> list[dict[str, Any]]:
        """Build message history from recent turns."""
        messages: list[dict[str, Any]] = []
        max_turns = context.companion_spec.max_context_turns

        for turn in context.recent_turns[-max_turns:]:
            # Add user message
            messages.append({
                "role": "user",
                "content": turn.user_message.content,
            })

            # Add tool calls if present
            if turn.tool_calls:
                for tool_call in turn.tool_calls:
                    messages.append({
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [tool_call],
                    })

            # Add tool results if present
            if turn.tool_results:
                for tool_result in turn.tool_results:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_result.get("tool_call_id"),
                        "content": str(tool_result.get("output", "")),
                    })

            # Add assistant message
            if turn.assistant_message:
                messages.append({
                    "role": "assistant",
                    "content": turn.assistant_message.content,
                })

        return messages

    def _format_session_summary(self, summary: SessionSummary) -> str:
        """Format session summary for context."""
        lines = [
            "<session_context>",
            f"Previous session summary: {summary.summary_text}",
        ]

        if summary.key_topics:
            lines.append(f"Key topics discussed: {', '.join(summary.key_topics)}")

        if summary.emotional_state:
            lines.append(f"User's emotional state: {summary.emotional_state}")

        lines.append(f"Total interactions: {summary.turn_count}")
        lines.append("</session_context>")

        return "\n".join(lines)

    def _format_memories(self, memories: list[LongTermMemory]) -> str:
        """Format long-term memories for context."""
        if not memories:
            return ""

        lines = ["<long_term_memories>"]
        for memory in memories:
            lines.append(f"- [{memory.memory_type.value}] {memory.content}")
        lines.append("</long_term_memories>")

        return "\n".join(lines)

    def _format_safety_constraints(self, constraints: list[str]) -> str:
        """Format safety constraints for context."""
        lines = ["<safety_constraints>"]
        for constraint in constraints:
            lines.append(f"- {constraint}")
        lines.append("</safety_constraints>")

        return "\n".join(lines)

    def _format_core_tenets(self, tenets: list[BehavioralTenet]) -> str:
        """Format core behavioral tenets for the system prompt.

        Core tenets are always included in the prompt and represent the
        fundamental behavioral rules the companion must follow.
        """
        if not tenets:
            return ""

        lines = ["<behavioral_rules>"]
        lines.append("These are your core behavioral rules. Follow them in all interactions:")
        lines.append("")

        for tenet in tenets:
            prefix = "NEVER:" if tenet.is_negation else ""
            category_label = tenet.category.value.upper()
            if prefix:
                lines.append(f"- [{category_label}] {prefix} {tenet.rule}")
            else:
                lines.append(f"- [{category_label}] {tenet.rule}")

        lines.append("</behavioral_rules>")

        return "\n".join(lines)

    def _format_situational_tenets(self, tenets: list[SituationalTenetMatch]) -> str:
        """Format situational tenets matched for the current context.

        Situational tenets are dynamically retrieved based on the conversation
        context and provide guidance specific to the current interaction.
        """
        if not tenets:
            return ""

        lines = ["<situational_guidance>"]
        lines.append("Based on this conversation's context, also consider:")
        lines.append("")

        for tenet in tenets:
            prefix = "Avoid:" if tenet.is_negation else ""
            if prefix:
                lines.append(f"- {prefix} {tenet.rule}")
            else:
                lines.append(f"- {tenet.rule}")

        lines.append("</situational_guidance>")

        return "\n".join(lines)

    def _trim_to_token_limit(
        self,
        messages: list[dict[str, Any]],
        reserve_tokens: int = 4096,
    ) -> list[dict[str, Any]]:
        """Trim messages to fit within token limit."""
        target_limit = self.max_context_tokens - reserve_tokens

        # Count total tokens
        total_tokens = 0
        for msg in messages:
            content = msg.get("content", "")
            if content:
                total_tokens += self.count_tokens(str(content))

        if total_tokens <= target_limit:
            return messages

        # Keep system message and current user message, trim history
        if len(messages) <= 2:
            return messages

        system_msg = messages[0]
        current_msg = messages[-1]
        history = messages[1:-1]

        # Remove oldest messages until within limit
        while history and total_tokens > target_limit:
            removed = history.pop(0)
            content = removed.get("content", "")
            if content:
                total_tokens -= self.count_tokens(str(content))

        logger.info(
            "trimmed_context",
            remaining_messages=len(history) + 2,
            total_tokens=total_tokens,
        )

        return [system_msg] + history + [current_msg]

    def estimate_response_cost(
        self,
        messages: list[dict[str, Any]],
        model: str,
        max_completion_tokens: int = 4096,
    ) -> dict[str, float]:
        """Estimate the cost of a model call."""
        # Token counts
        prompt_tokens = sum(
            self.count_tokens(str(msg.get("content", "")))
            for msg in messages
        )

        # Pricing per 1M tokens (approximate)
        pricing = {
            "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
            "claude-3-opus-20240229": {"input": 15.0, "output": 75.0},
            "claude-3-sonnet-20240229": {"input": 3.0, "output": 15.0},
            "claude-3-haiku-20240307": {"input": 0.25, "output": 1.25},
            "gpt-4-turbo-preview": {"input": 10.0, "output": 30.0},
            "gpt-4o": {"input": 5.0, "output": 15.0},
            "gpt-3.5-turbo": {"input": 0.5, "output": 1.5},
        }

        model_pricing = pricing.get(model, {"input": 3.0, "output": 15.0})

        input_cost = (prompt_tokens / 1_000_000) * model_pricing["input"]
        output_cost = (max_completion_tokens / 1_000_000) * model_pricing["output"]

        return {
            "prompt_tokens": prompt_tokens,
            "estimated_completion_tokens": max_completion_tokens,
            "estimated_input_cost_usd": input_cost,
            "estimated_output_cost_usd": output_cost,
            "estimated_total_cost_usd": input_cost + output_cost,
        }

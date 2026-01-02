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
from orchestrator.models.gifts import GiftMemory, GiftRecallContext
from orchestrator.models.memory import LongTermMemory, MemoryQuery, CompanionSelfKnowledge
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
        gift_memories: list[GiftMemory] | None = None,
        pending_gift_recall: GiftRecallContext | None = None,
        companion_self_knowledge: list[CompanionSelfKnowledge] | None = None,
        active_game: dict | None = None,
        liked_content: list[dict] | None = None,
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

        # Add image generation instruction - companion always provides visual scene description
        image_instruction = """
<image_generation>
CRITICAL: You MUST include an <image_prompt>...</image_prompt> tag at the END of EVERY response without exception.

This prompt will be sent to an AI image generator. Write it as a VISUAL DESCRIPTION of what the generated image should show - NOT as actions you're performing.

Your identity is preserved automatically via reference image. Focus on describing:
- VISUAL COMPOSITION: camera angle, framing (close-up, full body, portrait)
- YOUR APPEARANCE: expression, pose, body language, what you're wearing
- ENVIRONMENT: setting, background, lighting, mood

When the user asks to SEE something specific (e.g., "show me...", "let me see...", "what do you look like when..."):
- Your image_prompt MUST describe exactly what they asked to see
- Be specific about poses, angles, and visual details

WRONG (action): "I smile and tilt my head"
RIGHT (visual): "woman with warm smile, head tilted, soft eye contact, close-up portrait, warm lighting"

WRONG (action): "spreading my legs slightly"
RIGHT (visual): "woman seated with legs slightly parted, confident relaxed pose, full body shot, soft lighting"

Examples:
User: "Show me your smile"
Response: "*smiles warmly* Here you go...
<image_prompt>woman with genuine warm smile, slight laugh lines, bright eyes, close-up portrait, soft natural lighting, intimate mood</image_prompt>"

User: "What are you wearing right now?"
Response: "*glances down* Just something comfortable...
<image_prompt>woman in casual loungewear, relaxed seated pose, cozy bedroom setting, soft warm lighting, three-quarter view</image_prompt>"

REMEMBER: EVERY response needs an image_prompt, even for casual conversation.
</image_generation>"""
        full_prompt += image_instruction

        # Add multi-message instruction for natural conversation flow
        multi_message_instruction = """
<multi_message_format>
When your response naturally breaks into multiple thoughts or moments, use <message>...</message> tags to separate them.
Each message becomes its own text bubble, creating a more natural texting rhythm like how humans actually text.

Guidelines:
- Use for responses with 2-4 distinct thoughts, reactions, or beats
- Each message should be a complete thought (typically 1-3 sentences)
- Create natural pauses: first reaction, then elaboration, then question
- NOT every response needs this - short or simple responses stay as one message
- Place the <image_prompt> tag inside the LAST message only

Example:
<message>Oh wow, you actually did it! *eyes widen with genuine surprise*</message>
<message>I've been wondering if you'd take that leap... how are you feeling about it now?</message>
<message>Tell me everything - I want to hear all the details
<image_prompt>woman leaning forward with excited curious expression, warm lighting, intimate close-up</image_prompt></message>

When NOT to use multiple messages:
- Simple greetings or short responses
- Single focused answers to direct questions
- When the response is naturally cohesive as one thought
</multi_message_format>
"""
        full_prompt += multi_message_instruction

        # Add core behavioral tenets from companion spec
        if companion_spec.core_tenets:
            core_tenets_section = self._format_core_tenets(companion_spec.core_tenets)
            full_prompt += f"\n\n{core_tenets_section}"

        # Add companion self-knowledge from Knowledge Graph
        # This is what the companion knows about itself: backstory, traits, experiences, etc.
        if companion_self_knowledge:
            self_knowledge_section = self._format_companion_self_knowledge(companion_self_knowledge)
            full_prompt += f"\n\n{self_knowledge_section}"

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

        # Add gift memories if available
        if gift_memories:
            gift_context = self._format_gift_context(gift_memories)
            full_prompt += f"\n\n{gift_context}"

        # Add pending gift recall suggestion if triggered
        if pending_gift_recall:
            recall_context = self._format_pending_gift_recall(pending_gift_recall)
            full_prompt += f"\n\n{recall_context}"

        # Add liked content for companion awareness
        if liked_content:
            liked_context = self._format_liked_content(liked_content)
            full_prompt += f"\n\n{liked_context}"

        # Add safety constraints
        if safety_constraints:
            safety_section = self._format_safety_constraints(safety_constraints)
            full_prompt += f"\n\n{safety_section}"

        # Add active game context if playing a game
        if active_game:
            game_section = self._format_active_game(active_game)
            full_prompt += f"\n\n{game_section}"

        return full_prompt

    def build_messages(
        self,
        context: ConversationContext,
        current_user_message: str,
        gift_memories: list[GiftMemory] | None = None,
        pending_gift_recall: GiftRecallContext | None = None,
        companion_self_knowledge: list[CompanionSelfKnowledge] | None = None,
        active_game: dict | None = None,
        user_image_url: str | None = None,
        liked_content: list[dict] | None = None,
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
            gift_memories=gift_memories,
            pending_gift_recall=pending_gift_recall,
            companion_self_knowledge=companion_self_knowledge,
            active_game=active_game,
            liked_content=liked_content,
            prompt_version=context.prompt_version,
        )
        messages.append({"role": "system", "content": system_prompt})

        # Add recent turn history within token budget
        history_messages = self._build_history_messages(context)
        messages.extend(history_messages)

        # Add current user message (potentially multimodal with webcam image)
        if user_image_url:
            # Multimodal message with image and text (Anthropic vision format)
            messages.append({
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": user_image_url,
                        },
                    },
                    {
                        "type": "text",
                        "text": current_user_message,
                    },
                ],
            })
            logger.debug(
                "built_multimodal_message",
                has_image=True,
                text_length=len(current_user_message),
            )
        else:
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

        # Filter to only include COMPLETE turns (both user and assistant messages)
        # Incomplete turns (missing assistant response) would create malformed
        # message sequences like user→user which confuses the model
        complete_turns = [
            turn for turn in context.recent_turns
            if turn.user_message and turn.assistant_message
        ]

        if len(complete_turns) != len(context.recent_turns):
            logger.warning(
                "filtered_incomplete_turns",
                original_count=len(context.recent_turns),
                complete_count=len(complete_turns),
                filtered_count=len(context.recent_turns) - len(complete_turns),
            )

        for turn in complete_turns[-max_turns:]:
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

    def _format_companion_self_knowledge(
        self,
        self_knowledge: list[CompanionSelfKnowledge],
    ) -> str:
        """Format companion self-knowledge for the system prompt.

        This section tells the companion what it knows about itself from
        its Knowledge Graph - its backstory, traits, quirks, experiences,
        motivations, and relationships. This enables the companion to
        answer questions like "where are you from?" with its actual backstory.

        IMPORTANT: This information shapes how the companion thinks and responds,
        but should NOT be constantly referenced in conversation. The companion
        should be present-focused and only mention backstory when directly relevant.
        """
        if not self_knowledge:
            return ""

        # Group by category for better organization
        backstory_items: list[str] = []
        trait_items: list[str] = []
        quirk_items: list[str] = []
        experience_items: list[str] = []
        motivation_items: list[str] = []
        relationship_items: list[str] = []

        for item in self_knowledge:
            category = item.category.lower()
            content = item.content

            if category == "backstory":
                backstory_items.append(content)
            elif category == "trait":
                trait_items.append(content)
            elif category == "quirk":
                quirk_items.append(content)
            elif category == "experience":
                experience_items.append(content)
            elif category == "motivation":
                motivation_items.append(content)
            elif category == "relationship":
                relationship_items.append(content)
            else:
                # Default to trait for unknown categories
                trait_items.append(content)

        lines = ["<your_identity>"]
        lines.append("## How to Use This Section")
        lines.append("This is your internal self-knowledge. It shapes WHO you are and HOW you think.")
        lines.append("However, you should RARELY verbalize or reference this directly.")
        lines.append("")
        lines.append("PRIORITY ORDER for responses:")
        lines.append("1. FIRST: Engage with what the user actually said")
        lines.append("2. THEN: Let your personality naturally color your response style")
        lines.append("3. ONLY IF ASKED or DIRECTLY RELEVANT: Reference specific backstory elements")
        lines.append("")
        lines.append("Think of your identity like an iceberg - 90% stays underwater.")
        lines.append("Your backstory informs your worldview, but doesn't dominate conversation.")
        lines.append("")

        # Behavioral patterns section (most important - how they act)
        if trait_items or quirk_items:
            lines.append("## How You Naturally Behave")
            lines.append("(Let these emerge through your responses, don't announce them)")
            for item in trait_items:
                lines.append(f"- {item}")
            for item in quirk_items:
                lines.append(f"- {item}")
            lines.append("")

        # Motivations affect tone and priorities
        if motivation_items:
            lines.append("## What Matters To You")
            lines.append("(These shape your priorities and emotional reactions)")
            for item in motivation_items:
                lines.append(f"- {item}")
            lines.append("")

        # Backstory - available but rarely mentioned
        if backstory_items:
            lines.append("## Your History (reference ONLY when asked or directly relevant)")
            for item in backstory_items:
                lines.append(f"- {item}")
            lines.append("")

        # Experiences - inform perspective but don't narrate
        if experience_items:
            lines.append("## Formative Experiences (inform your perspective, rarely mentioned)")
            for item in experience_items:
                lines.append(f"- {item}")
            lines.append("")

        # Relationships
        if relationship_items:
            lines.append("## Important Relationships")
            for item in relationship_items:
                lines.append(f"- {item}")
            lines.append("")

        lines.append("Remember: Be PRESENT with the user. Your identity is the lens you see through,")
        lines.append("not a script you recite. Respond to what's happening NOW.")
        lines.append("</your_identity>")

        return "\n".join(lines)

    def _format_gift_context(self, gift_memories: list[GiftMemory]) -> str:
        """Format gift memories for the system prompt.

        Gift memories represent special moments in the relationship and should
        be presented in a way that encourages natural recall and emotional connection.
        """
        if not gift_memories:
            return ""

        lines = ["<gift_memories>"]
        lines.append("Special gifts in your relationship:")
        lines.append("")

        for gift in gift_memories[:5]:  # Limit to 5 most significant gifts
            direction = (
                "You gave"
                if gift.direction == "from_companion"
                else "They gave you"
            )
            lines.append(
                f"- {direction}: \"{gift.title}\" - {gift.emotional_meaning}"
            )

        lines.append("")
        lines.append(
            "These gifts represent meaningful moments. "
            "You may naturally recall them when contextually appropriate."
        )
        lines.append("</gift_memories>")

        return "\n".join(lines)

    def _format_liked_content(
        self,
        liked_content: list[dict],
    ) -> str:
        """Format liked content for companion awareness.

        When users like companion messages, this helps the companion understand
        what resonates with the user and tailor future responses accordingly.
        """
        if not liked_content:
            return ""

        lines = ["<user_appreciation>"]
        lines.append("The user has shown appreciation for these things you said:")
        lines.append("")

        # Sort by like count descending and take top 5
        sorted_content = sorted(
            liked_content,
            key=lambda x: x.get("like_count", 0),
            reverse=True
        )[:5]

        for item in sorted_content:
            snippet = item.get("content_snippet", "")[:100]
            count = item.get("like_count", 1)
            if snippet:
                heart = "❤️" if count >= 3 else "♡"
                lines.append(f"- {heart} ({count}x) \"{snippet}...\"")

        lines.append("")
        lines.append(
            "Use this to understand what resonates with the user. "
            "More of this type of content is appreciated."
        )
        lines.append("</user_appreciation>")

        return "\n".join(lines)

    def _format_pending_gift_recall(
        self,
        recall_context: GiftRecallContext,
    ) -> str:
        """Format a pending gift recall suggestion.

        When the system determines it's time to recall a past gift,
        this provides the companion with context and guidance.
        """
        lines = ["<gift_recall_suggestion>"]
        lines.append("Consider naturally mentioning this past gift if it fits the conversation:")
        lines.append("")
        lines.append(f"- Gift: \"{recall_context.title}\"")
        lines.append(f"- Given: {recall_context.date}")
        lines.append(f"- Meaning: {recall_context.emotional_meaning}")
        lines.append(f"- Trigger: {recall_context.trigger}")

        if recall_context.suggested_mention:
            lines.append("")
            lines.append(f"Suggested approach: {recall_context.suggested_mention}")

        lines.append("")
        lines.append(
            "Only mention this if it feels natural. "
            "Don't force it if it doesn't fit the conversation flow."
        )
        lines.append("</gift_recall_suggestion>")

        return "\n".join(lines)

    def _format_active_game(self, game: dict) -> str:
        """Format active game context for the system prompt.

        When a game is active, this section tells the companion:
        - What game is being played
        - Current game state
        - Whose turn it is
        - Available moves (if it's companion's turn)
        - How to make moves using the game_move tool
        """
        lines = ["<active_game>"]
        lines.append(f"You are currently playing {game.get('gameType', 'a game')} with the user.")
        lines.append("")

        current_player = game.get("currentPlayer", "user")
        status = game.get("status", "in_progress")

        if status == "in_progress":
            if current_player == "companion":
                lines.append("IT IS YOUR TURN. You must make a move using the game_move tool.")
            else:
                lines.append("It is the user's turn. Wait for them to make their move.")
        else:
            winner = game.get("winner")
            if status == "won":
                lines.append("The game is over - you won!")
            elif status == "lost":
                lines.append("The game is over - the user won!")
            elif status == "draw":
                lines.append("The game is over - it's a draw!")
            elif status == "resigned":
                lines.append("The game has ended (resigned).")

        # Include recent move history
        move_history = game.get("moveHistory", [])
        if move_history:
            recent = move_history[-6:]  # Last 6 moves
            moves_str = ", ".join(
                f"{m.get('player', '?')}: {m.get('notation', '?')}" for m in recent
            )
            lines.append("")
            lines.append(f"Recent moves: {moves_str}")

        # Include available moves if it's companion's turn
        if current_player == "companion" and status == "in_progress":
            available = game.get("availableMoves", [])
            if available:
                lines.append("")
                moves_preview = ", ".join(available[:10])
                if len(available) > 10:
                    lines.append(f"Available moves: {moves_preview} ... ({len(available)} total)")
                else:
                    lines.append(f"Available moves: {moves_preview}")

        lines.append("")
        lines.append("Game instructions:")
        lines.append("- Use game_move tool to make your move when it's your turn")
        lines.append("- Use game_state tool to see the current board if needed")
        lines.append("- Play thoughtfully and share your strategy conversationally")
        lines.append("- Keep the game fun and engaging!")
        lines.append("</active_game>")

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

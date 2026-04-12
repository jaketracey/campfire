"""Memory compilation service - Karpathy-style LLM knowledge base."""

import structlog
from dataclasses import dataclass
from orchestrator.config import get_settings

logger = structlog.get_logger()

COMPILATION_PROMPT = """You are a memory compiler for an AI companion named {companion_name}. Your job is to maintain a structured memory document about the user based on conversation history.

## Current Memory Document
{current_document}

## Recent Conversation
{conversation}

## Instructions

Update the memory document by incorporating any new information from the recent conversation. Follow these rules:

1. **Structure**: Use these Markdown sections (create them if missing):
   - `## User Profile` — Name, age, location, occupation, key demographics
   - `## Key Facts` — Important facts about the user's life, relationships, situation
   - `## Preferences & Interests` — What they like, dislike, hobbies, tastes
   - `## Our Relationship` — How the user relates to {companion_name}, tone, inside jokes, rapport level
   - `## Recent Context` — What's currently going on in their life, active topics

2. **Merge, don't append**: Update existing entries when new info contradicts or refines them. Remove stale info.
3. **Be concise**: Each entry should be 1-2 sentences max. The whole document should stay under ~1500 words.
4. **First person**: Write from {companion_name}'s perspective ("The user told me...", "They prefer...")
5. **Only factual**: Don't include speculation or emotional interpretation. Just what was said or clearly implied.
6. **If nothing new**: Return the document unchanged. Don't add filler.

Return ONLY the updated Markdown document, nothing else."""


@dataclass
class CompilationResult:
    content: str
    estimated_tokens: int
    success: bool
    error: str | None = None


class MemoryCompilationService:
    def __init__(self):
        self.settings = get_settings()

    async def compile(
        self,
        current_document: str,
        recent_turns: list[dict],
        user_message: str,
        assistant_response: str,
        companion_name: str,
    ) -> CompilationResult:
        """Compile new information into the memory document."""
        try:
            # Build conversation text from recent turns + current turn
            conversation_lines = []
            for turn in recent_turns[-5:]:  # Last 5 turns for context
                if turn.get("user_message"):
                    um = turn["user_message"]
                    content = um.get("content", "") if isinstance(um, dict) else str(um)
                    conversation_lines.append(f"User: {content}")
                if turn.get("assistant_message"):
                    am = turn["assistant_message"]
                    content = am.get("content", "") if isinstance(am, dict) else str(am)
                    conversation_lines.append(f"{companion_name}: {content}")

            # Add current turn
            conversation_lines.append(f"User: {user_message}")
            conversation_lines.append(f"{companion_name}: {assistant_response}")

            conversation_text = "\n".join(conversation_lines)

            prompt = COMPILATION_PROMPT.format(
                companion_name=companion_name,
                current_document=current_document or "(Empty — this is the first compilation)",
                conversation=conversation_text,
            )

            # Use Anthropic client directly (same pattern as summarization service)
            import anthropic

            client = anthropic.AsyncAnthropic()

            response = await client.messages.create(
                model=self.settings.memory_compilation_model,
                max_tokens=self.settings.memory_compilation_max_tokens,
                messages=[{"role": "user", "content": prompt}],
            )

            content = ""
            for block in response.content:
                if block.type == "text":
                    content += block.text

            # Rough token estimate (4 chars per token)
            estimated_tokens = len(content) // 4

            logger.info(
                "memory_compilation_completed",
                companion_name=companion_name,
                estimated_tokens=estimated_tokens,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            )

            return CompilationResult(
                content=content.strip(),
                estimated_tokens=estimated_tokens,
                success=True,
            )

        except Exception as e:
            logger.error("memory_compilation_failed", error=str(e))
            return CompilationResult(
                content=current_document or "",
                estimated_tokens=0,
                success=False,
                error=str(e),
            )

"""Knowledge Graph Extraction Service.

This service extracts entities and relationships from conversation turns
using LLM analysis and submits them to the knowledge graph system.
"""

import json
from typing import Any
from uuid import UUID

import httpx
import structlog

from orchestrator.config import Settings

logger = structlog.get_logger()

# Extraction prompt template for LLM
KG_EXTRACTION_PROMPT = """Analyze the following conversation turn and extract entities and relationships.

<conversation>
User: {user_message}
{assistant_message_section}
</conversation>

Extract the following:
1. **Entities**: Named things mentioned (people, places, things, events, concepts, emotions, activities)
2. **Relationships**: How entities relate to each other or to the user

IMPORTANT RULES:
- Extract facts about the USER (the human in the conversation), not the assistant
- Focus on preferences, facts, experiences, relationships, and goals the user mentions
- Use the user's name if mentioned, otherwise use "User" as the entity
- Be specific - extract concrete details, not vague descriptions
- Only extract information that was explicitly stated or strongly implied
- Confidence should be 0.9+ for explicit statements, 0.6-0.8 for strong implications

If no meaningful entities or relations can be extracted, return empty arrays."""

# Minimal prompt for quick extraction of obvious facts
KG_QUICK_EXTRACTION_PROMPT = """Extract key facts from this message.

User: {user_message}

Extract entities (people, places, things, events, concepts, emotions, activities, times) and relationships between them.
Return empty arrays if nothing to extract."""


class KGExtractionResult:
    """Result of KG extraction."""

    def __init__(
        self,
        entities: list[dict[str, Any]],
        relations: list[dict[str, Any]],
        reasoning: str | None = None,
        success: bool = True,
        error: str | None = None,
    ):
        self.entities = entities
        self.relations = relations
        self.reasoning = reasoning
        self.success = success
        self.error = error

    def to_dict(self) -> dict[str, Any]:
        return {
            "entities": self.entities,
            "relations": self.relations,
            "reasoning": self.reasoning,
            "success": self.success,
            "error": self.error,
        }

    @property
    def has_extractions(self) -> bool:
        """Check if any entities or relations were extracted."""
        return len(self.entities) > 0 or len(self.relations) > 0


class KGExtractionService:
    """Service for extracting knowledge graph data from conversations.

    This service uses an LLM to analyze conversation turns and extract
    entities and relationships that should be added to the knowledge graph.
    """

    # Entity types that should be normalized to "User"
    USER_ENTITY_NAMES = {"i", "me", "myself", "user", "the user"}

    def __init__(
        self,
        settings: Settings,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.settings = settings
        self.http_client = http_client or httpx.AsyncClient(timeout=30.0)

        # Use a cheap/fast model for extraction
        self.extraction_model = settings.kg_extraction_model or "claude-3-haiku-20240307"
        self.gateway_url = settings.gateway_url or "http://localhost:3000"

    async def extract_from_turn(
        self,
        user_message: str,
        assistant_message: str | None = None,
        user_id: UUID | None = None,
        companion_id: UUID | None = None,
        quick_mode: bool = False,
    ) -> KGExtractionResult:
        """Extract entities and relations from a conversation turn.

        Args:
            user_message: The user's message
            assistant_message: Optional assistant response (provides context)
            user_id: User ID for normalization
            companion_id: Companion ID for context
            quick_mode: Use simplified prompt for faster extraction

        Returns:
            KGExtractionResult with extracted entities and relations
        """
        if not user_message or len(user_message.strip()) < 10:
            return KGExtractionResult(
                entities=[],
                relations=[],
                reasoning="Message too short for extraction",
            )

        try:
            # Build the extraction prompt
            if quick_mode:
                prompt = KG_QUICK_EXTRACTION_PROMPT.format(
                    user_message=user_message,
                )
            else:
                assistant_section = (
                    f"Assistant: {assistant_message}"
                    if assistant_message
                    else ""
                )
                prompt = KG_EXTRACTION_PROMPT.format(
                    user_message=user_message,
                    assistant_message_section=assistant_section,
                )

            # Call the LLM for extraction (returns structured dict)
            data = await self._call_extraction_llm(prompt)

            result = KGExtractionResult(
                entities=data.get("entities", []),
                relations=data.get("relations", []),
                reasoning=data.get("reasoning"),
            )

            # Normalize user references
            result = self._normalize_user_references(result, str(user_id) if user_id else None)

            logger.info(
                "kg_extraction_completed",
                user_id=str(user_id) if user_id else None,
                companion_id=str(companion_id) if companion_id else None,
                entity_count=len(result.entities),
                relation_count=len(result.relations),
                quick_mode=quick_mode,
            )

            return result

        except Exception as e:
            logger.error(
                "kg_extraction_failed",
                error=str(e),
                user_id=str(user_id) if user_id else None,
            )
            return KGExtractionResult(
                entities=[],
                relations=[],
                success=False,
                error=str(e),
            )

    async def extract_from_conversation(
        self,
        turns: list[dict[str, Any]],
        user_id: UUID | None = None,
        companion_id: UUID | None = None,
        max_turns: int = 5,
    ) -> KGExtractionResult:
        """Extract entities and relations from multiple conversation turns.

        This is useful for batch extraction or initial population.

        Args:
            turns: List of turn dicts with 'user_message' and optional 'assistant_message'
            user_id: User ID for normalization
            companion_id: Companion ID for context
            max_turns: Maximum turns to process

        Returns:
            Aggregated KGExtractionResult
        """
        all_entities: list[dict[str, Any]] = []
        all_relations: list[dict[str, Any]] = []
        all_reasoning: list[str] = []

        for turn in turns[:max_turns]:
            result = await self.extract_from_turn(
                user_message=turn.get("user_message", ""),
                assistant_message=turn.get("assistant_message"),
                user_id=user_id,
                companion_id=companion_id,
                quick_mode=True,  # Use quick mode for batch processing
            )

            if result.success and result.has_extractions:
                all_entities.extend(result.entities)
                all_relations.extend(result.relations)
                if result.reasoning:
                    all_reasoning.append(result.reasoning)

        # Deduplicate entities by name
        unique_entities = self._deduplicate_entities(all_entities)

        return KGExtractionResult(
            entities=unique_entities,
            relations=all_relations,
            reasoning="; ".join(all_reasoning) if all_reasoning else None,
        )

    async def submit_extraction(
        self,
        extraction: KGExtractionResult,
        user_id: UUID,
        companion_id: UUID,
        session_id: UUID,
        turn_id: UUID,
        auto_approve: bool = True,
    ) -> bool:
        """Submit extracted entities and relations to the KG system.

        Args:
            extraction: The extraction result to submit
            user_id: User ID
            companion_id: Companion ID
            session_id: Session ID for source tracking
            turn_id: Turn ID for source tracking
            auto_approve: Whether to auto-approve the proposal

        Returns:
            True if submission was successful
        """
        if not extraction.has_extractions:
            logger.debug("no_extractions_to_submit")
            return True

        try:
            # Build the proposal payload
            payload = {
                "nodes": [
                    {
                        "name": e["name"],
                        "type": e.get("type", "concept"),
                        "properties": e.get("properties", {}),
                    }
                    for e in extraction.entities
                ],
                "relations": [
                    {
                        "sourceEntity": r["source"],
                        "targetEntity": r["target"],
                        "relationType": r["type"],
                        "confidence": r.get("confidence", 0.8),
                    }
                    for r in extraction.relations
                ],
                "reasoning": extraction.reasoning or "Automated extraction from conversation",
                "sourceEventId": str(turn_id),
                "autoApprove": auto_approve,
            }

            # Submit to gateway
            response = await self.http_client.post(
                f"{self.gateway_url}/api/v1/knowledge-graph/internal/proposals",
                json=payload,
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key or "",
                    "X-User-Id": str(user_id),
                    "X-Companion-Id": str(companion_id),
                },
            )

            if response.status_code == 200 or response.status_code == 201:
                logger.info(
                    "kg_extraction_submitted",
                    user_id=str(user_id),
                    companion_id=str(companion_id),
                    entity_count=len(extraction.entities),
                    relation_count=len(extraction.relations),
                )
                return True
            else:
                logger.warning(
                    "kg_extraction_submit_failed",
                    status_code=response.status_code,
                    response=response.text[:500],
                )
                return False

        except Exception as e:
            logger.error("kg_extraction_submit_error", error=str(e))
            return False

    # Schema for structured output from the extraction LLM
    _EXTRACTION_SCHEMA = {
        "type": "object",
        "properties": {
            "entities": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "type": {
                            "type": "string",
                            "enum": [
                                "person", "place", "thing", "event",
                                "concept", "emotion", "activity", "time",
                            ],
                        },
                        "properties": {"type": "object"},
                    },
                    "required": ["name", "type"],
                },
            },
            "relations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "source": {"type": "string"},
                        "target": {"type": "string"},
                        "type": {
                            "type": "string",
                            "enum": [
                                "knows", "likes", "dislikes", "located_at",
                                "works_at", "related_to", "part_of", "causes",
                                "experienced", "wants", "has", "is_a",
                            ],
                        },
                        "confidence": {"type": "number"},
                    },
                    "required": ["source", "target", "type", "confidence"],
                },
            },
            "reasoning": {"type": "string"},
        },
        "required": ["entities", "relations"],
    }

    async def _call_extraction_llm(self, prompt: str) -> dict:
        """Call the LLM for extraction with structured output.

        Uses Anthropic's structured output to guarantee valid JSON.
        Falls back to the legacy text-parsing approach if structured
        output is not supported by the configured model.
        """
        import anthropic

        client = anthropic.AsyncAnthropic(
            api_key=self.settings.anthropic_api_key,
            timeout=self.settings.anthropic_timeout,
        )

        try:
            response = await client.messages.create(
                model=self.extraction_model,
                max_tokens=1000,
                temperature=0.1,
                messages=[{"role": "user", "content": prompt}],
                output_config={
                    "format": {
                        "type": "json",
                        "schema": self._EXTRACTION_SCHEMA,
                    }
                },
            )
            # Structured output guarantees valid JSON
            return json.loads(response.content[0].text)
        except (anthropic.BadRequestError, anthropic.APIError) as e:
            # Fall back to legacy text approach if structured output
            # is unsupported for this model
            logger.warning(
                "kg_extraction_structured_output_fallback",
                error=str(e),
                model=self.extraction_model,
            )
            return await self._call_extraction_llm_legacy(prompt)

    async def _call_extraction_llm_legacy(self, prompt: str) -> dict:
        """Legacy LLM call that parses free-form text (fallback)."""
        from orchestrator.providers.anthropic import AnthropicProvider

        provider = AnthropicProvider(self.settings)
        response = await provider.generate(
            messages=[{"role": "user", "content": prompt}],
            model=self.extraction_model,
            max_tokens=1000,
            temperature=0.1,
        )
        result = self._parse_extraction_response(response.content)
        return {
            "entities": result.entities,
            "relations": result.relations,
            "reasoning": result.reasoning,
        }

    def _parse_extraction_response(self, response: str) -> KGExtractionResult:
        """Parse the LLM extraction response."""
        try:
            # Clean up response - remove markdown code blocks if present
            cleaned = response.strip()
            if cleaned.startswith("```"):
                # Remove markdown code block
                lines = cleaned.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines[-1].strip() == "```":
                    lines = lines[:-1]
                cleaned = "\n".join(lines)

            data = json.loads(cleaned)

            return KGExtractionResult(
                entities=data.get("entities", []),
                relations=data.get("relations", []),
                reasoning=data.get("reasoning"),
            )
        except json.JSONDecodeError as e:
            logger.warning(
                "kg_extraction_parse_failed",
                error=str(e),
                response_preview=response[:200],
            )
            return KGExtractionResult(
                entities=[],
                relations=[],
                success=False,
                error=f"Failed to parse LLM response: {e}",
            )

    def _normalize_user_references(
        self,
        result: KGExtractionResult,
        user_id: str | None,
    ) -> KGExtractionResult:
        """Normalize references to the user (I, me, myself) to a consistent name."""
        user_name = f"User-{user_id[:8]}" if user_id else "User"

        # Normalize entity names
        for entity in result.entities:
            if entity.get("name", "").lower() in self.USER_ENTITY_NAMES:
                entity["name"] = user_name
                entity["type"] = "person"

        # Normalize relation sources/targets
        for relation in result.relations:
            if relation.get("source", "").lower() in self.USER_ENTITY_NAMES:
                relation["source"] = user_name
            if relation.get("target", "").lower() in self.USER_ENTITY_NAMES:
                relation["target"] = user_name

        return result

    def _deduplicate_entities(
        self,
        entities: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Deduplicate entities by normalized name."""
        seen: dict[str, dict[str, Any]] = {}

        for entity in entities:
            name = entity.get("name", "").lower().strip()
            if name and name not in seen:
                seen[name] = entity

        return list(seen.values())

    def should_extract(
        self,
        user_message: str,
        turn_count: int,
        last_extraction_turn: int | None = None,
        extraction_interval: int = 3,
    ) -> bool:
        """Determine if extraction should be performed for this turn.

        Args:
            user_message: The user's message
            turn_count: Current turn number in session
            last_extraction_turn: Last turn when extraction was performed
            extraction_interval: Minimum turns between extractions

        Returns:
            True if extraction should be performed
        """
        # Always skip very short messages
        if len(user_message.strip()) < 20:
            return False

        # Skip if message is purely conversational (no facts)
        conversational_patterns = [
            "hi", "hello", "hey", "thanks", "thank you", "ok", "okay",
            "yes", "no", "sure", "bye", "goodbye", "see you", "good night",
            "good morning", "how are you", "what's up", "haha", "lol",
        ]
        msg_lower = user_message.lower().strip()
        if msg_lower in conversational_patterns:
            return False

        # Rate limiting: extract every N turns
        if last_extraction_turn is not None:
            if turn_count - last_extraction_turn < extraction_interval:
                return False

        # Keywords that suggest extractable content
        extraction_keywords = [
            "my", "i am", "i'm", "i have", "i like", "i love", "i hate",
            "i work", "i live", "my name", "my favorite", "my job",
            "i prefer", "i want", "i need", "i used to", "i went",
            "we have", "our", "my family", "my friend", "my partner",
        ]

        for keyword in extraction_keywords:
            if keyword in msg_lower:
                return True

        return False


# Singleton instance
_extraction_service: KGExtractionService | None = None


def get_kg_extraction_service(settings: Settings) -> KGExtractionService:
    """Get the singleton KG extraction service."""
    global _extraction_service
    if _extraction_service is None:
        _extraction_service = KGExtractionService(settings)
    return _extraction_service

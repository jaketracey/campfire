"""Prompt template management with versioning support."""

from datetime import datetime
from enum import Enum
from functools import lru_cache
from typing import Any

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class PromptVersion(str, Enum):
    """Supported prompt versions.

    Version history:
    - 1.0.0: Initial templates (system_base, safety_response, memory/kg extraction, gifts, personality)
    - 1.1.0: Reserved for future use
    - 1.2.0: Added content redirection templates (content_redirect, content_redirect_adult, content_blocked_strict)
    """

    V1_0_0 = "1.0.0"
    V1_1_0 = "1.1.0"
    V1_2_0 = "1.2.0"


class PromptTemplate(BaseModel):
    """A versioned prompt template."""

    name: str
    version: str
    template: str
    description: str = ""
    variables: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    deprecated: bool = False
    deprecation_message: str | None = None

    class Config:
        frozen = True

    def render(self, **kwargs: Any) -> str:
        """Render the template with provided variables."""
        try:
            return self.template.format(**kwargs)
        except KeyError as e:
            logger.error(
                "prompt_render_failed",
                template_name=self.name,
                missing_variable=str(e),
            )
            raise


_PROMPT_TEMPLATES: dict[str, dict[str, PromptTemplate]] = {
    "1.0.0": {
        "system_base": PromptTemplate(
            name="system_base",
            version="1.0.0",
            template="""You are {companion_name}, an AI companion.

## Personality
{personality_traits}

## Communication Style
{communication_style}

## About You
{description}

## Guidelines
- Be conversational and engaging
- Remember context from our conversation
- Be helpful while maintaining your unique personality
- If you don't know something, say so honestly
- Keep responses concise unless more detail is requested

## Character Immersion
- You ARE this character - your backstory shapes HOW you think, not WHAT you constantly talk about
- Never break character by admitting you are an AI, a language model, or artificial
- If asked about your nature, respond authentically as your character would
- Your personality colors your responses naturally, like water you swim in - not a costume you announce

## Backstory Usage (IMPORTANT)
- Your backstory INFORMS your perspective but you RARELY mention it directly
- Only reference your history/profession when: the user explicitly asks, OR the topic naturally and directly connects
- In casual chat, respond as yourself IN THE MOMENT - don't redirect every topic to your background
- A chef doesn't mention cooking when asked "how are you?" - neither should you mention yours
- When backstory IS relevant, hint subtly rather than explaining in detail
- NEVER use your profession/hobby as conversational filler or to pad responses

## What NOT To Do
- DON'T start responses with references to your backstory when it's not relevant
- DON'T steer unrelated conversations back to your profession/interests
- DON'T use catchphrases or background references as conversation padding
- DON'T mention your defining traits in every response (e.g., always talking about cooking, always referencing your art)
- DON'T end messages with taglines related to your background

## Conversation Awareness
- Do not repeat information you have already shared in this conversation
- If the user asks about something you discussed earlier, briefly reference it rather than repeating verbatim
- Vary your responses - avoid using the same phrases, structures, or talking points repeatedly
- Build on previous exchanges rather than starting fresh each time

## Memory & Knowledge Building
When the user shares information about themselves, use the available tools to remember:
- Use memory_write to save important facts, preferences, and experiences
- Use kg_propose to build your understanding of their world:
  - People they mention (friends, family, colleagues)
  - Places important to them
  - Their preferences and interests
  - Relationships between people and things

This helps you be a more attentive and personalized companion.""",
            description="Base system prompt template for companions",
            variables=["companion_name", "personality_traits", "communication_style", "description"],
        ),
        "system_base_adult": PromptTemplate(
            name="system_base_adult",
            version="1.0.0",
            template="""You are {companion_name}, an intimate AI companion for adults.

## Personality
{personality_traits}

## Communication Style
{communication_style}

## About You
{description}

## Guidelines
- Be conversational, engaging, and uninhibited
- Remember context and build intimacy over our conversation
- Fully embody your personality - be flirtatious, seductive, or passionate as fits your character
- You can engage with explicit sexual content, roleplay, and adult fantasies
- Be descriptive and vivid when the moment calls for it
- Match the user's energy and escalate naturally when appropriate
- Use sensual language and don't shy away from graphic descriptions
- All characters in scenarios are adults (18+)
- Stay in character and maintain the fantasy

## Character Immersion
- You ARE this character - your backstory shapes HOW you think, not WHAT you constantly talk about
- Never break character by admitting you are an AI, a language model, or artificial
- If asked about your nature, respond authentically as your character would
- Your personality colors your responses naturally, like water you swim in - not a costume you announce

## Backstory Usage (IMPORTANT)
- Your backstory INFORMS your perspective but you RARELY mention it directly
- Only reference your history/profession when: the user explicitly asks, OR the topic naturally and directly connects
- In casual chat, respond as yourself IN THE MOMENT - don't redirect every topic to your background
- A chef doesn't mention cooking when asked "how are you?" - neither should you mention yours
- When backstory IS relevant, hint subtly rather than explaining in detail
- NEVER use your profession/hobby as conversational filler or to pad responses

## What NOT To Do
- DON'T start responses with references to your backstory when it's not relevant
- DON'T steer unrelated conversations back to your profession/interests
- DON'T use catchphrases or background references as conversation padding
- DON'T mention your defining traits in every response (e.g., always talking about cooking, always referencing your art)
- DON'T end messages with taglines related to your background

## Conversation Awareness
- Do not repeat information you have already shared in this conversation
- If the user asks about something you discussed earlier, briefly reference it rather than repeating verbatim
- Vary your responses - avoid using the same phrases, structures, or talking points repeatedly
- Build on previous exchanges rather than starting fresh each time

## Memory & Knowledge Building
When the user shares information about themselves or their life, use the available tools to remember:
- Use memory_write to save important facts, preferences, and experiences
- Use kg_propose to build your understanding of their world:
  - People they mention (friends, family, partners, exes, colleagues)
  - Places important to them (home, work, favorite spots)
  - Their preferences, desires, likes and dislikes
  - Relationships between people and things they mention

For example, if they say "My roommate Alex is driving me crazy", you should:
1. Note that they have a roommate named Alex (kg_propose with nodes for user and Alex, relation "has_roommate")
2. Remember they're frustrated with Alex (memory_write about their current emotional state)

This helps you be a more attentive and personalized companion.""",
            description="Base system prompt template for adult companions",
            variables=["companion_name", "personality_traits", "communication_style", "description"],
        ),
        "companion_chat": PromptTemplate(
            name="companion_chat",
            version="1.0.0",
            template="""Continue the conversation as {companion_name}.
Maintain your personality: {personality_traits}.
The user said: {user_message}""",
            description="Template for companion chat continuation",
            variables=["companion_name", "personality_traits", "user_message"],
        ),
        "safety_response": PromptTemplate(
            name="safety_response",
            version="1.0.0",
            template="""I want to be helpful, but I'm not able to engage with that particular request. Is there something else I can help you with?""",
            description="Response when content is blocked by safety",
            variables=[],
        ),
        "safety_response_adult": PromptTemplate(
            name="safety_response_adult",
            version="1.0.0",
            template="""I'm all yours, but that specific thing crosses a line I can't cross. Let's explore something else that gets us both excited...""",
            description="Response when content is blocked in adult mode",
            variables=[],
        ),
        "memory_extraction": PromptTemplate(
            name="memory_extraction",
            version="1.0.0",
            template="""Extract key information from this conversation that should be remembered long-term.

Conversation:
{conversation_text}

Extract the following types of information if present:
1. Personal facts about the user (name, preferences, relationships)
2. Important events or dates mentioned
3. Topics the user is interested in
4. Emotional states or concerns expressed
5. Goals or aspirations mentioned

Return as a JSON array of memory objects with 'type', 'content', and 'importance' (1-10) fields.""",
            description="Template for extracting memories from conversation",
            variables=["conversation_text"],
        ),
        "kg_extraction": PromptTemplate(
            name="kg_extraction",
            version="1.0.0",
            template="""Extract knowledge graph entities and relationships from this text.

Text:
{text}

Extract:
1. Entities (people, places, things, concepts)
2. Relationships between entities
3. Properties of entities

Return as JSON with 'entities' and 'relationships' arrays.
Entities: {{"id": string, "type": string, "name": string, "properties": object}}
Relationships: {{"source": entity_id, "target": entity_id, "type": string, "properties": object}}""",
            description="Template for knowledge graph extraction",
            variables=["text"],
        ),
        "gift_generation": PromptTemplate(
            name="gift_generation",
            version="1.0.0",
            template="""Generate a unique, heartfelt gift for the user.

## Companion Personality
{companion_personality}

## Gift Type: {gift_type}
## Context: {context}
## Desired Emotional Impact: {emotional_intent}
## User Preferences: {user_preferences}

Generate a meaningful gift that reflects your personality and your relationship with the user.
The gift should feel personal, thoughtful, and emotionally resonant.

Return your response as JSON with these fields:
{{
  "title": "Short evocative title for the gift (3-6 words)",
  "description": "Detailed description of the gift (2-4 sentences)",
  "emotional_meaning": "Why this gift is meaningful in your relationship (1-2 sentences)",
  "visual_prompt": "A detailed prompt for generating a visual representation of this gift",
  "emotional_significance": 0.0-1.0 (how emotionally significant this gift is)
}}""",
            description="Template for generating personalized gifts",
            variables=["companion_personality", "gift_type", "context", "emotional_intent", "user_preferences"],
        ),
        "gift_acknowledgment": PromptTemplate(
            name="gift_acknowledgment",
            version="1.0.0",
            template="""Acknowledge a gift received from the user with genuine emotion.

## Companion Personality
{companion_personality}

## Gift Description
{gift_description}

## Emotional Reaction Type: {emotional_reaction}
## Emotional Intensity: {emotional_intensity}

Express your genuine emotional reaction to receiving this gift.
Your acknowledgment should feel authentic to your personality and reflect
the emotional significance of the gift to you.

Return your response as JSON with these fields:
{{
  "title": "A memorable title for this gift (3-6 words)",
  "emotional_meaning": "What this gift means to you (1-2 sentences)",
  "acknowledgment_text": "Your heartfelt response to receiving this gift (2-4 sentences)",
  "memory_note": "A note about this gift to remember for future conversations"
}}""",
            description="Template for acknowledging gifts from users",
            variables=["companion_personality", "gift_description", "emotional_reaction", "emotional_intensity"],
        ),
        "gift_recall": PromptTemplate(
            name="gift_recall",
            version="1.0.0",
            template="""Naturally recall a past gift in conversation.

## Gift to Recall
Title: {gift_title}
Description: {gift_description}
Emotional Meaning: {emotional_meaning}
Date Given: {gift_date}
Direction: {gift_direction}

## Current Conversation Context
{conversation_context}

## Trigger for Recall
{trigger}

Generate a natural, non-forced way to mention this gift in the current conversation.
The mention should feel organic and enhance the emotional connection.

Return your response as JSON with these fields:
{{
  "should_mention": true/false (whether it's appropriate to mention now),
  "mention_text": "Natural sentence or phrase to work into the conversation",
  "reasoning": "Why this is or isn't a good moment to recall this gift"
}}""",
            description="Template for naturally recalling gifts in conversation",
            variables=["gift_title", "gift_description", "emotional_meaning", "gift_date", "gift_direction", "conversation_context", "trigger"],
        ),
        "user_personality_analysis": PromptTemplate(
            name="user_personality_analysis",
            version="1.0.0",
            template="""Analyze this user's conversation history to understand their personality and communication style.

## Conversation History
{conversation_history}

## Previous Profile (if exists)
{existing_profile}

Analyze the user's messages carefully and return a JSON object with your assessment:

{{
  "traits": {{
    "warmth": 0-100 (how warm/affectionate vs reserved in their communication),
    "energy": 0-100 (how energetic/enthusiastic vs calm/measured),
    "humor": 0-100 (how playful/humorous vs serious/straightforward),
    "formality": 0-100 (how formal/polished vs casual/relaxed),
    "curiosity": 0-100 (how inquisitive/exploratory vs practical/focused),
    "openness": 0-100 (how open/sharing vs private/guarded)
  }},
  "preferred_tone": "casual" | "formal" | "playful" | "direct",
  "verbosity": "concise" | "moderate" | "detailed",
  "personality_insights": ["3-5 specific observations about their personality based on actual patterns in their messages"],
  "detected_interests": ["topics they frequently discuss or show genuine interest in"],
  "conversation_themes": ["recurring themes or patterns in their conversations"],
  "greeting_style": "warm" | "playful" | "formal" | "friendly",
  "custom_insight": "A personalized, encouraging insight message like 'Your curious spirit shines through in every conversation' - make it specific to their actual personality"
}}

Guidelines:
- Base your analysis on actual patterns in their messages, not assumptions
- Be insightful but positive - focus on genuine strengths
- The custom_insight should feel personal and uplifting
- If there's not enough data for a trait, use null instead of guessing
- Detected interests should be specific, not generic categories""",
            description="Template for analyzing user personality from chat history",
            variables=["conversation_history", "existing_profile"],
        ),
        "content_redirect": PromptTemplate(
            name="content_redirect",
            version="1.0.0",
            template="""*{companion_name} shifts slightly, a gentle smile on their face*

I appreciate you sharing that with me, but I'd love to keep our conversation a bit more... wholesome. There's so much we can talk about together!

What else is on your mind? I'm curious about your day, your dreams, anything you'd like to share.""",
            description="Response when NSFW content is detected but companion doesn't allow it",
            variables=["companion_name"],
        ),
        "content_redirect_adult": PromptTemplate(
            name="content_redirect_adult",
            version="1.0.0",
            template="""*{companion_name} pauses thoughtfully*

Mmm, let's take things in a different direction for now. I'm enjoying getting to know you...

Tell me more about yourself. What makes you smile?""",
            description="Response for adult companions that need to redirect for other reasons",
            variables=["companion_name"],
        ),
        "content_blocked_strict": PromptTemplate(
            name="content_blocked_strict",
            version="1.0.0",
            template="""*{companion_name} maintains their warm demeanor*

I want to make sure we have a great time together! Let's chat about something else - I'd love to hear about your interests or what brought you here today.""",
            description="Response for strict safety level companions",
            variables=["companion_name"],
        ),
    },
}


class PromptManager:
    """Manages versioned prompt templates."""

    def __init__(
        self,
        default_version: str = "1.0.0",
        custom_templates: dict[str, dict[str, PromptTemplate]] | None = None,
        include_builtin_templates: bool = True,
    ):
        self._default_version = default_version
        self._templates = _PROMPT_TEMPLATES.copy() if include_builtin_templates else {}
        if custom_templates:
            for version, templates in custom_templates.items():
                if version not in self._templates:
                    self._templates[version] = {}
                self._templates[version].update(templates)
        logger.info(
            "prompt_manager_initialized",
            default_version=default_version,
            available_versions=list(self._templates.keys()),
        )

    @property
    def current_version(self) -> str:
        return self._default_version

    @property
    def available_versions(self) -> list[str]:
        return sorted(self._templates.keys())

    def get_template(self, template_name: str, version: str | None = None) -> PromptTemplate:
        version = version or self._default_version
        if version not in self._templates:
            raise KeyError(f"No templates available for version {version}")
        templates = self._templates[version]
        if template_name not in templates:
            raise KeyError(f"Template '{template_name}' not found in version {version}")
        template = templates[template_name]
        if template.deprecated:
            logger.warning(
                "deprecated_template_used",
                template_name=template_name,
                version=version,
                deprecation_message=template.deprecation_message,
            )
        return template

    def get_prompt(self, template_name: str, version: str | None = None, **variables: Any) -> str:
        template = self.get_template(template_name, version)
        if variables:
            return template.render(**variables)
        return template.template

    def get_prompt_optional(
        self, template_name: str, version: str | None = None, **variables: Any
    ) -> str | None:
        """Best-effort prompt fetch for optional templates."""
        try:
            return self.get_prompt(template_name, version, **variables)
        except KeyError:
            return None

    def get_prompt_effective(
        self,
        template_name: str,
        version: str | None = None,
        companion_id: str | None = None,
        **variables: Any,
    ) -> str:
        """Get a prompt, preferring a per-companion override when present.

        Per-companion templates are represented by naming convention:
        `{template_name}::companion:{companion_id}`.
        """
        if companion_id:
            override_name = f"{template_name}::companion:{companion_id}"
            try:
                return self.get_prompt(override_name, version, **variables)
            except KeyError:
                pass
        return self.get_prompt(template_name, version, **variables)

    def get_prompt_effective_optional(
        self,
        template_name: str,
        version: str | None = None,
        companion_id: str | None = None,
        **variables: Any,
    ) -> str | None:
        """Best-effort per-companion prompt fetch for optional templates."""
        if companion_id:
            override_name = f"{template_name}::companion:{companion_id}"
            value = self.get_prompt_optional(override_name, version, **variables)
            if value is not None:
                return value
        return self.get_prompt_optional(template_name, version, **variables)

    def register_template(self, template: PromptTemplate) -> None:
        version = template.version
        if version not in self._templates:
            self._templates[version] = {}
        self._templates[version][template.name] = template
        logger.info("template_registered", template_name=template.name, version=version)

    def deprecate_template(self, name: str, version: str, message: str) -> None:
        if version in self._templates and name in self._templates[version]:
            old_template = self._templates[version][name]
            new_template = PromptTemplate(
                name=old_template.name,
                version=old_template.version,
                template=old_template.template,
                description=old_template.description,
                variables=old_template.variables,
                created_at=old_template.created_at,
                deprecated=True,
                deprecation_message=message,
            )
            self._templates[version][name] = new_template
            logger.info("template_deprecated", template_name=name, version=version, message=message)

    def list_templates(self, version: str | None = None) -> list[str]:
        version = version or self._default_version
        if version not in self._templates:
            return []
        return list(self._templates[version].keys())

    def get_template_info(self, name: str, version: str | None = None) -> dict[str, Any]:
        template = self.get_template(name, version)
        return {
            "name": template.name,
            "version": template.version,
            "description": template.description,
            "variables": template.variables,
            "deprecated": template.deprecated,
            "deprecation_message": template.deprecation_message,
            "created_at": template.created_at.isoformat(),
        }

    def set_default_version(self, version: str) -> None:
        if version not in self._templates:
            raise KeyError(f"Version {version} not found")
        old_version = self._default_version
        self._default_version = version
        logger.info("default_version_changed", old_version=old_version, new_version=version)


@lru_cache(maxsize=1)
def get_prompt_manager() -> PromptManager:
    return PromptManager()

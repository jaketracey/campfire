"""Prompt template management with versioning support."""

from datetime import datetime
from enum import Enum
from functools import lru_cache
from typing import Any

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class PromptVersion(str, Enum):
    """Supported prompt versions."""

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
    },
}


class PromptManager:
    """Manages versioned prompt templates."""

    def __init__(
        self,
        default_version: str = "1.0.0",
        custom_templates: dict[str, dict[str, PromptTemplate]] | None = None,
    ):
        self._default_version = default_version
        self._templates = _PROMPT_TEMPLATES.copy()
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

    def get_template(self, name: str, version: str | None = None) -> PromptTemplate:
        version = version or self._default_version
        if version not in self._templates:
            available = sorted(self._templates.keys(), reverse=True)
            for v in available:
                if v <= version:
                    version = v
                    break
            else:
                raise KeyError(f"No templates available for version {version}")
        templates = self._templates[version]
        if name not in templates:
            raise KeyError(f"Template '{name}' not found in version {version}")
        template = templates[name]
        if template.deprecated:
            logger.warning(
                "deprecated_template_used",
                template_name=name,
                version=version,
                deprecation_message=template.deprecation_message,
            )
        return template

    def get_prompt(self, name: str, version: str | None = None, **variables: Any) -> str:
        template = self.get_template(name, version)
        if variables:
            return template.render(**variables)
        return template.template

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

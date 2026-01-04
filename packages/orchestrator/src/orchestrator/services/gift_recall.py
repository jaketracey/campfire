"""Gift recall service for surprise gift mentions during conversations."""

import random
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.models.gifts import GiftMemory, GiftRecallContext

logger = structlog.get_logger()

# Stop words to exclude from keyword matching
GIFT_KEYWORD_STOP_WORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "must", "shall", "can", "need",
    "this", "that", "these", "those", "what", "which", "who", "whom",
    "how", "when", "where", "why", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just", "also",
    "now", "here", "there", "then", "once", "still", "even", "well",
    "back", "being", "through", "way", "your", "you", "they", "them",
    "their", "its", "our", "his", "her", "him", "she", "he", "it", "we",
    "about", "into", "over", "after", "before", "between", "under",
    "again", "further", "because", "while", "during", "until", "against",
})


class GiftRecallService:
    """Service for triggering surprise gift recalls during conversations.

    This service manages the logic for when and how companions should
    spontaneously recall past gifts exchanged with the user, creating
    moments of emotional connection and continuity.
    """

    # Probability configuration
    BASE_RECALL_PROBABILITY = 0.05  # 5% base chance per turn
    MAX_RECALL_PROBABILITY = 0.25  # Cap at 25% after time scaling
    PROBABILITY_INCREASE_PER_DAY = 0.005  # Increase by 0.5% per day since last recall

    # Context-aware relevance scoring
    CONTEXT_RELEVANCE_BOOST = 0.15  # Max probability boost for highly relevant gifts
    KEYWORD_MATCH_WEIGHT = 0.05  # Weight per matching keyword
    MAX_KEYWORD_BOOST = 0.10  # Cap on keyword-based boost

    # Timing constraints
    MIN_TURNS_BETWEEN_RECALLS = 10  # Minimum turns between gift recalls
    MIN_DAYS_FOR_RECALL = 3  # Gifts must be at least 3 days old to recall

    def __init__(
        self,
        settings: Settings,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.settings = settings
        self.http_client = http_client or httpx.AsyncClient(timeout=30.0)

        # Track last recall per session to enforce spacing
        self._last_recall_turn: dict[str, int] = {}

        # Track last recall time per user-companion pair
        self._last_recall_time: dict[str, datetime] = {}

    async def should_trigger_recall(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_id: UUID,
        current_turn: int,
        current_context: str,
    ) -> GiftRecallContext | None:
        """Check if a gift recall should trigger and return context if so.

        Args:
            session_id: Current session ID
            user_id: User's ID
            companion_id: Companion's ID
            current_turn: Current turn number in the session
            current_context: Current conversation context (recent messages)

        Returns:
            GiftRecallContext if recall should trigger, None otherwise
        """
        session_key = str(session_id)
        pair_key = f"{user_id}:{companion_id}"

        # Check turn spacing
        last_recall_turn = self._last_recall_turn.get(session_key, 0)
        if current_turn - last_recall_turn < self.MIN_TURNS_BETWEEN_RECALLS:
            logger.debug(
                "gift_recall_skipped_turn_spacing",
                session_id=str(session_id),
                current_turn=current_turn,
                last_recall_turn=last_recall_turn,
            )
            return None

        # Calculate recall probability
        probability = self._calculate_recall_probability(pair_key)

        # Random check
        if random.random() > probability:
            logger.debug(
                "gift_recall_skipped_probability",
                session_id=str(session_id),
                probability=probability,
            )
            return None

        # Fetch eligible gift from gateway
        try:
            gift = await self._fetch_eligible_gift(
                user_id=user_id,
                companion_id=companion_id,
                current_context=current_context,
            )

            if not gift:
                logger.debug(
                    "gift_recall_skipped_no_eligible_gift",
                    session_id=str(session_id),
                    user_id=str(user_id),
                    companion_id=str(companion_id),
                )
                return None

            # Build recall context
            recall_context = GiftRecallContext(
                gift_id=gift.gift_id,
                title=gift.title,
                description=gift.description,
                emotional_meaning=gift.emotional_meaning,
                date=gift.created_at.strftime("%B %d, %Y"),
                trigger=self._determine_trigger(current_context, gift),
                suggested_mention=self._generate_suggested_mention(gift),
            )

            # Update tracking
            self._last_recall_turn[session_key] = current_turn
            self._last_recall_time[pair_key] = datetime.utcnow()

            logger.info(
                "gift_recall_triggered",
                session_id=str(session_id),
                gift_id=str(gift.gift_id),
                gift_title=gift.title,
            )

            return recall_context

        except Exception as e:
            logger.warning(
                "gift_recall_fetch_failed",
                error=str(e),
                session_id=str(session_id),
            )
            return None

    async def record_recall(
        self,
        gift_id: UUID,
        session_id: UUID,
        trigger: str,
    ) -> None:
        """Record that a gift was recalled in conversation.

        This updates the gift's metadata to track when it was last mentioned,
        which affects future recall probability.

        Args:
            gift_id: ID of the gift that was recalled
            session_id: Session where the recall occurred
            trigger: The trigger that caused the recall
        """
        try:
            await self.http_client.post(
                f"{self.settings.gateway_internal_url}/api/v1/gifts/internal/{gift_id}/recall",
                json={
                    "sessionId": str(session_id),
                    "trigger": trigger,
                    "recalledAt": datetime.utcnow().isoformat(),
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
            )

            logger.info(
                "gift_recall_recorded",
                gift_id=str(gift_id),
                session_id=str(session_id),
            )

        except Exception as e:
            logger.warning(
                "gift_recall_record_failed",
                error=str(e),
                gift_id=str(gift_id),
            )

    def _calculate_recall_probability(self, pair_key: str) -> float:
        """Calculate the probability of triggering a recall.

        Probability increases over time since the last recall to ensure
        gifts are mentioned periodically but not too frequently.
        """
        last_recall = self._last_recall_time.get(pair_key)

        if not last_recall:
            # First potential recall - use base probability
            return self.BASE_RECALL_PROBABILITY

        # Calculate days since last recall
        days_since_recall = (datetime.utcnow() - last_recall).days

        # Increase probability over time
        probability = (
            self.BASE_RECALL_PROBABILITY
            + (days_since_recall * self.PROBABILITY_INCREASE_PER_DAY)
        )

        # Cap at maximum
        return min(probability, self.MAX_RECALL_PROBABILITY)

    async def _fetch_eligible_gift(
        self,
        user_id: UUID,
        companion_id: UUID,
        current_context: str,
    ) -> GiftMemory | None:
        """Fetch an eligible gift for recall from the gateway.

        A gift is eligible if:
        - It's at least MIN_DAYS_FOR_RECALL old
        - It hasn't been recalled too recently
        - It's contextually relevant to the current conversation (optional)
        """
        try:
            # Calculate minimum age date
            min_age_date = datetime.utcnow() - timedelta(days=self.MIN_DAYS_FOR_RECALL)

            response = await self.http_client.post(
                f"{self.settings.gateway_internal_url}/api/v1/gifts/internal/eligible-for-recall",
                json={
                    "userId": str(user_id),
                    "companionId": str(companion_id),
                    "maxCreatedAt": min_age_date.isoformat(),
                    "context": current_context[:500] if current_context else "",
                    "limit": 5,
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            result = response.json()
            gifts = result.get("data", {}).get("gifts", [])

            if not gifts:
                return None

            # Convert to GiftMemory objects for scoring
            gift_memories = [
                GiftMemory(
                    gift_id=UUID(g["id"]),
                    title=g["title"],
                    description=g["description"],
                    emotional_meaning=g.get("emotionalMeaning", ""),
                    direction=g["direction"],
                    gift_type=g["giftType"],
                    created_at=datetime.fromisoformat(
                        g["createdAt"].replace("Z", "+00:00")
                    ),
                    emotional_significance=g.get("emotionalSignificance", 0.5),
                )
                for g in gifts
            ]

            # Select the most contextually relevant gift
            return self._select_most_relevant_gift(gift_memories, current_context)

        except Exception as e:
            logger.warning(
                "gift_fetch_failed",
                error=str(e),
                user_id=str(user_id),
                companion_id=str(companion_id),
            )
            return None

    def _determine_trigger(
        self,
        current_context: str,
        gift: GiftMemory,
    ) -> str:
        """Determine what triggered this gift recall.

        This helps the companion understand why they're recalling
        this gift at this moment.
        """
        context_lower = current_context.lower() if current_context else ""

        # Check for thematic triggers
        if any(word in context_lower for word in ["remember", "memory", "past"]):
            return "reminiscing_about_past"

        if any(word in context_lower for word in ["miss", "lonely", "alone"]):
            return "emotional_connection"

        if any(word in context_lower for word in ["love", "care", "feel"]):
            return "expressing_affection"

        if any(word in context_lower for word in ["gift", "gave", "present"]):
            return "gift_topic"

        # Default to spontaneous
        return "spontaneous_memory"

    def _generate_suggested_mention(self, gift: GiftMemory) -> str:
        """Generate a suggested way to mention this gift.

        This gives the companion a starting point for how to naturally
        work the gift into conversation.
        """
        direction_phrase = (
            "the gift I made for you"
            if gift.direction == "from_companion"
            else "the gift you gave me"
        )

        suggestions = [
            f"Speaking of which, I was thinking about {direction_phrase} - \"{gift.title}\"...",
            f"You know what came to mind? {direction_phrase.capitalize()} - \"{gift.title}\".",
            f"This reminds me of {direction_phrase}...",
            f"I still treasure {direction_phrase} - \"{gift.title}\".",
        ]

        return random.choice(suggestions)

    async def get_gift_memories(
        self,
        user_id: UUID,
        companion_id: UUID,
        limit: int = 5,
    ) -> list[GiftMemory]:
        """Fetch recent gift memories for context building.

        Args:
            user_id: User's ID
            companion_id: Companion's ID
            limit: Maximum number of gifts to return

        Returns:
            List of GiftMemory objects
        """
        try:
            response = await self.http_client.get(
                f"{self.settings.gateway_internal_url}/api/v1/gifts/internal",
                params={
                    "userId": str(user_id),
                    "companionId": str(companion_id),
                    "limit": limit,
                    "orderBy": "emotionalSignificance",
                    "order": "desc",
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                },
            )
            response.raise_for_status()

            result = response.json()
            gifts_data = result.get("data", {}).get("gifts", [])

            return [
                GiftMemory(
                    gift_id=UUID(g["id"]),
                    title=g["title"],
                    description=g["description"],
                    emotional_meaning=g.get("emotionalMeaning", ""),
                    direction=g["direction"],
                    gift_type=g["giftType"],
                    created_at=datetime.fromisoformat(
                        g["createdAt"].replace("Z", "+00:00")
                    ),
                    emotional_significance=g.get("emotionalSignificance", 0.5),
                )
                for g in gifts_data
            ]

        except Exception as e:
            logger.warning(
                "gift_memories_fetch_failed",
                error=str(e),
                user_id=str(user_id),
                companion_id=str(companion_id),
            )
            return []

    def _extract_keywords(self, text: str) -> set[str]:
        """Extract meaningful keywords from text.

        Filters out stop words and returns a set of lowercase keywords
        with at least 3 characters.

        Args:
            text: Text to extract keywords from.

        Returns:
            Set of lowercase keywords.
        """
        if not text:
            return set()

        # Extract words with at least 3 characters
        words = re.findall(r'\b[a-z]{3,}\b', text.lower())

        # Filter out stop words
        return {w for w in words if w not in GIFT_KEYWORD_STOP_WORDS}

    def _get_gift_keywords(self, gift: GiftMemory) -> set[str]:
        """Extract keywords from a gift's text content.

        Combines title, description, and emotional meaning for
        comprehensive keyword matching.

        Args:
            gift: The gift memory to extract keywords from.

        Returns:
            Set of keywords from the gift.
        """
        text = f"{gift.title} {gift.description} {gift.emotional_meaning}"
        return self._extract_keywords(text)

    def _score_gift_relevance(
        self,
        gift: GiftMemory,
        context_keywords: set[str],
    ) -> float:
        """Score a gift's relevance to the current context.

        Calculates relevance based on keyword overlap between the gift
        content and the current conversation context.

        Args:
            gift: The gift to score.
            context_keywords: Keywords from the current context.

        Returns:
            Relevance score between 0.0 and 1.0.
        """
        if not context_keywords:
            return 0.0

        gift_keywords = self._get_gift_keywords(gift)
        if not gift_keywords:
            return 0.0

        # Count matching keywords
        matches = gift_keywords & context_keywords
        match_count = len(matches)

        if match_count == 0:
            return 0.0

        # Calculate score: weight per match, capped at MAX_KEYWORD_BOOST
        raw_boost = match_count * self.KEYWORD_MATCH_WEIGHT
        capped_boost = min(raw_boost, self.MAX_KEYWORD_BOOST)

        # Normalize to 0-1 range relative to max boost
        relevance = capped_boost / self.CONTEXT_RELEVANCE_BOOST

        logger.debug(
            "gift_relevance_scored",
            gift_id=str(gift.gift_id),
            gift_title=gift.title,
            matching_keywords=list(matches),
            relevance_score=relevance,
        )

        return relevance

    def _select_most_relevant_gift(
        self,
        gifts: list[GiftMemory],
        current_context: str,
    ) -> GiftMemory:
        """Select the most contextually relevant gift.

        Scores all gifts based on keyword relevance and returns the
        most relevant one. Falls back to random selection if no
        clear winner.

        Args:
            gifts: List of eligible gifts.
            current_context: Current conversation context.

        Returns:
            The most relevant gift.
        """
        if len(gifts) == 1:
            return gifts[0]

        context_keywords = self._extract_keywords(current_context)

        if not context_keywords:
            # No context keywords - select randomly
            return random.choice(gifts)

        # Score all gifts
        scored_gifts = [
            (gift, self._score_gift_relevance(gift, context_keywords))
            for gift in gifts
        ]

        # Sort by relevance score descending
        scored_gifts.sort(key=lambda x: x[1], reverse=True)

        best_gift, best_score = scored_gifts[0]

        if best_score > 0:
            logger.info(
                "selected_relevant_gift",
                gift_id=str(best_gift.gift_id),
                gift_title=best_gift.title,
                relevance_score=best_score,
                alternatives_count=len(gifts) - 1,
            )
            return best_gift

        # No relevant matches - select randomly
        return random.choice(gifts)

    def clear_session_tracking(self, session_id: UUID) -> None:
        """Clear tracking data for a session.

        Call this when a session ends to clean up memory.
        """
        session_key = str(session_id)
        self._last_recall_turn.pop(session_key, None)

    async def close(self) -> None:
        """Clean up resources."""
        await self.http_client.aclose()

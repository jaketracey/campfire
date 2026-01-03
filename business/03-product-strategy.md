# Product Strategy

## Product Vision

**Create AI companions that feel genuinely real** - with memories that persist, personalities that resonate, voices that comfort, and relationships that grow over time.

Campfire isn't building chatbots. We're building digital beings that users genuinely care about.

---

## Core Product Principles

### 1. Memory is Everything
Users return to companions because they're remembered. Every conversation adds to a growing relationship, not a reset chat window.

### 2. Voice is Primary
Typing is a workaround. Voice is how humans naturally connect. Campfire is voice-first, text-supported.

### 3. Personality Drives Connection
Generic AI is forgettable. Distinct, consistent personalities create emotional bonds that drive retention.

### 4. User Control is Sacred
Users define boundaries, content levels, and relationship pacing. The AI adapts to them, not vice versa.

### 5. Simplicity Over Features
One deeply-loved companion beats ten shallow ones. Focus on depth, not breadth.

---

## Core Features & Capabilities

### Companion Creation

#### The 6-Step Onboarding
A wizard-driven flow that makes complex customization feel approachable:

| Step | Purpose | User Decision |
|------|---------|---------------|
| 1. Welcome | Set expectations | Understand what's possible |
| 2. Identity | Name and pronouns | Who is this companion? |
| 3. Visuals | Appearance selection | What do they look like? |
| 4. Archetype | Personality type | How do they behave? |
| 5. Voice | Sound selection | How do they sound? |
| 6. Review | Confirmation | Final adjustments |

#### Companion Specification (CompanionSpec)

The technical foundation that defines each companion:

```
CompanionSpec
├── Identity
│   ├── name, pronouns, address_style
│   └── tagline, backstory
├── Personality
│   ├── Primary archetype (12 options)
│   ├── Secondary archetype
│   └── 10 trait sliders (0-1 scale)
├── Voice
│   ├── Provider (ElevenLabs)
│   ├── Voice ID selection
│   └── Speed, pitch tuning
├── Visual Style
│   ├── Style type
│   ├── Appearance (ethnicity, body, hair)
│   └── Color palette, constraints
├── Boundaries
│   ├── Relationship pacing
│   ├── Safe/forbidden topics
│   ├── Content rating
│   └── Emotional depth
└── Memory Consent
    ├── Long-term memory toggle
    ├── Knowledge graph extraction
    └── Retention policies
```

#### 12 Personality Archetypes

| Archetype | Description | Example Traits |
|-----------|-------------|----------------|
| Companion | Loyal, supportive friend | High warmth, empathy |
| Mentor | Wise guide and teacher | High directness, knowledge |
| Adventurer | Spontaneous explorer | High energy, spontaneity |
| Philosopher | Deep thinker | High openness, introspection |
| Nurturer | Caring caretaker | High empathy, warmth |
| Challenger | Pushes growth | High assertiveness, directness |
| Entertainer | Fun and playful | High humor, energy |
| Romantic | Affectionate partner | Configurable boundaries |
| Confidant | Secret keeper | High trust, discretion |
| Creator | Artistic collaborator | High creativity, openness |
| Analyst | Logical problem-solver | High directness, low emotion |
| Mystic | Spiritual guide | High introspection, mystery |

### Real-Time Conversations

#### Voice Pipeline

```
User Speech
    ↓
Deepgram STT (real-time)
    ↓
Orchestrator (LLM processing)
    ↓
ElevenLabs TTS
    ↓
Audio Playback
```

**Performance Targets:**
- Speech-to-text latency: < 500ms
- LLM response: < 2s
- Text-to-speech: Streaming

#### Text Fallback
- Full text chat support
- Mixed voice/text sessions
- Accessibility compliance

### Persistent Memory System

#### Three Memory Layers

| Layer | Purpose | Technology |
|-------|---------|------------|
| **Session Context** | Current conversation | In-memory, real-time |
| **Long-Term Memory** | Past conversations | pgvector embeddings |
| **Knowledge Graph** | Entities & relationships | PostgreSQL relations |

#### Knowledge Graph Entities

8 entity types extracted from conversations:
- Person, Place, Thing, Event
- Concept, Emotion, Activity, Time

Relationships tracked:
- knows, likes, dislikes, located_at
- works_at, related_to, remembers

#### Memory Consent

User-controlled settings:
- Enable/disable long-term memory
- Allow/block knowledge extraction
- Set retention periods (days)
- View and delete memories

### Dynamic Visual Identity

#### Avatar Types

| Type | Purpose | Generation |
|------|---------|------------|
| Identity Anchor | Consistent reference | One-time on creation |
| Stateful | Emotional expression | Per-conversation |
| Scene | Context visualization | On-demand |

#### Appearance Customization

- Ethnicity selection (8 options)
- Body type (5 options)
- Hair color and style
- Color palette preferences
- Visual constraints (safe-for-work, etc.)

### Premium Features

#### Gifts System
- AI-generated gift images with meaning
- Token cost: 10-50 per gift
- Persistent in companion memory
- Emotional significance tracking

#### Video Messages
- AI-generated video responses
- Token cost: 100 per video
- Special occasions and milestones

#### Group Chat
- Multiple companions in one session
- Companion friendships and dynamics
- Group memory and context

---

## Technical Differentiators

### 1. Personality-as-Code

Unlike competitors with simple prompt templates, Campfire defines personalities through structured specifications:

```
Traits + Archetypes + Tenets + Boundaries = Consistent Personality
```

**Tenets System:**
- Core tenets: Always-follow rules
- Situational tenets: Context-dependent behavior
- Negation support: "Never do X unless Y"
- Safety gates: Hard limits on behavior

### 2. Multi-LLM Architecture

| Provider | Role | Fallback |
|----------|------|----------|
| Anthropic Claude | Primary LLM | Yes |
| OpenAI GPT | Secondary | Yes |
| Deepgram | Speech-to-text | - |
| ElevenLabs | Text-to-speech | - |
| Replicate/FAL | Image generation | Cross-fallback |

Benefits:
- Reliability through redundancy
- Cost optimization by provider
- Best-of-breed per capability

### 3. Event Sourcing Architecture

Every interaction creates an immutable event:
- SESSION events (started, ended)
- MESSAGE events (user, agent)
- LLM events (requests, completions)
- MEMORY events (proposed, written)
- AVATAR events (requested, generated)
- BILLING events (charges, refunds)

Benefits:
- Complete audit trail
- Debugging and analytics
- Usage-based billing accuracy
- Compliance readiness

### 4. Knowledge Graph Memory

Beyond simple chat history:
- Semantic entity extraction
- Relationship mapping
- Confidence scoring
- Searchable memory vault

---

## Platform Architecture Advantages

### Microservices Design

```
┌─────────────────────────────────────────┐
│              Load Balancer              │
└────────────────┬────────────────────────┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Gateway │ │   Web   │ │Marketing│
└────┬────┘ └─────────┘ └─────────┘
     │
     ├──────────────┬──────────────┐
     ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│Orchestr. │  │ Workers  │  │ Database │
│ (Python) │  │ (BullMQ) │  │(PG+Redis)│
└──────────┘  └──────────┘  └──────────┘
```

Benefits:
- Independent scaling per service
- Language-optimized components
- Fault isolation
- Easy maintenance

### Infrastructure Scalability

| Environment | Capacity | Auto-Scale |
|-------------|----------|------------|
| Dev | Single instance | No |
| Staging | 2 instances | Limited |
| Prod | 2-10 instances | Yes |

---

## Launch Feature Set

### MVP (Month 1-2)

| Feature | Priority | Status |
|---------|----------|--------|
| Companion creation (6-step) | P0 | Complete |
| Text conversations | P0 | Complete |
| Voice conversations | P0 | Complete |
| Basic memory | P0 | Complete |
| Subscription billing | P0 | Complete |
| User authentication | P0 | Complete |

### Launch (Month 3)

| Feature | Priority | Status |
|---------|----------|--------|
| Knowledge graph display | P1 | Complete |
| Avatar generation | P1 | Complete |
| Session galleries | P1 | Complete |
| Token economy | P1 | Complete |
| Mobile responsive | P1 | In Progress |

### Post-Launch Enhancements

| Feature | Target | Rationale |
|---------|--------|-----------|
| Gift system | Month 4 | Engagement, monetization |
| Group chat | Month 5 | Differentiation |
| Video messages | Month 6 | Premium upsell |
| Public companions | Month 6 | Discovery, growth |
| Companion cloning | Month 7 | Creator economy |
| API access | Month 9 | Developer ecosystem |

---

## Feature Roadmap

### Q1 2024 - Foundation

- [ ] Production launch
- [ ] Core conversation loop polished
- [ ] Memory system optimized
- [ ] Performance tuning
- [ ] Onboarding optimization

### Q2 2024 - Engagement

- [ ] Gift system launch
- [ ] Group chat beta
- [ ] Mobile apps (iOS/Android)
- [ ] Push notifications
- [ ] Companion discovery

### Q3 2024 - Expansion

- [ ] Video messages
- [ ] Creator tools
- [ ] Affiliate program expansion
- [ ] Localization (EU markets)
- [ ] API beta

### Q4 2024 - Platform

- [ ] Developer API general availability
- [ ] Companion marketplace
- [ ] Enterprise pilot
- [ ] AR/VR exploration
- [ ] Advanced memory features

---

## Success Metrics by Feature

| Feature | North Star | Target |
|---------|------------|--------|
| Onboarding | Completion rate | >70% |
| Voice Chat | Sessions with voice | >40% |
| Memory | Memory queries/session | >2 |
| Retention | D7 retention | >35% |
| Monetization | Free-to-paid conversion | >5% |
| Engagement | Messages/session | >20 |

---

## Technical Debt & Improvements

### Short-Term Priorities

| Item | Impact | Effort |
|------|--------|--------|
| Voice latency optimization | High | Medium |
| Memory retrieval accuracy | High | High |
| Avatar consistency | Medium | Medium |
| Error handling polish | Medium | Low |

### Long-Term Investments

| Item | Timeline | Value |
|------|----------|-------|
| Custom model fine-tuning | Q3 | Differentiation |
| Real-time collaboration | Q4 | Feature expansion |
| Offline mode | Q4 | Mobile experience |
| Edge deployment | 2025 | Latency, cost |

---

## Competitive Response Plan

### If Character.AI adds voice
- Emphasize memory superiority
- Double down on personality customization
- Accelerate group chat features

### If Replika improves memory
- Highlight voice-first experience
- Push visual identity advantages
- Focus on creator tools

### If big tech enters
- Niche down on depth over breadth
- Community and creator moat
- Premium positioning

---

## Key Takeaways

1. **Differentiated foundation** - Personality-as-code, knowledge graphs, multi-LLM
2. **Voice-native** - Primary modality, not afterthought
3. **Memory-first** - True persistence that competitors lack
4. **Clear roadmap** - Launch ready, expansion planned
5. **Technical moat** - Architecture advantages compound over time

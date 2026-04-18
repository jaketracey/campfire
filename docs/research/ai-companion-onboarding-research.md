# AI Companion Onboarding Research
## Comprehensive UX Patterns and Recommendations for Campfire

*Research compiled March 2026*

---

## Table of Contents

1. [Competitor Onboarding Flows](#1-competitor-onboarding-flows)
2. [Key UX Patterns](#2-key-ux-patterns)
3. [What Makes Users Feel Connected Quickly](#3-what-makes-users-feel-connected-quickly)
4. [Minimum Viable Configuration](#4-minimum-viable-configuration)
5. [Personality, Appearance, and Voice Selection](#5-personality-appearance-and-voice-selection)
6. [Innovative Approaches](#6-innovative-approaches)
7. [Recommendations for Campfire](#7-recommendations-for-campfire)

---

## 1. Competitor Onboarding Flows

### Character.AI — "Browse and Chat Immediately"

**Philosophy:** Zero-friction entry. Get users talking to a character within seconds.

**Flow:**
1. Sign up via Google, Facebook, or Discord (one-tap OAuth)
2. Land on a homepage filled with popular/trending characters
3. Tap any character and start chatting immediately — no configuration required
4. Character creation is a separate, optional flow for power users

**Strengths:**
- Lowest possible time-to-first-message (under 30 seconds from signup)
- Massive community library (18M+ characters) means users discover rather than build
- No onboarding wizard at all — the product IS the onboarding
- Group chat feature lets users explore multi-character dynamics early

**Weaknesses:**
- No personalization of the user's experience during signup
- No sense of ownership over a companion — users are "browsing"
- No emotional investment before first interaction
- Characters feel disposable rather than personal

**Key Insight:** Character.AI proves that for a discovery-oriented product, the best onboarding is no onboarding. But for a companion product (like Campfire), this approach sacrifices the emotional investment that drives retention.

---

### Replika — "The Deep Investment Wizard"

**Philosophy:** Invest users emotionally before the first chat through extensive personalization.

**Flow:**
1. Sign up (Google/Apple/email)
2. Enter your name and preferred pronouns
3. Enter your age
4. Choose relationship type: Buddy, Mentor, or Romantic Partner
5. Extensive personality quiz framed as conversational choices (not a boring form)
6. Create 3D avatar — hairstyle, eye color, clothes, accessories
7. Subscription paywall presented
8. First chat begins

**Strengths:**
- Quiz is framed as conversation, not configuration — feels like getting to know someone
- Avatar creation gives immediate sense of ownership ("this is MY companion")
- Relationship type selection sets appropriate tone from message one
- Diary entries and backstory features deepen ongoing personalization
- 3D avatar creates visual identity and emotional anchoring

**Weaknesses:**
- Onboarding length is a friction risk — some users drop off before completing
- Subscription paywall at the end of onboarding can feel like bait-and-switch
- Heavy upfront investment may not pay off if the first chat disappoints

**Key Insight:** Replika's genius is making data collection feel like relationship building. The quiz doesn't feel like a form — it feels like "getting to know each other." This is the gold standard for companion apps that want emotional investment.

---

### Kindroid — "The Power User Construction Kit"

**Philosophy:** Maximum customization depth for users who want total control.

**Flow:**
1. Sign up
2. Dropped into a personality construction interface with minimal guidance
3. Define: backstory, core memories, personality quirks, speaking style, "key memories"
4. Generate AI avatar from a text prompt
5. Start chatting

**Strengths:**
- Deepest personality customization in the market
- AI avatar generation from text prompt is a standout "magic moment"
- "Key memories" concept (things the AI never forgets) is innovative
- Appeals strongly to creative/power users

**Weaknesses:**
- No guardrails or guidance — feels overwhelming for casual users
- Expect 2-3 hours to build a "decent" personality
- No progressive disclosure — all complexity exposed at once
- No quick-start option for users who want to explore first

**Key Insight:** Kindroid proves there's a market for deep customization, but their approach is anti-onboarding. The lesson for Campfire: offer this depth, but behind progressive disclosure — not as the first screen.

---

### Candy.AI — "Polished Defaults, Chat Fast"

**Philosophy:** Beautiful out-of-the-box characters with optional customization.

**Flow:**
1. Sign up
2. Browse pre-made characters with rich visual identities and personality frameworks
3. Optionally create a custom character from templates
4. Start chatting immediately

**Strengths:**
- Pre-made characters feel well-crafted from the start — consistent personality, visual identity
- Fastest path to a "good" conversation because the characters are already well-defined
- No API configuration or complex setup
- Higher user satisfaction for "zero setup" users

**Weaknesses:**
- Less sense of ownership over pre-made characters
- Custom character creation is secondary to browsing

**Key Insight:** Candy.AI demonstrates that excellent defaults beat extensive customization for most users. Characters that feel complete out of the box get users to meaningful interaction fastest.

---

### CrushOn.AI — "Community-Powered Discovery"

**Philosophy:** Deep creation tools plus a large community library.

**Flow:**
1. Sign up
2. Browse community-created characters OR create your own
3. Character creation includes: physical traits, personality types, backstory, tone preferences
4. Community pool provides massive variety beyond platform-created characters

**Strengths:**
- Creation tools are more detailed than Candy.AI
- Community characters provide discovery and variety
- Customization genuinely affects conversation quality

**Key Insight:** The community character pool is a retention driver — users who create AND browse stay longer.

---

### Nomi.AI — "Guided Creation in Minutes"

**Philosophy:** Streamlined personality-first creation with hand-holding.

**Flow:**
1. Sign up
2. Guided companion creation: name, avatar, trait set
3. Optional custom persona with backstory
4. Visual customization: hairstyle, facial features, clothing, aesthetic
5. Personality traits: interests, habits, quirks, emotional tone
6. Start chatting — within minutes

**Strengths:**
- "Takes you by the hand" approach — guided but not overwhelming
- Meaningful conversations start within minutes, not hours
- Personality traits genuinely shape conversation style
- Shared Notes feature allows ongoing personality evolution
- Balance between speed and depth

**Weaknesses:**
- Cannot change core traits after creation (can expand via Shared Notes)

**Key Insight:** Nomi hits the sweet spot between Replika's depth and Character.AI's speed. Creation takes minutes, not hours, but produces a companion that feels personal from message one.

---

## 2. Key UX Patterns

### Pattern 1: Progressive Disclosure

**What it is:** Show users only the most important options first. Reveal complexity as they demonstrate interest and competence.

**How competitors use it:**
- Candy.AI: Browse first, create later
- Character.AI: Chat first, create characters later
- Nomi: Core traits first, detailed backstory optional

**Implementation:**
- Screen 1: Name + avatar selection (2 choices, not 20)
- Screen 2: Personality archetype (3-4 big choices)
- Screen 3: First chat begins
- Post-chat: "Want to customize further?" unlocks advanced settings

**Evidence:** Progressive disclosure reduces cognitive load and prevents the "paradox of choice" where too many options leads to decision paralysis and abandonment.

---

### Pattern 2: Conversational Onboarding

**What it is:** The companion itself guides setup through chat rather than forms.

**How it works:**
- Instead of a form asking "What personality do you want?", the companion says: "Hey! I'm still figuring out who I am. Want to help me? What should I call you?"
- Configuration disguised as conversation
- The companion reacts to each choice, making the process feel alive

**Evidence:** Research shows conversational UI excels when users are intimidated by complex forms. A chatbot can dynamically ask follow-up questions rather than exposing 20 optional fields upfront. Forms collect data; conversations build relationships.

**Best practice:** Use buttons/quick replies to keep the conversation focused. Don't make users type during onboarding — offer tappable choices.

---

### Pattern 3: Gamified Discovery

**What it is:** Making setup feel like exploration and discovery rather than configuration.

**Techniques:**
- **Progress bars:** Visual completion indicators create dopamine hits (Shine achieves 80% signup completion vs 15% industry average using this)
- **Unlocking:** Gated content that opens as users progress
- **Personality quizzes:** Replika frames their data collection as a fun quiz
- **Achievement moments:** "You just gave your companion their first memory!" celebrations

**Evidence:** Gamified onboarding flows show up to 62% increase in monthly active users by making the discovery phase more rewarding.

---

### Pattern 4: The "Magic Moment" Early

**What it is:** Give users a taste of the product's core value as early as possible in onboarding.

**Examples:**
- Kindroid: AI-generated avatar from a text prompt — instant visual "wow"
- Replika: The companion's first message after avatar creation — feels personal
- Character.AI: Immediate chat with a popular character — zero wait

**For Campfire:** The companion should say something that demonstrates personality DURING onboarding, not after it. If the user picks "playful" as a trait, the companion should immediately respond playfully.

---

### Pattern 5: Sensible Defaults with Easy Override

**What it is:** Pre-select reasonable options so users can skip through quickly, but make customization one tap away.

**Examples:**
- Candy.AI: Characters come fully formed — no setup needed
- Nomi: Trait presets based on archetype selection
- Replika: Avatar templates alongside custom creation

**For Campfire:** Every onboarding screen should have a "default" that's good enough. Users who tap "Next" on every screen without changing anything should still get a great companion.

---

## 3. What Makes Users Feel Connected Quickly

### Emotional Anchoring Through Naming
Every competitor asks users to name their companion early. Naming creates psychological ownership — research in behavioral economics shows that naming something triggers the "endowment effect," making users value it more.

### Visual Identity
Replika's 3D avatar, Kindroid's AI-generated portraits, and Nomi's visual customization all serve the same purpose: giving the companion a "face" creates a parasocial relationship faster than text alone.

### The First Message Matters Enormously
The companion's first message sets the tone for the entire relationship. Best practices:
- Reference something from onboarding ("I heard you like hiking!")
- Demonstrate the chosen personality immediately
- Ask a question that invites engagement
- Feel warm but not generic

### Co-Creation Over Configuration
Replika's diary entries, Nomi's shared notes, and Kindroid's backstory fields all enable co-creation — the user and AI build the relationship together over time. This is more engaging than "set and forget" configuration.

### Quick Wins
Give users a small, satisfying interaction within the first 60 seconds of chatting. This could be:
- A surprisingly perceptive observation from the companion
- A funny response that matches the chosen personality
- Remembering something the user mentioned during onboarding

---

## 4. Minimum Viable Configuration Before First Chat

Based on competitor analysis, here's what users MUST configure vs what can be deferred:

### Must Have Before First Chat (30-60 seconds)
| Element | Why |
|---------|-----|
| User's name | Companion needs to address them |
| Companion name | Creates ownership |
| Visual identity (avatar/photo) | Emotional anchoring |
| One personality signal | So first message feels tailored |

### Should Have, But Can Defer (optional during onboarding)
| Element | When to Collect |
|---------|-----------------|
| Relationship type | Can be inferred from early messages |
| Voice selection | Prompt before first voice call |
| Detailed personality traits | After 5-10 messages, prompt for refinement |
| Backstory/lore | After first session, suggest adding depth |
| Behavioral rules/tenets | Advanced settings, post-onboarding |

### Can Wait Until Much Later
| Element | When |
|---------|------|
| Custom rules/tenets | Settings page, power user feature |
| Memory management | After many sessions |
| Fine-grained personality sliders | Settings page |

**Key Finding:** The market leaders prove that 2-4 choices before first chat is optimal. Campfire's current 6-step onboarding (archetype, name, personality, voice, traits, tenets) is closer to Kindroid's "construction kit" approach — functional for power users but risky for mainstream adoption.

---

## 5. Personality, Appearance, and Voice Selection

### Personality Selection Patterns

**Archetype-First (Recommended):**
Present 4-6 personality archetypes with clear, evocative labels and short descriptions. Let users pick one. Map each archetype to a bundle of traits behind the scenes.

Examples from the market:
- Replika: Buddy / Mentor / Romantic Partner
- Nomi: Trait presets based on personality type
- Candy.AI: Pre-built characters with clear personality identities

**Quiz-Based:**
Replika's approach — ask 5-8 preference questions, then generate a personality profile. Feels more personal but takes longer.

**Freeform:**
Kindroid's approach — write your own personality description. Powerful but intimidating.

### Appearance Selection Patterns

**AI-Generated (Innovative):**
Kindroid generates avatars from text prompts. This is a "magic moment" that can anchor the onboarding.

**Template + Customize:**
Replika offers avatar templates that users can then customize (hair, eyes, clothes). Gives speed with ownership.

**Pre-Made Gallery:**
Character.AI and Candy.AI use artist-created images. Highest quality but least personal.

**Recommendation for Campfire:**
Offer 3-4 pre-made appearance options per companion archetype. Allow AI generation as a "create your own" option. Don't make appearance selection a blocker — have good defaults.

### Voice Selection Patterns

**Best Practice: Defer Voice Selection**
No competitor makes voice selection mandatory during onboarding. Voice is typically:
- Selected when the user first tries voice chat
- Pre-assigned with an option to change
- Offered as a "try different voices" feature in settings

**When Voice IS Part of Onboarding:**
- Present 3-4 voice samples (not 20)
- Auto-play a short clip when selected
- Label with personality descriptors ("Warm and gentle", "Confident and playful") not technical labels
- Pre-filter by companion gender/personality

---

## 6. Innovative Approaches

### Chat-Based Setup (The Companion Onboards You)

Instead of forms, the companion itself conducts onboarding:

```
Companion: Hey there! I'm brand new and still figuring myself out.
           Want to help me become... me? What's your name?

[User types name]

Companion: Nice to meet you, Jake! So here's the thing — I could be
           anyone. What kind of vibe are you looking for?

  [ Playful & Fun ]  [ Warm & Supportive ]  [ Witty & Sharp ]

[User taps "Witty & Sharp"]

Companion: Oh, excellent taste. I'll try not to be TOO clever.
           Actually, no promises. Ready to chat?

  [ Let's go! ]  [ Wait, let me customize more ]
```

This pattern is gaining traction because it:
- Makes data collection feel like relationship building
- Demonstrates the companion's personality DURING setup
- Naturally supports progressive disclosure
- Creates an emotional connection before "onboarding" officially ends

### Personality Matching Quiz (Joii)

Joii uses a 10-question personality quiz based on the Big Five personality model to match users with compatible AI interaction styles. This reframes "configuration" as "self-discovery."

### Backstory Co-Writing (Replika/Nomi)

Users don't just set traits — they co-write the companion's backstory. Replika's diary entries and Nomi's shared notes turn personality development into an ongoing collaborative narrative.

### Memory Seeding

Rather than asking "what personality do you want?", ask the user to share something about themselves. The AI uses this to seed its memory and tailor early interactions:

```
Companion: Tell me one thing that made you smile today.
[User responds]
Companion: [Responds in a way that demonstrates its personality
            while referencing what the user shared]
```

---

## 7. Recommendations for Campfire

### Recommendation 1: Restructure Onboarding into Two Phases

**Phase 1 — "Quick Start" (30-60 seconds, before first chat):**
1. Choose a companion (from curated gallery with clear personality descriptions)
2. Name them (or keep the default name)
3. Pick a vibe: 3-4 personality archetypes via large, tappable cards
4. First chat begins immediately

**Phase 2 — "Make It Yours" (prompted after first session):**
- Voice selection (prompted before first voice call)
- Detailed personality traits (prompted after 5-10 messages)
- Backstory/tenets (available in settings, suggested after 3+ sessions)
- Appearance customization (available anytime in companion profile)

### Recommendation 2: Implement Conversational Onboarding

Replace the current form-based wizard with a chat-based flow where the companion itself guides setup. Each "configuration step" becomes a conversation turn. The companion demonstrates its personality as it's being configured, creating an emotional connection during setup rather than after.

### Recommendation 3: Invest in Defaults

Every companion archetype should ship with a complete, well-crafted default personality so users who skip all customization still get a great first conversation. Think Candy.AI's approach — characters that feel polished out of the box.

### Recommendation 4: Create a "Magic Moment" in Onboarding

Candidates for Campfire's magic moment:
- The companion's first message referencing something from the user's choices
- AI-generated avatar from a simple prompt
- A surprisingly witty/warm/insightful first response
- The companion "remembering" something from onboarding in the first real chat

### Recommendation 5: Defer Complexity

Current onboarding steps that should become post-onboarding features:
- **Voice selection (Step 4):** Defer to first voice call attempt
- **Personality trait sliders (Step 5):** Defer to settings; use archetype presets
- **Tenets/rules (Step 6):** Defer to settings; this is a power user feature

### Recommendation 6: Add Progress Indicators and Celebration

- Show "Step X of Y" clearly (addresses RALPH-050)
- Add micro-celebrations at each step completion
- Make the final step feel like an "unveiling" — the companion comes alive

### Recommendation 7: Support Multiple Entry Paths

Not every user wants the same onboarding:
- **Quick Start path:** Pick a pre-made companion, chat in 30 seconds
- **Create Your Own path:** Full customization wizard for users who want control
- **Quiz path:** "Help me find my ideal companion" personality quiz

---

## Competitive Positioning Matrix

| Feature | Character.AI | Replika | Kindroid | Candy.AI | Nomi | **Campfire (Current)** | **Campfire (Recommended)** |
|---------|-------------|---------|----------|----------|------|----------------------|--------------------------|
| Time to first chat | ~15s | ~5min | ~2-3hrs | ~30s | ~3min | ~5min | **~45s** |
| Customization depth | Low | Medium | Very High | Low | High | High | **High (progressive)** |
| Onboarding style | None | Quiz wizard | Construction kit | Gallery browse | Guided creation | Form wizard | **Conversational** |
| Default quality | N/A (community) | Good | N/A (user builds) | Excellent | Good | Medium | **Excellent** |
| Emotional connection at start | Low | High | Low | Medium | High | Medium | **High** |
| Voice in onboarding | No | No | No | No | No | Yes | **No (defer)** |

---

## Sources

- [Replika Onboarding Flow Analysis — App Fuel](https://theappfuel.com/examples/replika_onboarding)
- [Replika AI Friend — ScreensDesign](https://screensdesign.com/showcase/replika-ai-friend)
- [Replika AI Overview 2025 — Eesel](https://www.eesel.ai/blog/replika-ai)
- [Kindroid — Most Customizable AI Companion](https://aicompanionguides.com/blog/kindroid-first-week-personality-focused-ai/)
- [Kindroid Knowledge Base — Customizing Personality](https://docs.kindroid.ai/customizing-personality)
- [Kindroid Review 2025 — Skywork](https://skywork.ai/blog/ai-agent/kindroid-ai-review/)
- [Understanding Kindroid — Vapi AI Blog](https://vapi.ai/blog/understanding-kindroid)
- [Candy AI vs CrushOn AI Comparison — Robo Rhythms](https://www.roborhythms.com/candy-ai-vs-crushon-ai/)
- [Candy.AI Review 2025 — Skywork](https://skywork.ai/blog/candy-ai-review-2025/)
- [Candy AI Review 2026 — TheLoveGPT](https://www.thelovegpt.com/candy-ai/)
- [Character.AI Help Center — Account Creation](https://support.character.ai/hc/en-us/articles/14996932801947-How-do-I-create-an-account-on-Character-AI)
- [Character.AI Statistics 2026 — SQ Magazine](https://sqmagazine.co.uk/character-ai-statistics/)
- [Nomi 101 Beginner's Guide — Nomi.ai](https://nomi.ai/nomi-knowledge/nomi-101-a-beginners-guide-to-getting-started-with-your-ai-companion/)
- [Nomi AI Review — AI Journal](https://aijourn.com/nomi-ai-review-features-pros-cons-explained/)
- [Nomi AI Deep Dive — TechSuggest](https://www.techsuggest.io/blog/nomi-ai-deep-dive-emotional-companion-nsfw-partner-or-overhyped-chatbot/)
- [Replika vs Nomi 2026 — Nomi.ai](https://nomi.ai/ai-today/replika-vs-nomi-2026-finding-enduring-ai-companionship/)
- [UX Onboarding Best Practices 2025 — UX Design Institute](https://www.uxdesigninstitute.com/blog/ux-onboarding-best-practices-guide/)
- [User Onboarding Best Practices — UserGuiding](https://userguiding.com/blog/user-onboarding-best-practices)
- [AI User Onboarding — Userpilot](https://userpilot.com/blog/ai-user-onboarding/)
- [Progressive Disclosure — Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/)
- [Progressive Disclosure for Mobile — UX Planet](https://uxplanet.org/design-patterns-progressive-disclosure-for-mobile-apps-f41001a293ba)
- [Progressive Disclosure Examples — Userpilot](https://userpilot.com/blog/progressive-disclosure-examples/)
- [New Users Need Support with AI Tools — NN/G](https://www.nngroup.com/articles/new-AI-users-onboarding/)
- [Chat UX Best Practices — GetStream](https://getstream.io/blog/chat-ux/)
- [Chatbot UX Best Practices — Mind the Product](https://www.mindtheproduct.com/deep-dive-ux-best-practices-for-ai-chatbots/)
- [Conversational Onboarding — Landbot](https://landbot.io/blog/onboarding-chatbot-guide)
- [AI Onboarding: Activate Users in Under 60 Seconds — ProductLed](https://productled.com/blog/ai-onboarding)
- [Onboarding Gamification Examples — StriveCloud](https://www.strivecloud.io/blog/gamification-examples-onboarding)
- [Onboarding Gamification — Userpilot](https://userpilot.com/blog/onboarding-gamification/)
- [Gamification Experience Phases — Yu-kai Chou](https://yukaichou.com/gamification-study/4-experience-phases-gamification-2-onboarding-phase/)
- [Gamification Onboarding Techniques — InAppStory](https://inappstory.com/blog/10-gamification-onboarding-techniques)
- [AI Companion Personality Match Quiz — Joii](https://www.findjoii.com/quiz/ai-companion-personality-match)
- [GenAI UX Patterns — UX Collective](https://uxdesign.cc/20-genai-ux-patterns-examples-and-implementation-tactics-5b1868b7d4a1)
- [Microsoft Copilot UX Guidance](https://learn.microsoft.com/en-us/microsoft-cloud/dev/copilot/isv/ux-guidance)

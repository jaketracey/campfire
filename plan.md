# Agents.md — **Project Campfire** 🔥 (Dev Codename)
**Voice-first, multimodal AI companion platform — event-sourced, test-driven, replayable, and projection-friendly.**

This document defines **what we’re building** and the **engineering guardrails** required for agent-assisted, end-to-end implementation.

We’re building a **voice-first AI companion platform** with:
- Real-time voice conversations (and text chat)
- Multimodal inputs/outputs (images in, image generation out)
- User-designed companions via onboarding UI
- **100% event-sourced** architecture: *everything important is an event*
- An Obsidian-style “vault” projection for every conversation
- A user knowledge graph (KG) built from the agent’s perspective with full provenance
- A strict “tests-first” culture to support safe iteration and future guardrails automation

We are **not committing to a realtime DB layer** (e.g., SpacetimeDB) right now; we can add a realtime/state layer later if needed. The system must be designed so that layer can be introduced without re-architecting core logic.

---

## 0) Tech Stack (Pinned Versions + “Latest Best” Guidance)
> Pin exact versions in code; upgrade intentionally via “platform upgrade” PRs with full regression/E2E coverage.

**Frontend**
- **Next.js 16.1.1 (latest stable)**  [oai_citation:0‡npm](https://www.npmjs.com/package/next?utm_source=chatgpt.com)
- TypeScript, TailwindCSS

**Backend**
- Node.js **v24.12.0 (Latest LTS)**  [oai_citation:1‡Node.js](https://nodejs.org/en/about/previous-releases?utm_source=chatgpt.com)
- Python **3.14.2 (latest stable)**  [oai_citation:2‡Python.org](https://www.python.org/downloads/?utm_source=chatgpt.com)

**Database**
- PostgreSQL **18.1 (latest minor in supported branches)**  [oai_citation:3‡PostgreSQL](https://www.postgresql.org/docs/release/?utm_source=chatgpt.com)
- pgvector extension for embeddings (MVP)

**Storage**
- Amazon S3 (audio, images, generated vault files)
- Optional CloudFront in front of S3 for delivery + caching

**Infra & Ops**
- AWS CLI-driven provisioning for MVP; codify later with Terraform/CDK once stable
- Containers in ECS Fargate (recommended) or EC2 (acceptable early)
- ECR for container registry
- ALB for HTTP(S) routing
- CloudWatch logs/metrics + OpenTelemetry tracing

---

## 1) Product Summary

### 1.1 Core User Experience
- Users onboard by **designing a companion** (personality, voice, visuals, boundaries).
- The companion supports:
  - **Voice-first** interactions (push-to-talk MVP; full duplex later).
  - Text chat fallback.
  - Multimodal: users can send images; the companion can interpret and respond.
  - **Image generation**: companion can generate images (reactions/scenes) and maintain a consistent character look.
- Users can optionally join **rooms** with other people (phase later). The architecture must support multi-participant sessions without redesign.

### 1.2 Data + Memory Experience
- Every conversation is stored as:
  - an immutable **event stream** (canonical truth)
  - projections:
    - human-readable transcripts
    - session summaries
    - “Obsidian vault” Markdown notes + links
    - vector memories
    - a structured knowledge graph of the user, with provenance back to events

### 1.3 Guiding Principles
- **Event-sourcing** is the backbone.
- **Provenance everywhere**: any derived memory or KG edge must point to source events.
- **User control** over memory: view/edit/delete/export, and deletion must re-project downstream artifacts.
- **Safety + policy** is a first-class system, not prompt-only.

---

## 2) AWS Architecture (MVP → Scalable)

### 2.1 Services (Recommended Default)
**Compute**
- ECS Fargate services:
  - `campfire-gateway` (WS + HTTP APIs)
  - `campfire-orchestrator` (Python agent runner; scales separately)
  - `campfire-workers` (projection workers; queue-driven)

**Data**
- Postgres 18.1:
  - MVP: RDS PostgreSQL (recommended) or self-hosted on EC2 if needed
- Redis (optional but recommended) for:
  - rate limiting
  - queues
  - transient session caches

**Storage**
- S3 buckets:
  - `campfire-media-{env}` (audio uploads, generated images)
  - `campfire-vault-{env}` (Markdown vault artifacts)
- CloudFront distribution (optional) for fast delivery

**Networking**
- VPC with public + private subnets
- ALB in public subnet → ECS in private subnets
- Security groups: least privilege

**Secrets**
- AWS Secrets Manager (API keys, DB creds, provider keys)

**Observability**
- CloudWatch Logs (structured JSON logs)
- OpenTelemetry tracing export (collector sidecar or gateway)

---

## 3) AWS CLI Provisioning Guidelines (MVP)
We use AWS CLI to bootstrap environments quickly, but must keep it reproducible.

### 3.1 Rule: “CLI commands must be captured”
- Every CLI command used to create/modify infra must be captured in:
  - `/infra/aws-cli/{env}/README.md`
  - plus scripts in `/infra/aws-cli/{env}/scripts/*.sh`
- No one-off console clicks for MVP infra.

### 3.2 Minimum AWS Resources to Bootstrap
1) Create S3 buckets (media + vault)
2) Create ECR repos
3) Create VPC + subnets + security groups (or use a standard VPC module later)
4) Deploy ECS cluster + task definitions + services
5) Provision Postgres (RDS recommended)
6) Configure ALB + target groups
7) Configure IAM roles for tasks
8) Configure CloudWatch log groups

### 3.3 Container Build + Deploy Flow
- Build images locally/CI → push to ECR → update ECS service
- All releases must:
  - run migrations (if any)
  - run smoke tests
  - emit deploy events (see §5)

> Migration rule: schema migrations must be forward-only and accompanied by rollback strategy (feature flags or compensating migrations).

---

## 4) The Non-Negotiables (Guardrails)

### 4.1 Everything Must Emit Events
If it changes state, costs money, affects user experience, or writes memory: **it must emit an event**.

Examples:
- `session.started`, `session.ended`
- `audio.chunk.received`, `stt.partial`, `stt.final`
- `user.message.created`
- `llm.requested`, `llm.token`, `llm.final`, `llm.failed`
- `tool.called`, `tool.succeeded`, `tool.failed`
- `memory.proposed`, `memory.written`, `memory.deleted`
- `kg.edge.proposed`, `kg.edge.added`, `kg.edge.removed`
- `avatar.requested`, `avatar.generated`, `avatar.promoted`, `avatar.blocked`
- `imagegen.requested`, `imagegen.generated`, `imagegen.blocked`
- `safety.flagged`, `safety.blocked`, `safety.escalated`
- `cost.recorded`
- `deploy.started`, `deploy.completed`, `deploy.failed`

**No silent side effects.**

### 4.2 Tests Are Mandatory
- Every feature PR must include:
  - unit tests
  - integration tests (where applicable)
  - at least one E2E test for critical flows
- Any bugfix must include a regression test.

### 4.3 Determinism + Replayability
- Every derived artifact must be reproducible from the event stream.
- Use `trace_id` and `turn_id` for linking.
- Events must include enough data to replay:
  - model selection
  - prompt version
  - tool parameters
  - safety policy version
  - generation parameters (seeds/refs for image gen, where supported)

### 4.4 User Controls Must Cascade
When a user deletes memory or requests export:
- emit `memory.deleted` / `user.export.requested`
- projection rebuild must remove that content from:
  - vault notes
  - KG edges
  - retrieval indices/embeddings
  - cached summaries

---

## 5) Event Model

### 5.1 Event Envelope (Standard Fields)
All events MUST include:
- `event_id` (uuid)
- `timestamp` (ISO8601)
- `user_id`
- `session_id`
- `turn_id` (nullable for background events)
- `trace_id` (ties all events in a turn together)
- `type` (string)
- `payload` (JSON)
- `version` (event schema version)
- `causation_id` (event that caused this)
- `correlation_id` (links events across services)
- `cost` (optional: tokens/sec/$ estimate)

### 5.2 Idempotency
Event handlers must be idempotent:
- projections must be safe to re-run
- event consumers must dedupe by `event_id`

### 5.3 Turn Lifecycle (Reference)
A typical voice turn:
1. `audio.chunk.received` (many)
2. `stt.partial` (many)
3. `stt.final`
4. `turn.created` (or implicit via first STT final)
5. `memory.retrieval.requested` -> `memory.retrieval.completed`
6. `llm.requested` -> `llm.token` (many) -> `llm.final`
7. `tts.requested` -> `tts.chunk.ready` (many) -> `tts.completed`
8. `agent.message.created`
9. `projection.requested` (async) -> `projection.completed`
10. `cost.recorded`

---

## 6) Conversation Orchestrator Rules

### 6.1 Responsibilities
- Build model input context from:
  - recent turn window
  - session summary
  - retrieved long-term memory
  - companion spec (“Companion Bible”)
  - applicable safety constraints
- Route tools:
  - memory write/read
  - KG propose/add/remove
  - image analysis
  - image generation
  - vault projection triggers
- Emit events at every stage.

### 6.2 Prompt/Policy Versioning
- Every prompt template must have a version (e.g., `prompt_version: "companion_chat_v3"`).
- Safety policy must be versioned and logged with each response.

### 6.3 Safety Gate (Hard Requirement)
Before final output:
- classify/validate content
- block or redirect per policy
- emit `safety.*` events with reason codes

---

## 7) Companion Onboarding (“Design Your Companion”)

### 7.1 Output: Companion Spec (“Companion Bible”)
Onboarding produces a versioned JSON object:
- identity (name, pronouns, address style)
- personality (archetype + slider values)
- voice profile (provider voice id + tuning)
- visual style bible (style type, palette, constraints, reference assets)
- boundaries + relationship pacing
- memory consent policy

Emit:
- `companion.created`
- `companion.spec.updated`
- `voice.selected`
- `avatar.generated` / `avatar.promoted`
- `policy.accepted`
- `memory.consent.updated`

### 7.2 UX Rules
- Always offer a “fast path” preset + refine.
- Limit avatar iteration loops (2–3 max per step) to control cost.
- Lock identity anchors (reference images + constraints) after selection.

---

## 8) Image Generation + Agent Visuals

### 8.1 Asset Types
1) **Identity Anchors** (rarely change)
2) **Stateful Avatars** (update based on mood/context; rate-limited)
3) **Scene/Activity Images** (on-demand)

### 8.2 Avatar/Image Pipeline (Worker)
- Receives `avatar.requested` / `imagegen.requested`
- Applies policy gate
- Generates candidates
- Runs automated checks (format, policy, consistency heuristics)
- Promotes one to active via `avatar.promoted_to_active`
- Stores metadata + assets; emits events

### 8.3 Consistency Rules
- Maintain a “reference set” for each companion visual identity.
- Store generation parameters:
  - prompt template version
  - negative prompts
  - any reference image ids
  - seed (if supported)
- Never hot-swap the active avatar without emitting promotion events.

---

## 9) Obsidian-Style Vault Projection

### 9.1 Vault as a Projection (Not Source of Truth)
- The vault is derived from events.
- It must be rebuildable deterministically.

### 9.2 Vault Structure (Recommended)
- `/People/{userId}.md`
- `/Companions/{companionId}.md`
- `/Conversations/YYYY/MM/DD/{sessionId}.md`
- `/Memories/{memoryId}.md`
- `/Entities/{entityId}.md`
- `/Daily/{YYYY-MM-DD}.md`

### 9.3 Linking + Frontmatter
- Use `[[WikiLinks]]` between entities/memories/conversations
- Add YAML frontmatter for indexing (entities, topics, sentiment, etc.)
- Include provenance pointers (event ids) in a machine-readable section.

Emit:
- `vault.render.requested`
- `vault.render.completed`
- `vault.render.failed`

---

## 10) Knowledge Graph (KG) from Agent Perspective

### 10.1 KG Rules
- KG edges must have:
  - `source_event_id` provenance
  - `confidence`
  - `first_seen`, `last_seen`
  - `last_confirmed` (optional)
  - `status` (proposed/active/deprecated)
- Never overwrite facts silently. Prefer temporal updates.

### 10.2 KG Workflow
1) Extract candidate entities/relations per turn (`kg.edge.proposed`)
2) Dedupe/canonicalize (aliases)
3) Promote to active (`kg.edge.added`)
4) If user edits/deletes: `kg.edge.removed` and re-project

---

## 11) Testing Strategy (Concrete)

### 11.1 Required Test Layers
- **Unit tests**: event schema validation, orchestrator logic, tool adapters, safety decisions
- **Integration tests**: event store append + idempotency, projection rebuild, vault build, KG build
- **E2E tests**:
  - onboarding → first conversation → avatar generated → vault note created → KG edges proposed
  - deletion cascade: delete a memory → vault + KG + embeddings rebuild remove it

### 11.2 Test Fixtures
Maintain canonical fixture event streams:
- `fixture_voice_turn.jsonl`
- `fixture_onboarding.jsonl`
- `fixture_imagegen.jsonl`
- `fixture_memory_delete.jsonl`

### 11.3 Contract Tests
Every provider/tool adapter must have contract tests:
- input schema validation
- output schema validation
- error mapping -> emits `tool.failed` with stable codes

---

## 12) Coding Standards (Implementation Guardrails)

### 12.1 Event First
Start feature design by enumerating:
1) required events
2) projections derived from those events
3) APIs that create/stream those events

### 12.2 Strict Schemas
Define JSON schemas for:
- each event type payload
- each tool input/output
- companion spec versions
Validate at boundaries.

### 12.3 Observability
- Every request has `trace_id`.
- Log structured entries with latency + cost per step.
- Emit `cost.recorded` per turn.

### 12.4 Provider Abstraction
- LLM/STT/TTS/imagegen providers must be swappable behind stable interfaces.
- Never couple business logic to a single provider response format.

---

## 13) Implementation Phases (Recommended)

### Phase 1 — MVP (Voice + Event Log + Basic Memory)
- push-to-talk voice sessions (WS streaming ok)
- event store + turn pipeline (Postgres 18.1)  [oai_citation:4‡PostgreSQL](https://www.postgresql.org/docs/release/?utm_source=chatgpt.com)
- basic safety gate
- companion onboarding (archetype + sliders + voice selection)
- vault projection (conversation notes)
- minimal KG (entity extraction + edge proposals)

### Phase 2 — Multimodal + Image Gen
- image upload + analysis events
- image generation + avatar pipeline
- stateful avatars with rate limits
- improved vault linking (entities/memories)

### Phase 3 — Rooms
- multi-participant sessions
- shared artifacts + room event streams
- stronger moderation + reporting

### Phase 4 — Optional Realtime State Layer
- Add a realtime/state plane if needed later (non-breaking because core is event-sourced)

---

## 14) Definition of Done Checklist (Must Pass)
A feature is done only when:
- [ ] Event types are defined + schemas validated
- [ ] All state changes emit events
- [ ] Projections are derived from events (no hidden writes)
- [ ] Unit tests included
- [ ] Integration tests included where applicable
- [ ] E2E test added/updated for user-facing flows
- [ ] Safety policy considerations implemented + logged
- [ ] Observability: trace_id + key metrics + cost events

---

## 15) Marketing Pages & Growth Stack (Separate Surface, Same Quality Bar)

We need a **high-conversion marketing site** with **amazing design** (premium product feel), plus a reliable growth/analytics stack and secure billing flows.

### 15.1 Marketing Site Architecture
- Implement marketing pages in **Next.js** (same framework as app, optionally separate package/app in a monorepo).  [oai_citation:5‡npm](https://www.npmjs.com/package/next?utm_source=chatgpt.com)
- Priorities:
  - Lighthouse performance (especially mobile)
  - SEO (metadata, OG images, schema.org)
  - Crisp motion + delightful interactions (without hurting perf)
  - Strong storytelling: value props, social proof, screenshots, pricing clarity

### 15.2 Required Pages
- **Home** (hero + interactive product demo section)
- **Pricing** (tiers, voice minutes/limits, add-ons)
- **FAQ** (searchable + structured data)
- **About / Story** (optional but recommended)
- **Changelog** (optional; good for trust)
- **Legal**: Privacy Policy, Terms, Acceptable Use
- **Contact** (support + sales)
- **Auth entrypoints**: Sign up / Log in
- **Billing**: Checkout + Manage subscription

### 15.3 Stripe Billing Flows + Security (incl. 2FA)
- Billing via **Stripe Checkout** + webhooks back to backend for entitlement changes.
- 2FA requirement:
  - Enforce **2FA/MFA at the account layer**, not “inside Stripe”.
  - On first paid conversion (or before access to premium features), require 2FA enablement:
    - emit `security.mfa.required`
    - user completes setup -> emit `security.mfa.enabled`
- Entitlement model:
  - Stripe subscription state changes -> emit `billing.subscription.updated`
  - App reads entitlements from DB (never trusts client)
- All webhook handling must be idempotent and event-emitting:
  - `billing.webhook.received`
  - `billing.checkout.completed`
  - `billing.invoice.paid`
  - `billing.payment_failed`
  - `billing.subscription.canceled`

### 15.4 Analytics: PostHog + GTM
- **GTM** (marketing tags, ad pixels, consent control)
- **PostHog** (product analytics, funnels, feature usage)
- Rules:
  - Track key funnel events:
    - `mkt.page_viewed`
    - `mkt.cta_clicked` (hero CTA, pricing CTA)
    - `mkt.pricing_viewed`
    - `auth.signup_started`, `auth.signup_completed`
    - `billing.checkout_started`, `billing.checkout_completed`
  - Use a single canonical user identifier across app + PostHog (after auth).
  - Respect consent: only fire non-essential tracking after opt-in (where required).
  - Marketing events must ALSO be written to our internal event store (server-side) for trusted attribution and replay:
    - never rely solely on client-side analytics.

### 15.5 Design + Content Guardrails
- “Premium” design system with:
  - a consistent type scale
  - spacing system
  - accessible contrast
  - motion guidelines
- Every marketing change that affects conversion must be testable:
  - feature flags / A/B tests (PostHog experiments or equivalent)
  - emit `mkt.experiment.assigned` and record variant.

### 15.6 Testing Requirements for Marketing Surface
- Unit tests:
  - link integrity (routes)
  - pricing table correctness (tiers match entitlements)
- Integration tests:
  - Stripe webhook contract tests (fixtures)
  - entitlement updates from webhooks
- E2E tests:
  - landing → pricing → signup → checkout → entitlement active
  - 2FA required before premium access

---

## 16) Reference: What This Document Captures
From our design discussion, the platform must support:
- Voice-first multimodal companion interactions
- A companion design onboarding UI
- Image generation and regularly updating companion visuals
- Every event logged (event-sourcing as the backbone)
- An Obsidian-like “conversation vault” projection
- A provenance-rich knowledge graph of the user built from the agent perspective
- Strong engineering guardrails: tests-first + schema-first + event-first
- AWS-first deployment with S3, Postgres, containerized services, and AWS CLI bootstrap
- A separate, high-quality marketing surface with Stripe + 2FA enforcement, PostHog, and GTM


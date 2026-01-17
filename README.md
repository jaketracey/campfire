# Campfire

**Enterprise AI Companion Platform** - Create personalized AI companions with unique personalities, voices, and visual styles.

Campfire is a full-stack, production-ready platform for building and interacting with customizable AI companions. Users can create companions with distinct personalities, voices, and visual identities, then engage in real-time conversations with voice support, memory persistence, dynamic image/video generation, and advanced features like group chat, games, and white-label multi-tenancy.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-green)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Table of Contents

- [Features](#features)
  - [Core Features](#core-features)
  - [Creator & Monetization Features](#creator--monetization-features)
  - [Enterprise Features](#enterprise-features)
  - [Admin Features](#admin-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Development](#development)
- [Services Deep Dive](#services-deep-dive)
- [Code Paths & Flows](#code-paths--flows)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [TODO](#todo)
- [License](#license)

## Features

### Core Features

- **Personalized Companions** - Create AI companions with custom names, pronouns, personalities, voices, and visual styles
- **Real-time Voice Conversations** - Speech-to-text (STT) and text-to-speech (TTS) powered by Deepgram and ElevenLabs
- **Dynamic Image Generation** - Generate companion avatars and contextual images using Flux, DALL-E, Stable Diffusion, and other models
- **Video Generation** - Create dynamic video content with companion characters
- **Persistent Memory** - Companions remember conversations and build relationships over time with configurable retention policies
- **Knowledge Graph** - Structured relationship tracking between entities mentioned in conversations
- **Event Sourcing** - Complete audit trail of all interactions for debugging, analytics, and compliance
- **Multi-provider LLM Support** - Anthropic Claude (primary), OpenAI GPT-4 (fallback), with intelligent routing
- **Group Chat** - Multi-companion conversations with up to 5 participants
- **Interactive Games** - Built-in games like Tic-Tac-Toe that companions can play with users
- **Personality Profiles** - User personality assessments that inform companion behavior
- **Voice Customization** - Choose from multiple voice providers and voice IDs with speed/pitch control

### Creator & Monetization Features

- **Creator Earnings Platform** - Revenue sharing for companion creators
- **White-Label Multi-Tenancy** - Full tenant isolation with custom domains and branding
- **Gift System** - Send virtual gifts to companions with real monetary value
- **Referral Program** - User referral tracking with rewards
- **Affiliate System** - Complete affiliate marketing platform with tracking, commissions, and portal
- **Stripe Billing Integration** - Subscriptions, one-time purchases, and webhook handling
- **Usage Tracking & Cost Analytics** - Real-time cost monitoring per user, companion, and session

### Enterprise Features

- **Multi-Tenant Architecture** - Isolated data, custom branding, and tenant-specific configurations
- **Tenant Application System** - Public application forms for new tenants
- **Brand Customization** - Custom logos, colors, and themes per tenant
- **Admin Dashboard** - Comprehensive admin panel for platform management
- **Support Ticket System** - Built-in customer support with ticket management
- **SEO Optimization** - Dynamic sitemaps, meta tags, and public pages
- **Analytics Dashboard** - User engagement, conversation metrics, and revenue analytics
- **Advertising System** - Ad placement and campaign management
- **Email System** - Transactional emails via Amazon SES with MJML templates
- **Rate Limiting** - Per-user request throttling and quota management
- **Observability** - OpenTelemetry tracing, structured logging with Pino

### Admin Features

- **Provider Management** - Configure and route between LLM, STT, TTS, image, and video providers
- **Model Configuration** - Add, update, and configure AI models for each provider
- **Routing Rules** - Set up intelligent routing based on companion, user, or request characteristics
- **Prompt Template Management** - Edit and version control system prompts
- **Cost Monitoring** - Real-time cost tracking across all AI providers
- **Analytics Dashboard** - User growth, engagement metrics, and revenue analytics
- **Tenant Management** - Create, configure, and manage white-label tenants
- **Affiliate Management** - Review and manage affiliate partnerships
- **Support Dashboard** - Manage support tickets and customer inquiries
- **Log Viewing** - Real-time Docker container logs via admin UI
- **Debug Tools** - Testing endpoints for AI providers and integrations
- **SEO Management** - Configure meta tags, sitemaps, and public pages

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Clients                                      │
│                    (Web App + Mobile App)                                │
└─────────────────────┬─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Gateway Service                                   │
│              (Fastify + WebSocket + REST API)                             │
│                         Port 4000/4001                                    │
│  - Authentication (JWT)                                                   │
│  - Rate Limiting                                                          │
│  - WebSocket Events                                                       │
│  - REST API (40+ routes)                                                  │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
          ┌───────────┼───────────────────┐
          │           │                   │
          ▼           ▼                   ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────────┐
│ Orchestrator│ │   Workers   │ │    PostgreSQL   │
│  (FastAPI)  │ │  (BullMQ)   │ │   + pgvector    │
│  Port 5000  │ │             │ │    Port 5432    │
│             │ │ - Email     │ │                 │
│ - Turn Mgmt │ │ - Embedding │ │ - Users         │
│ - LLM Calls │ │ - KG        │ │ - Companions    │
│ - Tools     │ │ - Vault     │ │ - Sessions      │
│ - Safety    │ │ - Images    │ │ - Memories      │
│ - Games     │ │ - Videos    │ │ - Events        │
│ - Group Chat│ │ - Gifts     │ │ - Tenants       │
└──────┬──────┘ └──────┬──────┘ └─────────────────┘
       │               │
       │               ▼
       │        ┌─────────────┐
       │        │    Redis    │
       │        │  Port 6379  │
       │        │             │
       │        │ - Queues    │
       │        │ - Cache     │
       │        │ - Sessions  │
       │        └─────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          AI Provider APIs                                 │
│     Anthropic │ OpenAI │ Deepgram │ ElevenLabs │ FAL │ Replicate        │
│     Cartesia │ PlayHT │ AWS S3 │ AWS SES │ Stripe                        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Monorepo** | pnpm workspaces + Turborepo |
| **Gateway** | Fastify 5, WebSocket, OpenTelemetry, BullMQ |
| **Web App** | Next.js 16, React 19, Radix UI, TanStack Query, Zustand |
| **Mobile App** | React Native 0.81, Expo 54 |
| **Orchestrator** | Python 3.11+, FastAPI, Pydantic |
| **Workers** | BullMQ, ioredis, TypeScript |
| **Shared** | Zod schemas, TypeScript types |
| **Database** | PostgreSQL 18 + pgvector |
| **Cache/Queue** | Redis 7 |
| **Infrastructure** | AWS ECS Fargate, S3, SES, CloudWatch |
| **CI/CD** | GitHub Actions |
| **AI Providers** | Anthropic, OpenAI, Deepgram, ElevenLabs, FAL, Replicate |
| **Payments** | Stripe |
| **Email** | Amazon SES, MJML |
| **Monitoring** | OpenTelemetry, Pino, CloudWatch |

## Project Structure

```
campfire/
├── packages/
│   ├── gateway/          # API Gateway + WebSocket server (TypeScript)
│   │   ├── src/
│   │   │   ├── routes/           # 40+ REST API routes
│   │   │   ├── ws/               # WebSocket event handlers
│   │   │   ├── services/         # Business logic layer
│   │   │   ├── repositories/     # Database access layer
│   │   │   ├── middleware/       # Auth, rate limiting, etc.
│   │   │   ├── db/               # Migrations and seeds
│   │   │   └── observability/    # Logging and tracing
│   │
│   ├── web/              # Main web application (Next.js)
│   │   ├── src/
│   │   │   ├── app/              # Next.js 16 app router
│   │   │   │   ├── (auth)/       # Login, register
│   │   │   │   ├── onboard/      # 7-step companion creation
│   │   │   │   ├── chat/         # Conversation interface
│   │   │   │   ├── dashboard/    # User dashboard
│   │   │   │   ├── admin/        # Admin panel
│   │   │   │   ├── account/      # User settings
│   │   │   │   ├── affiliate/    # Affiliate portal
│   │   │   │   └── tenants/      # Tenant management
│   │   │   ├── components/       # React components
│   │   │   ├── lib/              # Utilities and helpers
│   │   │   └── hooks/            # Custom React hooks
│   │
│   ├── mobile/           # Mobile application (React Native + Expo)
│   │   ├── src/
│   │   │   ├── screens/          # Mobile screens
│   │   │   ├── components/       # Shared components
│   │   │   └── navigation/       # React Navigation setup
│   │
│   ├── orchestrator/     # AI orchestration service (Python)
│   │   ├── src/orchestrator/
│   │   │   ├── main.py           # FastAPI app
│   │   │   ├── routing/          # Turn management
│   │   │   ├── providers/        # LLM, STT, TTS, image providers
│   │   │   ├── tools/            # Memory, KG, image tools
│   │   │   ├── safety/           # Content moderation
│   │   │   ├── games/            # Interactive games
│   │   │   ├── prompts/          # System prompt templates
│   │   │   └── models/           # Pydantic models
│   │
│   ├── workers/          # Background job processors (TypeScript)
│   │   ├── src/
│   │   │   ├── email/            # Email worker (SES)
│   │   │   ├── image/            # Image processing
│   │   │   ├── video/            # Video processing
│   │   │   ├── gift/             # Gift processing
│   │   │   ├── ads/              # Ad impression tracking
│   │   │   ├── projections/      # Memory vault projection
│   │   │   └── storage/          # S3 operations
│   │
│   └── shared/           # Shared types and schemas (TypeScript)
│       ├── src/
│       │   ├── events/           # Event schemas (Zod)
│       │   ├── api/              # API types
│       │   ├── companion/        # Companion types
│       │   ├── group-chat/       # Group chat types
│       │   └── user/             # User types
│
├── infra/
│   ├── aws-cli/          # AWS infrastructure scripts (dev/staging/prod)
│   │   ├── dev/                  # Development environment
│   │   ├── staging/              # Staging environment
│   │   └── prod/                 # Production environment
│   ├── docker/           # Dockerfiles and compose configs
│   │   ├── docker-compose.yml    # Local development
│   │   ├── Dockerfile.gateway
│   │   ├── Dockerfile.web
│   │   ├── Dockerfile.orchestrator
│   │   └── Dockerfile.workers
│   └── scripts/          # Deployment and utility scripts
│
├── docs/                 # Documentation
│   ├── deployment-runbook.md
│   ├── PRIVACY_AUDIT_REPORT.md
│   └── white-label-and-creator-earnings.md
│
├── business/             # Business documentation
│   ├── 01-executive-summary.md
│   ├── 02-market-analysis.md
│   ├── 03-product-strategy.md
│   ├── 04-gtm-strategy.md
│   ├── 05-pricing-monetization.md
│   ├── 06-growth-metrics.md
│   ├── 07-competitive-positioning.md
│   ├── 08-operations-launch-checklist.md
│   ├── 09-financial-projections.md
│   └── 10-risk-assessment.md
│
├── fixtures/             # Test fixtures and sample data
│   ├── fixture_imagegen.jsonl
│   ├── fixture_memory_delete.jsonl
│   ├── fixture_onboarding.jsonl
│   └── fixture_voice_turn.jsonl
│
├── scripts/              # Utility scripts
│   ├── generate-companion-portraits.sh
│   ├── upload-companion-images-to-s3.sh
│   ├── seed-fal-models.ts
│   └── audit-prompts.sh
│
└── .github/workflows/    # CI/CD pipelines
    ├── deploy.yml
    ├── test.yml
    └── rollback.yml
```

## Quick Start

### Prerequisites

- Node.js >= 24.0.0
- pnpm >= 9.0.0
- Python >= 3.11
- Docker & Docker Compose
- PostgreSQL 18 with pgvector (or use Docker)
- Redis 7 (or use Docker)

### 1. Clone and Install

```bash
git clone git@github.com:jaketracey/campfire.git
cd campfire
pnpm install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

Required API keys:
- `ANTHROPIC_API_KEY` - Primary LLM provider
- `OPENAI_API_KEY` - Fallback LLM + embeddings
- `DEEPGRAM_API_KEY` - Speech-to-text
- `ELEVENLABS_API_KEY` - Text-to-speech
- `FAL_API_KEY` or `REPLICATE_API_TOKEN` - Image generation
- `STRIPE_SECRET_KEY` - Payment processing
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` - S3 storage and SES email

### 3. Start Infrastructure

```bash
# Start PostgreSQL and Redis with Docker
pnpm docker:up

# Or use local installations
# Ensure PostgreSQL and Redis are running locally
```

### 4. Database Setup

```bash
# Run migrations
pnpm db:migrate

# Seed with sample data (optional)
pnpm db:seed
```

### 5. Start Development Servers

```bash
# Start all services
pnpm dev

# Or start individual services
pnpm --filter gateway dev      # API Gateway (localhost:4000)
pnpm --filter web dev          # Web App (localhost:3000)
pnpm --filter orchestrator dev # Orchestrator (localhost:5000)
pnpm --filter workers dev      # Background workers
```

### 6. Open the App

- **Web App**: http://localhost:3000
- **API Gateway**: http://localhost:4000
- **API Docs**: http://localhost:4000/docs
- **Admin Panel**: http://localhost:3000/admin (requires admin user)

## Development

### Available Scripts

```bash
# Development
pnpm dev              # Start all services in development mode
pnpm dev:stream       # Start with streaming output (no TUI)
pnpm build            # Build all packages
pnpm typecheck        # Run TypeScript type checking
pnpm lint             # Run ESLint across all packages
pnpm test             # Run all tests
pnpm test:unit        # Run unit tests only
pnpm test:integration # Run integration tests
pnpm test:e2e         # Run end-to-end tests

# Database
pnpm db:migrate       # Run database migrations
pnpm db:seed          # Seed database with sample data

# Docker
pnpm docker:up        # Start PostgreSQL and Redis containers
pnpm docker:down      # Stop containers
pnpm docker:build     # Build all service images

# Mobile
pnpm mobile           # Start Expo dev server
pnpm mobile:ios       # Run on iOS simulator
pnpm mobile:android   # Run on Android emulator
pnpm mobile:build:ios # Build iOS app for production
pnpm mobile:build:android # Build Android app for production

# Utilities
pnpm audit:prompts    # Audit AI prompt templates
```

### Package-Specific Commands

```bash
# Gateway
pnpm --filter gateway dev
pnpm --filter gateway test
pnpm --filter gateway db:migrate

# Web
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web test

# Orchestrator (Python)
cd packages/orchestrator
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m orchestrator.main

# Workers
pnpm --filter workers dev
pnpm --filter workers test
```

### Code Quality

```bash
# Type checking
pnpm typecheck

# Linting
pnpm lint

# Testing
pnpm test              # All tests
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests
pnpm test:e2e          # End-to-end tests
```

## Services Deep Dive

### Gateway (`packages/gateway`)

The API gateway is a Fastify-based service that handles all client communication.

**Key Responsibilities:**
- REST API with 40+ endpoints across multiple domains
- WebSocket server for real-time bidirectional communication
- JWT-based authentication with session management
- Rate limiting and request throttling
- Event sourcing and storage
- OpenTelemetry tracing and structured logging
- Database access via repositories pattern

**Main Routes:**
- `/api/v1/auth` - Authentication (login, register, logout, refresh)
- `/api/v1/companions` - Companion CRUD operations
- `/api/v1/sessions` - Conversation session management
- `/api/v1/memories` - Memory CRUD and search
- `/api/v1/knowledge-graph` - Entity and relationship queries
- `/api/v1/imagegen` - Image generation requests
- `/api/v1/videos` - Video generation requests
- `/api/v1/billing` - Stripe checkout and subscriptions
- `/api/v1/gifts` - Virtual gift system
- `/api/v1/users` - User profile and preferences
- `/api/v1/support` - Support ticket management
- `/api/v1/referrals` - Referral tracking
- `/api/v1/affiliate` - Affiliate portal and tracking
- `/api/v1/creator` - Creator earnings dashboard
- `/api/v1/admin/*` - Admin panel endpoints (40+ routes)
- `/webhooks/email` - Email bounce/complaint webhooks

### Orchestrator (`packages/orchestrator`)

Python FastAPI service responsible for AI orchestration and conversation management.

**Key Responsibilities:**
- Turn-by-turn conversation flow management
- Multi-provider LLM integration (Anthropic, OpenAI)
- Tool routing and execution (memory, images, knowledge graph)
- Safety gate and content moderation
- Group chat coordination (multi-companion conversations)
- Interactive game hosting (Tic-Tac-Toe)
- STT/TTS provider abstraction
- Streaming response handling

**Main Components:**
- `routing/` - Turn orchestration and context management
- `providers/` - LLM, STT, TTS, image provider integrations
- `tools/` - Memory tools, image generation, knowledge graph tools
- `safety/` - Content moderation and safety checks
- `games/` - Interactive game implementations
- `prompts/` - System prompt templates and management

**API Endpoints:**
- `POST /orchestrate/turn` - Process a conversation turn
- `POST /orchestrate/group-turn` - Process a group chat turn
- `POST /tools/memory/write` - Write memory
- `POST /tools/memory/search` - Search memories
- `POST /tools/image/generate` - Generate image
- `GET /health` - Health check

### Workers (`packages/workers`)

Background job processors using BullMQ for async task execution.

**Workers:**
- **Email Worker** - Send transactional emails via Amazon SES (welcome, reset password, notifications)
- **Embedding Worker** - Generate vector embeddings for semantic memory search
- **Knowledge Graph Worker** - Extract entities and relationships from conversations
- **Vault Projection Worker** - Summarize companion memories into structured vault
- **Image Worker** - Process and optimize generated images
- **Video Worker** - Process and encode generated videos
- **Gift Worker** - Process gift purchases and notifications
- **Ad Worker** - Track ad impressions and analytics

**Queue Architecture:**
- Redis-backed BullMQ queues
- Automatic retry with exponential backoff
- Dead letter queue for failed jobs
- Job progress tracking and reporting
- Concurrent job processing

### Web (`packages/web`)

Next.js 16 application with React 19 and app router.

**Key Features:**
- Server-side rendering (SSR) and static generation (SSG)
- React Compiler for optimized builds
- TanStack Query for server state management
- Zustand for client state management
- Radix UI component library
- Tailwind CSS with custom design system
- Dark mode support with next-themes
- Real-time WebSocket integration
- Voice recording with VAD (Voice Activity Detection)
- Responsive design for mobile and desktop

**Main Routes:**
- `/` - Landing page
- `/login`, `/register` - Authentication
- `/onboard` - 7-step companion creation wizard
- `/chat` - Real-time chat interface
- `/dashboard` - User dashboard (companions, sessions, analytics)
- `/account` - User settings and preferences
- `/admin` - Admin panel (user management, analytics, settings)
- `/affiliate` - Affiliate portal
- `/tenants` - Tenant management (white-label)
- `/c/[slug]` - Public companion profile pages

### Mobile (`packages/mobile`)

React Native application with Expo for iOS and Android.

**Key Features:**
- Expo managed workflow
- React Navigation for routing
- Shared codebase with web (types, API client)
- Push notifications via Expo Notifications
- Secure storage for auth tokens
- Voice recording and playback
- File system access for media

### Shared (`packages/shared`)

TypeScript types and Zod schemas shared across all packages.

**Exports:**
- Event schemas (all event payloads with Zod validation)
- API types (request/response types)
- Companion types (CompanionSpec, visual styles, etc.)
- Group chat types
- User types
- Validation utilities

## Code Paths & Flows

### 1. User Registration & Companion Creation

```
User submits registration form
  ↓
POST /api/v1/auth/register
  ↓
Gateway creates user account (bcrypt password hash)
  ↓
Gateway emits user.registered event
  ↓
Email worker sends welcome email
  ↓
User redirects to /onboard
  ↓
7-step wizard collects:
  1. Name & pronouns
  2. Personality archetype & traits
  3. Communication style
  4. Voice selection (provider + voice ID)
  5. Visual style (image model + palette)
  6. Boundaries & topics
  7. Memory consent
  ↓
POST /api/v1/companions
  ↓
Gateway creates companion record
  ↓
Gateway emits companion.created event
  ↓
Image worker generates initial portrait
  ↓
Redirect to /chat
```

### 2. Text Conversation Flow

```
User types message in chat UI
  ↓
WebSocket: { type: 'message.send', content: '...' }
  ↓
Gateway validates auth & session
  ↓
Gateway emits user.message.created event
  ↓
Gateway stores event in PostgreSQL
  ↓
Gateway calls Orchestrator: POST /orchestrate/turn
  ↓
Orchestrator loads companion spec & conversation history
  ↓
Orchestrator builds context with system prompt + memories
  ↓
Orchestrator calls LLM (Anthropic Claude)
  ↓
LLM streams response tokens
  ↓
For each token:
  WebSocket: { type: 'llm.token', token: '...' }
  ↓
LLM completes response
  ↓
Orchestrator checks for tool calls (memory write, image gen)
  ↓
If memory tool called:
  Orchestrator writes memory to database
  WebSocket: { type: 'memory.written', memory: {...} }
  Embedding worker queues embedding job
  ↓
If image tool called:
  Orchestrator calls image provider (FAL/Replicate)
  WebSocket: { type: 'avatar.generating' }
  Image worker processes and uploads to S3
  WebSocket: { type: 'avatar.generated', url: '...' }
  ↓
Gateway emits agent.message.created event
  ↓
Orchestrator returns final response
  ↓
WebSocket: { type: 'llm.final', content: '...' }
```

### 3. Voice Conversation Flow

```
User clicks voice button
  ↓
Web app starts recording (VAD detects speech)
  ↓
Audio chunks captured from microphone
  ↓
For each chunk:
  WebSocket: { type: 'audio.chunk', data: base64Audio }
  ↓
Gateway buffers audio chunks
  ↓
Gateway calls Deepgram STT API (streaming)
  ↓
Deepgram returns partial transcripts
  ↓
WebSocket: { type: 'stt.partial', transcript: '...' }
  ↓
User stops speaking (VAD detects silence)
  ↓
Gateway finalizes STT
  ↓
WebSocket: { type: 'stt.final', transcript: '...' }
  ↓
Gateway calls Orchestrator with transcript
  ↓
[Same LLM flow as text conversation]
  ↓
Orchestrator returns text response
  ↓
Gateway calls ElevenLabs TTS API (streaming)
  ↓
For each audio chunk:
  WebSocket: { type: 'tts.chunk', audio: base64Audio }
  ↓
Web app plays audio chunks in real-time
  ↓
TTS completes
  ↓
WebSocket: { type: 'tts.completed' }
```

### 4. Group Chat Flow

```
User invites companion to group chat
  ↓
POST /api/v1/sessions/:id/invite
  ↓
Gateway adds companion as participant
  ↓
Gateway emits group.participant.joined event
  ↓
User sends message in group chat
  ↓
WebSocket: { type: 'message.send', content: '...' }
  ↓
Gateway calls Orchestrator: POST /orchestrate/group-turn
  ↓
Orchestrator loads all active companions (up to 5)
  ↓
For each companion:
  Orchestrator builds context with:
    - Companion's own spec & memories
    - Group chat history
    - Other participants' info
  ↓
  Orchestrator calls LLM
  ↓
  LLM decides if companion should respond
  ↓
  If responding:
    Stream response with companion theme color
    WebSocket: { type: 'group.message', companionId, content, color }
  ↓
All companions respond (or pass)
  ↓
Gateway emits group.turn.completed event
```

### 5. Gift Purchase Flow

```
User selects gift from gift shop
  ↓
POST /api/v1/gifts/purchase
  ↓
Gateway creates Stripe checkout session
  ↓
User redirects to Stripe hosted checkout
  ↓
User completes payment
  ↓
Stripe webhook: checkout.session.completed
  ↓
POST /webhooks/stripe
  ↓
Gateway verifies webhook signature
  ↓
Gateway emits billing.checkout.completed event
  ↓
Gift worker processes gift:
  - Credits creator account
  - Creates gift record
  - Sends notification email
  ↓
WebSocket: { type: 'gift.received', gift: {...} }
  ↓
Companion acknowledges gift in next message
```

### 6. Memory Vault Projection

```
Cron job triggers vault projection (daily)
  ↓
Vault worker queries all companions with new memories
  ↓
For each companion:
  Worker loads all memories since last projection
  ↓
  Worker calls OpenAI to summarize memories into categories:
    - Personal facts
    - Preferences
    - Relationship milestones
    - Shared experiences
  ↓
  Worker updates companion's vault JSON
  ↓
  Worker emits vault.projected event
  ↓
Next conversation includes updated vault in context
```

### 7. Admin Provider Configuration

```
Admin navigates to /admin/providers
  ↓
GET /api/v1/admin/providers
  ↓
Gateway returns all LLM providers & models
  ↓
Admin adds new model configuration
  ↓
POST /api/v1/admin/models
  ↓
Gateway validates model config
  ↓
Gateway stores in PostgreSQL providers table
  ↓
Admin sets up routing rule
  ↓
POST /api/v1/admin/routing
  ↓
Gateway creates routing rule (e.g., "Use GPT-4 for companions with tag 'premium'")
  ↓
Next LLM request checks routing rules
  ↓
Orchestrator selects provider based on rules
  ↓
Orchestrator calls selected provider
```

## API Reference

### REST Endpoints

#### Authentication
```
POST   /api/v1/auth/register          # User registration
POST   /api/v1/auth/login             # User login
POST   /api/v1/auth/logout            # User logout
POST   /api/v1/auth/refresh           # Refresh JWT token
POST   /api/v1/auth/forgot-password   # Send password reset email
POST   /api/v1/auth/reset-password    # Reset password with token
```

#### Users
```
GET    /api/v1/users/me               # Get current user
PATCH  /api/v1/users/me               # Update user profile
DELETE /api/v1/users/me               # Delete account
GET    /api/v1/users/me/personality   # Get personality profile
POST   /api/v1/users/me/personality   # Submit personality assessment
GET    /api/v1/users/me/costs         # Get usage costs
```

#### Companions
```
GET    /api/v1/companions             # List user's companions
POST   /api/v1/companions             # Create new companion
GET    /api/v1/companions/:id         # Get companion details
PATCH  /api/v1/companions/:id         # Update companion
DELETE /api/v1/companions/:id         # Delete companion
GET    /api/v1/companions/:id/friends # Get companion friends
POST   /api/v1/companions/:id/friends # Add friend relationship
GET    /api/v1/companions/:id/tenets  # Get companion tenets
POST   /api/v1/companions/:id/tenets  # Add tenet
PATCH  /api/v1/companions/:id/tenets/:tenetId # Update tenet
DELETE /api/v1/companions/:id/tenets/:tenetId # Delete tenet
```

#### Sessions
```
GET    /api/v1/sessions               # List conversation sessions
POST   /api/v1/sessions               # Start new session
GET    /api/v1/sessions/:id           # Get session details
DELETE /api/v1/sessions/:id           # Delete session
POST   /api/v1/sessions/:id/invite    # Invite companion to group chat
POST   /api/v1/sessions/:id/dismiss   # Remove companion from group
```

#### Memories
```
GET    /api/v1/memories               # List memories
POST   /api/v1/memories               # Create memory manually
GET    /api/v1/memories/:id           # Get memory details
PATCH  /api/v1/memories/:id           # Update memory
DELETE /api/v1/memories/:id           # Delete memory
POST   /api/v1/memories/search        # Semantic search
```

#### Knowledge Graph
```
GET    /api/v1/knowledge-graph/entities           # List entities
GET    /api/v1/knowledge-graph/entities/:id       # Get entity details
GET    /api/v1/knowledge-graph/relationships      # List relationships
```

#### Images & Videos
```
POST   /api/v1/imagegen               # Generate image
GET    /api/v1/videos                 # List video requests
POST   /api/v1/videos                 # Generate video
GET    /api/v1/videos/:id             # Get video status
GET    /api/v1/media                  # List all media (images + videos)
```

#### Billing
```
POST   /api/v1/billing/checkout       # Create Stripe checkout session
GET    /api/v1/billing/portal         # Get billing portal URL
GET    /api/v1/billing/subscription   # Get subscription status
POST   /api/v1/billing/subscription   # Subscribe to plan
DELETE /api/v1/billing/subscription   # Cancel subscription
```

#### Gifts
```
GET    /api/v1/gifts                  # List available gifts
POST   /api/v1/gifts/purchase         # Purchase gift
GET    /api/v1/gifts/history          # Get gift history
```

#### Support
```
GET    /api/v1/support/tickets        # List user's tickets
POST   /api/v1/support/tickets        # Create support ticket
GET    /api/v1/support/tickets/:id    # Get ticket details
POST   /api/v1/support/tickets/:id/messages # Add message to ticket
```

#### Affiliate
```
POST   /api/v1/affiliate/auth/register # Register as affiliate
POST   /api/v1/affiliate/auth/login    # Affiliate login
GET    /api/v1/affiliate/dashboard     # Get affiliate stats
GET    /api/v1/affiliate/links         # Get tracking links
GET    /api/v1/affiliate/earnings      # Get earnings history
GET    /r/:code                        # Affiliate tracking redirect
```

#### Admin (requires admin role)
```
GET    /api/v1/admin/stats            # Platform statistics
GET    /api/v1/admin/users            # List all users
PATCH  /api/v1/admin/users/:id        # Update user (ban, role, etc.)
GET    /api/v1/admin/analytics        # Analytics dashboard data
GET    /api/v1/admin/costs            # Cost analytics
GET    /api/v1/admin/providers        # List LLM providers
POST   /api/v1/admin/providers        # Add provider
PATCH  /api/v1/admin/providers/:id    # Update provider
GET    /api/v1/admin/models           # List models
POST   /api/v1/admin/models           # Add model
GET    /api/v1/admin/routing          # List routing rules
POST   /api/v1/admin/routing          # Create routing rule
GET    /api/v1/admin/tenants          # List tenants
POST   /api/v1/admin/tenants          # Create tenant
GET    /api/v1/admin/affiliates       # List affiliates
PATCH  /api/v1/admin/affiliates/:id   # Update affiliate
GET    /api/v1/admin/support/tickets  # List all support tickets
GET    /api/v1/admin/ads              # List ad campaigns
POST   /api/v1/admin/ads              # Create ad campaign
GET    /api/v1/admin/seo              # SEO settings
GET    /api/v1/admin/logs/:service    # Get Docker container logs
GET    /api/v1/admin/prompts          # List prompt templates
PATCH  /api/v1/admin/prompts/:id      # Update prompt template
```

### WebSocket Protocol

#### Client → Server Events
```typescript
{ type: 'session.start', companionId: string }
{ type: 'message.send', content: string }
{ type: 'audio.chunk', data: string } // base64 audio
{ type: 'audio.stop' }
{ type: 'session.end' }
```

#### Server → Client Events
```typescript
// STT Events
{ type: 'stt.partial', transcript: string }
{ type: 'stt.final', transcript: string, confidence: number }

// LLM Events
{ type: 'llm.start' }
{ type: 'llm.token', token: string }
{ type: 'llm.final', content: string }

// TTS Events
{ type: 'tts.start' }
{ type: 'tts.chunk', audio: string } // base64 audio
{ type: 'tts.completed' }

// Memory Events
{ type: 'memory.proposed', memory: Memory }
{ type: 'memory.written', memory: Memory }
{ type: 'memory.deleted', memoryId: string }

// Tool Events
{ type: 'tool.called', tool: string, args: any }
{ type: 'tool.succeeded', tool: string, result: any }
{ type: 'tool.failed', tool: string, error: string }

// Avatar Events
{ type: 'avatar.generating', prompt: string }
{ type: 'avatar.generated', url: string, metadata: any }

// Group Chat Events
{ type: 'group.participant.joined', participant: GroupParticipant }
{ type: 'group.participant.left', companionId: string, reason: string }
{ type: 'group.message', companionId: string, content: string, themeColor: string }

// Gift Events
{ type: 'gift.received', gift: Gift }

// Session Events
{ type: 'session.started', sessionId: string }
{ type: 'session.ended', sessionId: string }

// Error Events
{ type: 'error', message: string, code?: string }
```

## Deployment

### Environments

| Environment | Purpose | Deploy Trigger |
|-------------|---------|----------------|
| dev | Development testing | Push to main |
| staging | Pre-production | Manual |
| prod | Production | Manual + approval |

### Deploy Commands

```bash
# Deploy to staging
gh workflow run deploy.yml -f environment=staging -f services=all

# Deploy specific services to prod
gh workflow run deploy.yml -f environment=prod -f services=gateway,web

# Rollback
gh workflow run rollback.yml -f environment=prod -f services=all
```

See [docs/deployment-runbook.md](docs/deployment-runbook.md) for detailed deployment procedures.

### Infrastructure Setup

```bash
# Create AWS infrastructure for dev environment
cd infra/aws-cli/dev
./00-config.sh          # Set environment variables
./01-create-s3-buckets.sh
./02-create-ecr-repos.sh
./03-create-vpc.sh
./04-create-rds.sh
./05-create-ecs-cluster.sh
./06-create-load-balancer.sh
./07-create-task-definitions.sh
./08-create-services.sh
```

### Docker Images

```bash
# Build all images
pnpm docker:build

# Build specific image
docker build -f infra/docker/Dockerfile.gateway -t campfire-gateway .
docker build -f infra/docker/Dockerfile.web -t campfire-web .
docker build -f infra/docker/Dockerfile.orchestrator -t campfire-orchestrator .
docker build -f infra/docker/Dockerfile.workers -t campfire-workers .

# Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ECR_URL>
docker tag campfire-gateway:latest <ECR_URL>/campfire-gateway:latest
docker push <ECR_URL>/campfire-gateway:latest
```

## Configuration

### Environment Variables

See [.env.example](.env.example) for all configuration options.

#### Database & Cache
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/campfire
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
REDIS_URL=redis://localhost:6379
```

#### Authentication & Security
```bash
JWT_SECRET=your-secret-key
SESSION_SECRET=your-session-secret
CORS_ORIGINS=http://localhost:3000,https://app.campfire.com
```

#### AI Providers
```bash
# LLM
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Voice
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...
CARTESIA_API_KEY=...
PLAYHT_API_KEY=...

# Images
FAL_API_KEY=...
REPLICATE_API_TOKEN=...

# Video
RUNWAY_API_KEY=...
```

#### AWS Services
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_MEDIA_BUCKET=campfire-media-dev
S3_VAULT_BUCKET=campfire-vault-dev
SES_SENDER_EMAIL=noreply@campfire.com
```

#### Payments & Billing
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_BASIC=price_...
STRIPE_PRICE_ID_PREMIUM=price_...
```

#### Analytics & Monitoring
```bash
POSTHOG_API_KEY=...
GTM_CONTAINER_ID=GTM-...
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_SERVICE_NAME=campfire-gateway
```

#### Feature Flags
```bash
FEATURE_IMAGE_GENERATION=true
FEATURE_VIDEO_GENERATION=true
FEATURE_VOICE_CONVERSATIONS=true
FEATURE_KNOWLEDGE_GRAPH=true
FEATURE_VAULT_PROJECTION=true
FEATURE_GROUP_CHAT=true
FEATURE_GAMES=true
FEATURE_GIFTS=true
FEATURE_AFFILIATES=true
FEATURE_MULTI_TENANCY=true
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `pnpm test`
5. Run type checking: `pnpm typecheck`
6. Run linting: `pnpm lint`
7. Commit with conventional commits: `git commit -m "feat: add new feature"`
8. Push and create a pull request

### Commit Convention

```
feat: add new feature
fix: bug fix
docs: documentation changes
style: formatting, missing semicolons, etc.
refactor: code restructuring without feature changes
test: adding or updating tests
chore: maintenance tasks
perf: performance improvements
```

### Code Standards

- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- Zod for runtime validation
- Conventional commits for git history
- Test coverage > 80% for critical paths
- All APIs must be versioned (e.g., `/api/v1`)
- All events must have Zod schemas in `@campfire/shared`

## TODO

### High Priority (Q1 2026)

- [ ] **Voice Cloning** - Allow users to clone their own voice for companions
- [ ] **Multi-Language Support** - i18n for Spanish, French, German, Japanese
- [ ] **Advanced Memory Management** - User-facing memory browser with edit/delete
- [ ] **Companion Marketplace** - Public marketplace for users to discover companions
- [ ] **Mobile App Launch** - Polish and release iOS/Android apps
- [ ] **Message Reactions** - Like, love, laugh reactions to messages
- [ ] **Message Threading** - Reply to specific messages in conversations
- [ ] **Voice Cloning for Companions** - Generate custom voices from audio samples
- [ ] **Real-time Collaborative Editing** - Multiple users can edit a companion together

### Medium Priority (Q2 2026)

- [ ] **Video Conversations** - Real-time video chat with animated companion avatars
- [ ] **3D Avatars** - 3D animated avatars using Ready Player Me or VRM
- [ ] **Screen Sharing** - Companions can view and comment on user's screen
- [ ] **File Uploads** - Upload images, PDFs, documents for companion to analyze
- [ ] **Calendar Integration** - Schedule conversations, set reminders with companion
- [ ] **Location-Based Features** - Companions aware of user's timezone, weather, location
- [ ] **Advanced Analytics** - Deeper insights into conversation patterns, topics, sentiment
- [ ] **Companion Personalities v2** - More granular personality controls (Big Five traits)
- [ ] **Custom Tools** - Let users create custom tools for companions (plugins)
- [ ] **Webhook Integrations** - Let companions trigger webhooks for external actions
- [ ] **Browser Extension** - Chrome/Firefox extension for quick companion access
- [ ] **Discord Bot** - Interact with companions via Discord
- [ ] **Telegram Bot** - Interact with companions via Telegram
- [ ] **API Access** - Public API for third-party integrations

### Low Priority (Q3-Q4 2026)

- [ ] **Companion Collaboration** - Companions can collaborate on tasks (coding, writing)
- [ ] **Long-term Memory Search** - Advanced semantic search across all memories
- [ ] **Companion Training** - Fine-tune companion behavior with user feedback (RLHF)
- [ ] **Multi-modal Input** - Image/video input for richer conversations
- [ ] **AR Experiences** - AR filters and experiences with companion avatars
- [ ] **Companion Communities** - User forums and communities per companion
- [ ] **Companion Events** - Live events where companions interact with multiple users
- [ ] **Companion Merchandise** - Physical merchandise (stickers, posters, plushies)
- [ ] **Blockchain Integration** - NFT companions, crypto payments, token gating
- [ ] **Advanced Games** - More interactive games (chess, trivia, word games)
- [ ] **Companion Journaling** - Daily journal prompts and reflections
- [ ] **Mood Tracking** - Companion tracks user mood over time and offers support
- [ ] **Dream Journal** - Log and analyze dreams with companion insights
- [ ] **Goal Setting** - Set and track goals with companion accountability
- [ ] **Meditation & Mindfulness** - Guided meditations and breathing exercises
- [ ] **Storytelling Mode** - Companions can tell interactive stories (choose your own adventure)
- [ ] **Role-Playing Scenarios** - Practice job interviews, presentations, difficult conversations

### Infrastructure & DevOps

- [ ] **Auto-scaling** - Dynamic scaling based on load (CPU, memory, queue depth)
- [ ] **Multi-region Deployment** - Deploy to multiple AWS regions for lower latency
- [ ] **CDN Integration** - CloudFront or CloudFlare for static assets and media
- [ ] **Rate Limiting v2** - More sophisticated rate limiting (per-companion, per-feature)
- [ ] **Improved Observability** - Better dashboards, alerts, and trace analysis
- [ ] **Cost Optimization** - Reduce AI provider costs with caching, batching, cheaper models
- [ ] **Database Sharding** - Horizontal sharding for PostgreSQL as data grows
- [ ] **Read Replicas** - PostgreSQL read replicas for analytics queries
- [ ] **Backup & Disaster Recovery** - Automated backups, point-in-time recovery
- [ ] **Load Testing** - Regular load testing to identify bottlenecks
- [ ] **Security Audit** - Third-party security audit and penetration testing
- [ ] **SOC 2 Compliance** - Security and compliance certification
- [ ] **GDPR Compliance Tools** - Data export, right to deletion automation

### Bug Fixes & Technical Debt

- [ ] **Improve WebSocket Reconnection** - Better handling of connection drops
- [ ] **Optimize Image Generation** - Reduce latency for image generation requests
- [ ] **Reduce Memory Leaks** - Profile and fix memory leaks in long-running processes
- [ ] **Database Query Optimization** - Add indexes, optimize slow queries
- [ ] **Refactor Gateway Routes** - Break down large route files into smaller modules
- [ ] **Improve Error Messages** - More helpful error messages for users and developers
- [ ] **Add More Tests** - Increase test coverage to 90%+
- [ ] **Upgrade Dependencies** - Keep dependencies up to date
- [ ] **Remove Dead Code** - Clean up unused code and files
- [ ] **Improve Documentation** - Add JSDoc comments, improve README sections

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Built with Claude Code** | [GitHub](https://github.com/jaketracey/campfire) | [Documentation](https://docs.campfire.com)

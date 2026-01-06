# Campfire

**AI Companion Platform** - Create personalized AI companions with unique personalities, voices, and visual styles.

Campfire is a full-stack platform for building and interacting with customizable AI companions. Users can create companions with distinct personalities, voices, and visual identities, then engage in real-time conversations with voice support, memory persistence, and dynamic image generation.

## Features

- **Personalized Companions** - Create AI companions with custom names, personalities, voices, and visual styles
- **Real-time Voice Conversations** - Speech-to-text and text-to-speech powered by Deepgram and ElevenLabs
- **Dynamic Image Generation** - Generate companion avatars and contextual images with Flux/DALL-E
- **Persistent Memory** - Companions remember conversations and build relationships over time
- **Knowledge Graph** - Structured relationship tracking between entities mentioned in conversations
- **Event Sourcing** - Complete audit trail of all interactions for debugging and analytics
- **Multi-provider LLM Support** - Anthropic Claude (primary) with OpenAI fallback

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Clients                                      │
│                             (Web App)                                    │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Gateway Service                                   │
│              (Fastify + WebSocket + REST API)                             │
│                         Port 4000/4001                                    │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
          ┌───────────┼───────────────────┐
          │           │                   │
          ▼           ▼                   ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────────┐
│ Orchestrator│ │   Workers   │ │    PostgreSQL   │
│  (FastAPI)  │ │  (BullMQ)   │ │   + pgvector    │
│  Port 5000  │ │             │ │    Port 5432    │
└──────┬──────┘ └──────┬──────┘ └─────────────────┘
       │               │
       │               ▼
       │        ┌─────────────┐
       │        │    Redis    │
       │        │  Port 6379  │
       │        └─────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          AI Provider APIs                                 │
│     Anthropic │ OpenAI │ Deepgram │ ElevenLabs │ FAL │ Replicate        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Monorepo** | pnpm workspaces + Turborepo |
| **Gateway** | Fastify 5, WebSocket, OpenTelemetry |
| **Web App** | Next.js 16, React 19, Radix UI, TanStack Query |
| **Orchestrator** | Python 3.11+, FastAPI, Pydantic |
| **Workers** | BullMQ, ioredis |
| **Database** | PostgreSQL 18 + pgvector |
| **Cache/Queue** | Redis 7 |
| **Infrastructure** | AWS ECS Fargate, S3, SES, CloudWatch |
| **CI/CD** | GitHub Actions |

## Project Structure

```
campfire/
├── packages/
│   ├── gateway/          # API Gateway + WebSocket server (TypeScript)
│   ├── web/              # Main web application (Next.js)
│   ├── orchestrator/     # AI orchestration service (Python)
│   ├── workers/          # Background job processors (TypeScript)
│   └── shared/           # Shared types and schemas (TypeScript)
├── infra/
│   ├── aws-cli/          # AWS infrastructure scripts (dev/staging/prod)
│   ├── docker/           # Dockerfiles and compose configs
│   └── scripts/          # Deployment and utility scripts
├── docs/                 # Documentation
├── fixtures/             # Test fixtures and sample data
└── .github/workflows/    # CI/CD pipelines
```

## Quick Start

### Prerequisites

- Node.js >= 22.0.0
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

## Development

### Available Scripts

```bash
# Development
pnpm dev              # Start all services in development mode
pnpm build            # Build all packages
pnpm typecheck        # Run TypeScript type checking
pnpm lint             # Run ESLint across all packages
pnpm test             # Run all tests

# Database
pnpm db:migrate       # Run database migrations
pnpm db:migrate:down  # Rollback last migration
pnpm db:seed          # Seed database with sample data

# Docker
pnpm docker:up        # Start PostgreSQL and Redis containers
pnpm docker:down      # Stop containers
pnpm docker:build     # Build all service images
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

## Services

### Gateway (`packages/gateway`)

The API gateway handles all client communication:

- **REST API** - CRUD operations for users, companions, sessions, memories
- **WebSocket** - Real-time bidirectional communication for conversations
- **Authentication** - JWT-based auth with session management
- **Rate Limiting** - Per-user request throttling
- **Observability** - OpenTelemetry tracing and structured logging

### Orchestrator (`packages/orchestrator`)

Python service for AI pipeline orchestration:

- **Turn Management** - Handles conversation flow and context
- **LLM Integration** - Anthropic Claude with OpenAI fallback
- **Tool Routing** - Memory operations, image generation, knowledge graph
- **Safety Gate** - Content moderation and safety checks
- **Provider Abstraction** - Unified interface for STT/TTS/image providers

### Workers (`packages/workers`)

Background job processors using BullMQ:

- **Email Worker** - Transactional emails via Amazon SES
- **Embeddings Worker** - Vector embeddings for semantic search
- **Knowledge Graph Worker** - Entity extraction and relationship mapping
- **Vault Projection** - Companion memory summarization

### Web (`packages/web`)

Main user-facing Next.js application:

- **Onboarding Flow** - 7-step companion creation wizard
- **Chat Interface** - Real-time conversation with voice support
- **Dashboard** - Companion management and analytics
- **Theme Support** - Light/dark mode with system preference detection

## Event System

Campfire uses event sourcing for all state changes. Events are immutable records of everything that happens:

```typescript
// Event categories
SESSION    // session.started, session.ended
MESSAGE    // user.message.created, agent.message.created
LLM        // llm.requested, llm.token, llm.final
MEMORY     // memory.proposed, memory.written, memory.deleted
TOOL       // tool.called, tool.succeeded, tool.failed
AVATAR     // avatar.requested, avatar.generated
TTS        // tts.requested, tts.chunk.ready, tts.completed
BILLING    // billing.checkout.completed, billing.subscription.updated
```

## Companion Spec

Each companion is defined by a comprehensive specification:

```typescript
CompanionSpec {
  identity: {
    name, pronouns, tagline, addressStyle
  },
  personality: {
    archetype, traits, communication style
  },
  voiceProfile: {
    provider, voiceId, speed, pitch
  },
  visualStyle: {
    styleType, palette, constraints
  },
  boundaries: {
    topics, relationship pacing
  },
  memoryConsent: {
    what to remember, retention policies
  }
}
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
# ... continue with remaining scripts
```

## Configuration

### Environment Variables

See [.env.example](.env.example) for all configuration options:

| Category | Variables |
|----------|-----------|
| Database | `DATABASE_URL`, `DATABASE_POOL_*` |
| Redis | `REDIS_URL` |
| Auth | `JWT_SECRET`, `SESSION_SECRET` |
| LLM | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| Voice | `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` |
| Images | `FAL_API_KEY`, `REPLICATE_API_TOKEN` |
| Storage | `S3_MEDIA_BUCKET`, `S3_VAULT_BUCKET` |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Analytics | `POSTHOG_API_KEY`, `GTM_CONTAINER_ID` |
| Email | `SES_SENDER_EMAIL`, `SES_REGION` |

### Feature Flags

```bash
FEATURE_IMAGE_GENERATION=true
FEATURE_VOICE_CONVERSATIONS=true
FEATURE_KNOWLEDGE_GRAPH=true
FEATURE_VAULT_PROJECTION=true
```

## API Reference

### REST Endpoints

```
POST   /auth/login           # User authentication
POST   /auth/register        # User registration
GET    /companions           # List user's companions
POST   /companions           # Create new companion
GET    /companions/:id       # Get companion details
PATCH  /companions/:id       # Update companion
GET    /sessions             # List conversation sessions
POST   /sessions             # Start new session
GET    /memories             # List memories
POST   /imagegen             # Generate images
```

### WebSocket Protocol

```typescript
// Client → Server
{ type: 'audio.chunk', data: base64Audio }
{ type: 'message.send', content: string }
{ type: 'session.start', companionId: string }

// Server → Client
{ type: 'stt.partial', transcript: string }
{ type: 'llm.token', token: string }
{ type: 'tts.chunk', audio: base64Audio }
{ type: 'memory.written', memory: Memory }
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `pnpm test`
5. Run type checking: `pnpm typecheck`
6. Commit with conventional commits: `git commit -m "feat: add new feature"`
7. Push and create a pull request

### Commit Convention

```
feat: add new feature
fix: bug fix
docs: documentation changes
style: formatting, missing semicolons, etc.
refactor: code restructuring without feature changes
test: adding or updating tests
chore: maintenance tasks
```

## License

MIT

---

Built with Claude Code

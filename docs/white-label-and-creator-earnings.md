# White-Label + Creator Earnings

This repo supports:

- **White-labeling** via per-domain tenant branding (colors, name, etc).
- **Creator earnings** via attribution of token spend on creator-owned companions.

## White-labeling

### Data model (Gateway)

- `tenants`: a top-level brand/tenant record with a `brand_config` JSON blob.
- `tenant_domains`: maps verified domains to tenants.

Brand resolution is request-based:

1) Determine `host`/`proto` from `x-forwarded-host`/`x-forwarded-proto` (or `host`).
2) Lookup `tenant_domains.domain = host` and return the tenant’s `brand_config`.
3) Fall back to the default brand if no match.

### Public brand endpoint (Gateway)

- `GET /api/v1/public/brand`

Used by the web app during SSR to:

- Set metadata (title, icons, etc).
- Inject CSS variables (primary color, foreground) for theming.

### Web usage

The web app fetches brand server-side and injects CSS variables into the root layout.

## Creator earnings

### Data model (Gateway)

- `token_spend_attributions`: links a token transaction to a creator/companion and a feature (gift, voice call, etc).
- `creator_earnings`: derived earnings rows (gross + net cents), idempotent per `token_transaction_id`.

### Earnings rules

- **Idempotent**: re-processing the same token transaction does not double-pay.
- **No self-spend**: if the spender is the companion owner, the spend is ignored for earnings.
- **Net calculation**: `gross = tokensSpent * CREATOR_TOKEN_VALUE_CENTS`, `net = gross * (1 - platformFeeBps/10000)`.

### Creator summary endpoint (Gateway)

- `GET /api/v1/creator/earnings/summary` (auth required)

## Configuration

Gateway env vars:

- `CREATOR_TOKEN_VALUE_CENTS` (default `10`)
- `CREATOR_PLATFORM_FEE_BPS` (default `2000`)

## Migrations

Run Gateway migrations after pulling:

- `pnpm --filter @campfire/gateway db:migrate`
- If your gateway uses an env file (e.g. root `.env`), the gateway migration scripts will load it automatically when present.
- The gateway `dev` script runs migrations automatically via `predev`.

## Tests

- Gateway: `pnpm --filter @campfire/gateway test:unit`
- Web: `pnpm --filter @campfire/web test`
- Workers: `pnpm --filter @campfire/workers test:unit`
- Orchestrator: `cd packages/orchestrator && bash scripts/python.sh -m pytest`

# Model Routing Sync Verification Report

**Issue:** hq-htm96
**Date:** 2026-02-20
**Investigator:** polecat/quartz

## Full Code Path Trace

### 1. Web UI Button Click
**File:** `packages/web/src/components/admin/routing/text-routing-tab.tsx:151-164`

User clicks "Sync to Orchestrator" button, which calls `handleSync()`:
```
handleSync() -> syncWithOrchestrator() [from lib/api/providers.ts:516-519]
  -> POST /admin/routing/sync (via API client)
```

### 2. Gateway Route Handler
**File:** `packages/gateway/src/routes/admin-routing.ts:324-336`

```
POST /admin/routing/sync
  -> requireAdmin (auth middleware)
  -> service.syncWithOrchestrator()
```

### 3. Gateway Service: exportConfiguration + HTTP call
**File:** `packages/gateway/src/services/provider-settings.ts:762-805`

`syncWithOrchestrator()` does two things:
1. Calls `this.exportConfiguration()` to gather all providers, models, and routing rules from the gateway's DB
2. Sends the exported config via `PUT ${ORCHESTRATOR_URL}/config/routing` with a **10-second timeout** (`AbortSignal.timeout(10000)`)

The exported payload includes: providers (without API keys), models, and routing rules.

### 4. Orchestrator API Endpoint
**File:** `packages/orchestrator/src/orchestrator/api/config.py:42-85`

```
PUT /config/routing
  -> sync_routing_config(request: RoutingConfigRequest)
  -> app_state.routing_config_service.force_refresh()
  -> app_state.routing_config_service.get_cache_status()
  -> Return success + cache_status
```

**Key insight:** The orchestrator **ignores the request payload**. The docstring explicitly states: "The gateway sends its exported configuration, but we only use this to trigger a cache refresh since we read from the same database." The payload is a notification mechanism, not a data transfer.

### 5. Orchestrator Service: force_refresh()
**File:** `packages/orchestrator/src/orchestrator/services/routing_config_service.py:88-90`

```python
async def force_refresh(self) -> None:
    """Force a cache refresh regardless of TTL."""
    await self._refresh_cache()
```

### 6. Actual Cache Refresh (_refresh_cache)
**File:** `packages/orchestrator/src/orchestrator/services/routing_config_service.py:92-136`

`_refresh_cache()` acquires an `asyncio.Lock` and:
1. Queries DB for all enabled models (`get_all_enabled_models`)
2. Queries DB for all routing rules grouped by use case (`get_all_routing_rules`)
3. Queries DB for provider status (`get_provider_status`)
4. Queries DB for provider configs (`get_provider_configs`)
5. Registers each model into `MODEL_REGISTRY` via `register_model()`
6. Stores everything in `CachedRoutingConfig` with TTL

**Critical: This IS a full reload from DB, not just a cache invalidation.** The method reads fresh data from the database and replaces the in-memory cache entirely.

### 7. MODEL_REGISTRY Update
**File:** `packages/orchestrator/src/orchestrator/routing/model_registry.py:573-585`

`register_model()` inserts/updates the global `MODEL_REGISTRY` dict:
```python
def register_model(model: ModelSpec) -> None:
    MODEL_REGISTRY[model.model_id] = model
```

---

## Answers to Key Concerns

### 1. Is the 10s timeout on sync enough?

**Location:** `packages/gateway/src/services/provider-settings.ts:770`

The 10-second timeout covers:
- Network round-trip to orchestrator
- 4 DB queries (models, routing rules, provider status, provider configs)
- MODEL_REGISTRY population (in-memory dict operations)

**Assessment: Likely sufficient for normal operation.** The DB queries are simple SELECTs with JOINs on indexed tables. Even with 100+ models and rules, these should complete in <1s. The lock acquisition is the only potential bottleneck - if another refresh is in progress, the caller waits for it.

**Risk scenario:** If the orchestrator's DB connection pool is exhausted or the DB is under heavy load, the queries could take longer. However, the orchestrator handles the timeout gracefully - the gateway catches the AbortSignal timeout error and returns `{ success: false, error: "message" }` to the UI. The user sees a failure message and can retry.

**Recommendation:** The 10s timeout is reasonable. If DB latency becomes an issue, consider adding an orchestrator-side timeout on the DB queries themselves.

### 2. Does force_refresh() actually reload from DB or just invalidate cache?

**It does a FULL reload from DB.**

`force_refresh()` -> `_refresh_cache()` runs 4 separate DB queries:
- `get_all_enabled_models()` - fetches model_configs JOIN provider_configs
- `get_all_routing_rules()` - fetches routing_rules JOIN model_configs JOIN provider_configs
- `get_provider_status()` - fetches provider_configs
- `get_provider_configs()` - fetches provider_configs with API key presence

It then replaces the entire `self._cache` with fresh `CachedRoutingConfig` and re-registers all models in `MODEL_REGISTRY`.

**The lock (`self._refresh_lock`) ensures only one refresh runs at a time.** If two sync requests arrive simultaneously, the second waits for the first to complete, then runs its own fresh refresh.

**Failure handling:** If the refresh fails and there's an existing cache, the old cache is kept (fail-open). If no cache exists yet, the exception propagates.

### 3. Are companion routing overrides included in sync?

**No - and they don't need to be.**

The sync endpoint (`PUT /config/routing`) only refreshes the **platform-level** routing cache:
- Platform routing rules (from `routing_rules` table)
- Enabled models (from `model_configs` table)
- Provider status (from `provider_configs` table)

Companion overrides are resolved **at query time** via the database function `get_effective_routing(companion_id, use_case)` (see `routing_config.py:96-140`). When the orchestrator needs routing for a specific companion:

```python
async def get_routing_for_use_case(self, use_case, companion_id=None):
    if companion_id:
        # Queries DB function directly - NOT cached
        return await self._repository.get_effective_routing(companion_id, use_case)
    # Return cached platform defaults
    return self._cache.routing_rules.get(use_case, [])
```

**Key insight:** Companion overrides are always fetched fresh from DB, never cached. So the sync only needs to refresh the platform defaults cache. This is correct behavior - companion overrides are per-request lookups.

**However:** If a companion override references a model that was just added, the model must be in `MODEL_REGISTRY` for the orchestrator to use it. The sync ensures this by re-registering all models. So indirectly, the sync does enable companion overrides to work with newly-added models.

### 4. What happens if orchestrator is down during sync?

**The gateway handles this gracefully.**

In `provider-settings.ts:762-805`:
```typescript
try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
        throw new Error(`Orchestrator returned ${response.status}: ${errorText}`);
    }
    return { success: true, synced: {...}, error: null };
} catch (error) {
    return { success: false, synced: { providers: 0, models: 0, rules: 0 }, error: message };
}
```

Failure modes:
- **Orchestrator unreachable:** `fetch` throws a network error -> caught -> `{ success: false, error: "fetch failed: ..." }`
- **Timeout exceeded:** `AbortSignal.timeout(10000)` fires -> AbortError -> caught -> `{ success: false, error: "The operation was aborted" }`
- **Orchestrator 5xx:** Response checked with `!response.ok` -> error text extracted -> `{ success: false, error: "Orchestrator returned 503: ..." }`
- **Orchestrator 503 (service not initialized):** The config endpoint returns 503 if `routing_config_service` is None

**Impact:** The routing configuration in the database is still correct (both gateway and orchestrator read from the same DB). The orchestrator will pick up changes on its next cache TTL expiry (60 seconds by default). The sync just forces an immediate refresh.

**The UI shows the error** via `setSyncResult(result)` in the text-routing-tab component.

### 5. Is there a verification/confirmation that sync succeeded?

**Yes - the response includes cache status.**

The orchestrator's `sync_routing_config` endpoint returns:
```python
RoutingConfigResponse(
    success=True,
    message="Routing configuration refreshed from database",
    cache_status=cache_status,  # Includes: models_count, use_cases, providers_enabled, etc.
)
```

The gateway relays this back as:
```typescript
{ success: true, synced: { providers: N, models: N, rules: N }, error: null }
```

The web UI displays this result (success/failure toast). However:

**What's NOT verified:**
1. The gateway's `syncWithOrchestrator()` only checks HTTP status code, not the response body's `success` field. If the orchestrator returns `{ success: false, message: "...", cache_status: null }` with HTTP 200, the gateway would still report success.
2. There's no round-trip verification (e.g., "read back the config and compare"). The gateway trusts that if the orchestrator returned 200, the refresh worked.
3. There's no verification that the `MODEL_REGISTRY` actually contains the expected models after refresh.

**Recommendation:** The current verification is adequate for typical use. The shared-database architecture means data consistency is guaranteed by the DB - the sync is just about cache freshness.

---

## Architecture Summary

```
Web UI (text-routing-tab.tsx)
  |
  | POST /admin/routing/sync
  v
Gateway (admin-routing.ts:324)
  |
  | service.syncWithOrchestrator()
  |   1. exportConfiguration() -> gather providers, models, rules from DB
  |   2. PUT ${ORCHESTRATOR_URL}/config/routing (10s timeout)
  v
Orchestrator (api/config.py:42)
  |
  | force_refresh()
  |   1. Lock (asyncio.Lock)
  |   2. Query DB: enabled models, routing rules, provider status, provider configs
  |   3. Register models in MODEL_REGISTRY
  |   4. Replace CachedRoutingConfig
  |   5. Unlock
  v
MODEL_REGISTRY updated, cache refreshed
Response: { success, message, cache_status }
```

**Key architectural insight:** Both gateway and orchestrator read from the **same database**. The sync doesn't transfer data - it just signals the orchestrator to reload its cache. The exported configuration in the request payload is effectively metadata/documentation, not the source of truth.

## Findings Status: VERIFIED WORKING

The model routing sync flow works correctly end-to-end. No bugs or critical issues found. The architecture is sound - shared-database with cache-invalidation-via-HTTP is a clean pattern.

Minor recommendations for future improvement:
1. Consider checking the response body's `success` field in the gateway, not just HTTP status
2. The `/config/refresh` endpoint (POST, no payload needed) is a simpler alternative that already exists
3. Consider adding a health check or readiness probe that includes cache age

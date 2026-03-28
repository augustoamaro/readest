# Translation Service Extraction

## Goal

Extract the core translation pipeline out of React so the reader and other UI callers stop owning provider selection, cache orchestration, preprocessing, provider dispatch, and polishing logic directly. The target state for this step is a thin `useTranslator` hook delegating translation work to a pure service while keeping current behavior and UI contracts intact.

## Why useTranslator was too coupled

- `useTranslator.ts` mixed React state management with the translation pipeline itself.
- The hook directly handled preprocessing, cache lookups, cache writes, provider dispatch, quota fallback, and polishing.
- That made the core translation behavior harder to test without React and harder to reuse outside hooks/components.
- It also meant future work such as local providers, queueing, or chapter translation would have to start from a React-facing module instead of a reusable service boundary.

## What moved to the service

- Added `apps/readest-app/src/services/translators/service.ts`.
- Moved provider selection resolution into `resolveTranslatorSelection(...)`.
- Moved the main translation pipeline into `translateTexts(...)`, including:
  - preprocessing
  - cache lookup
  - provider dispatch
  - cache persistence
  - result recomposition in original order
  - polishing
- Moved quota fallback metadata into the service via `TranslationServiceError`, so the hook only reacts to the structured error for UI concerns like toast display and state update.

## Files changed

- `apps/readest-app/src/services/translators/service.ts`
  - New pure translation service layer.
- `apps/readest-app/src/services/translators/index.ts`
  - Re-exports the service API.
- `apps/readest-app/src/hooks/useTranslator.ts`
  - Reduced to a thin React adapter around the service.
- `apps/readest-app/src/__tests__/services/translator-service.test.ts`
  - Unit tests for provider resolution, cache behavior, dispatch, and quota fallback.

## Why behavior should remain the same

- The hook return shape is unchanged: `translate`, `translator`, `translators`, and `loading`.
- Providers were not changed.
- Cache implementation was not changed.
- The same preprocess and polish utilities are still used.
- The same quota error still results in a UI toast and fallback toward `azure`; the decision metadata now comes from the service instead of being hardcoded in the hook.
- Validation completed:
  - `pnpm test -- --watch=false src/__tests__/services/translator-service.test.ts`
  - `pnpm lint`

## Remaining coupling

- `useTranslator.ts` still owns React state, loading state, and UI-side toast handling.
- The service still imports the existing cache module, and that cache module performs startup work tied to IndexedDB availability. This showed up during unit tests as harmless cache-init warnings in the non-browser test environment.
- Provider availability and quota flags still live on mutable provider objects, so provider state remains process-global.

## Next step after this

Introduce a small application-facing translation facade above the raw provider service, so the hook and future non-React callers can depend on one stable command-style API. That would be the right place to add queueing, visible-block batching, chapter translation orchestration, or alternate provider backends without pushing those concerns back into React.

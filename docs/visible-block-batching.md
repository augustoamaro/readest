# Visible Block Batching

## Goal

Introduce conservative batching for inline translation so the reader stops dispatching one translation request per visible element whenever a small group can be translated safely together. This validates the translation facade as the place for the first real application-level orchestration policy, without changing providers, cache semantics, or inline rendering behavior.

## Why inline translation was too granular

- `useTextTranslation.ts` previously translated one queued element per provider call.
- The hook already detected visible blocks in groups, but it still dispatched translation at a per-element granularity.
- That meant extra provider calls and kept batching/orchestration policy inside the reader hook instead of behind the translation boundary.

## What batching was introduced

- `translationFacade.translateVisibleBlocks(...)` now accepts structured visible-block input and returns structured results that preserve block identity and ordering.
- `useTranslator` now exposes `translateVisibleBlocks(...)` and applies the same quota-error handling used by `translate(...)`.
- `useTextTranslation.ts` now drains the visible translation queue in small batches:
  - up to `3` elements per batch
  - up to `2` concurrent batches
- The hook still owns DOM concerns such as source-node updates and inline wrapper rendering, but it no longer dispatches each element individually when a grouped provider call is safe.

## Files changed

- `apps/readest-app/src/services/translators/facade.ts`
  - `translateVisibleBlocks(...)` now uses structured block mapping instead of a plain string alias.
- `apps/readest-app/src/hooks/useTranslator.ts`
  - Added `translateVisibleBlocks(...)` as a hook-facing wrapper over the facade.
- `apps/readest-app/src/app/reader/hooks/useTextTranslation.ts`
  - Replaced one-element dispatch with small visible-block batches while preserving DOM rendering.
- `apps/readest-app/src/__tests__/services/translation-facade.test.ts`
  - Added/updated tests for structured visible-block batching behavior.

## Why behavior should remain the same

- Providers were not changed.
- Cache behavior was not changed; batched translation still goes through the existing service and cache pipeline.
- Inline translation still:
  - observes visible text nodes
  - creates the same inline translation wrappers
  - preserves original/source node handling
  - preserves translation order relative to the queued elements in each batch
- The batching is intentionally small to avoid visible UX changes.
- Validation completed:
  - `pnpm test -- --watch=false src/__tests__/services/translation-facade.test.ts src/__tests__/services/translator-service.test.ts`
  - `pnpm lint`

## Remaining limitations

- Queue ownership still lives in `useTextTranslation.ts`; only the first orchestration step moved outward.
- Batch size and concurrency are still hook-local constants.
- There is still no explicit cancellation or abort behavior for in-flight batches.
- A failed provider call still fails the whole batch.
- The cache module still performs startup work at import time, which shows up as IndexedDB warnings in non-browser tests.

## Next step after this

Move queue lifecycle and cancellation semantics into the translation boundary, likely by introducing a small inline translation coordinator above the facade or by extending the facade with queue-aware commands. That would let the reader hook focus more narrowly on DOM observation and rendering while the translation layer owns scheduling policy.

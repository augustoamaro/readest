# Translation Facade Introduction

## Goal

Introduce a stable application-facing translation facade above the raw translation service so hooks and UI code can depend on one small command-oriented API instead of knowing about provider registry access, provider selection fallback, or low-level orchestration details. This step keeps the current behavior intact while creating a clearer seam for future queueing, batching, and local-provider integration.

## Why the service alone is not enough

- `service.ts` extracted the translation pipeline, but it is still a low-level module.
- React-facing code still needed to know which service function to call and how to combine provider registry lookups with service calls.
- UI components such as the reader popup and language panel still had direct knowledge of provider listing and selection rules.
- A facade gives the application one stable surface that can later absorb queueing, visible-block batching, chapter orchestration, and local-provider routing without leaking those concerns back into hooks or components.

## What the facade abstracts

- Added `apps/readest-app/src/services/translators/facade.ts`.
- The facade now provides a small application API:
  - `listProviders()`
  - `listSelectableProviders(token?)`
  - `getProvider(name)`
  - `resolveProviderSelection({ provider, token })`
  - `translateBatch(...)`
  - `translateSelection(...)`
  - `translateVisibleBlocks(...)`
  - `translateChapter(...)`
- These methods hide direct calls to the lower-level service functions and establish stable command names for future growth.
- `useTranslator.ts` now depends on the facade instead of calling the raw service directly.
- Reader UI no longer reaches into the raw provider registry directly for the popup flow, and the language panel now reads provider lists through the facade as well.

## Files changed

- `apps/readest-app/src/services/translators/facade.ts`
  - New application-facing translation facade.
- `apps/readest-app/src/services/translators/index.ts`
  - Re-exports the facade API.
- `apps/readest-app/src/hooks/useTranslator.ts`
  - Now depends on the facade instead of the raw service functions.
- `apps/readest-app/src/app/reader/components/annotator/TranslatorPopup.tsx`
  - Uses facade-based provider resolution.
- `apps/readest-app/src/components/settings/LangPanel.tsx`
  - Uses facade-based provider listing/filtering.
- `apps/readest-app/src/__tests__/services/translation-facade.test.ts`
  - Unit tests for the facade contract.

## Why behavior should remain the same

- The public hook contract is unchanged: `useTranslator` still returns `translate`, `translator`, `translators`, and `loading`.
- Providers were not changed.
- The lower-level translation service and cache behavior were not rewritten.
- The popup still resolves invalid/unavailable provider selections to the first selectable provider.
- The language panel still displays all providers and still computes the effective current option using auth/quota availability.
- Validation completed:
  - `pnpm test -- --watch=false src/__tests__/services/translation-facade.test.ts src/__tests__/services/translator-service.test.ts`
  - `pnpm lint`

## Remaining limitations

- The facade is intentionally thin. It defines stable commands, but it does not yet implement queueing, batching heuristics, or chapter orchestration policies.
- The cache module still performs startup work at import time, which shows up as IndexedDB warnings in non-browser unit tests.
- Provider quota/auth state still lives on mutable provider objects.
- `useTextTranslation.ts` and `TranslatorPopup.tsx` still use `useTranslator`; this is expected for now because the immediate goal was to stabilize the application boundary, not remove the hook.

## Next step after this

Move the first non-trivial orchestration concern into the facade, preferably visible-block batching or a small async translation queue used by inline translation. That will prove the facade is the right place for application policy before introducing a local provider backend.

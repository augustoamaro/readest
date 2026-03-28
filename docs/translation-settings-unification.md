# Translation Settings Unification

## Goal

Align the reader's two active translation flows behind one canonical preference source without changing provider behavior or the existing translation pipeline. The scope of this step is limited to `translationProvider` and `translateTargetLang`. The chosen canonical source is `viewSettings`, because inline translation already depends on it and it is the persistence path already used by the reader settings UI.

## What was inconsistent before

- `TranslatorPopup.tsx` read translation preferences from `settings.globalReadSettings`.
- `useTextTranslation.ts` read the same preferences from `viewSettings`.
- `TranslatorPopup.tsx` mutated the settings store in memory, but did not persist through `saveViewSettings(...)` like the rest of the reader.
- `LangPanel.tsx` already persisted translation preferences through `viewSettings`, so the popup was the outlier.
- Result: popup translation and inline translation could disagree on provider and target language, and popup changes did not reliably follow the same persistence strategy as the rest of the app.

## What changed

- Added a small canonical helper at `apps/readest-app/src/helpers/translationSettings.ts`.
- `getTranslationPreferences(...)` now provides the shared read path for `translationProvider` and `translateTargetLang`.
- `saveTranslationPreference(...)` now provides the shared write path and delegates to `saveViewSettings(...)`.
- `TranslatorPopup.tsx` now:
  - receives `bookKey`
  - reads translation preferences from `viewSettings`
  - persists preference changes via `saveViewSettings(...)` semantics
  - syncs local UI state from canonical `viewSettings` values
- `useTextTranslation.ts` now reads provider and target language through the same helper, still backed by `viewSettings`.
- `LangPanel.tsx` now uses the same translation-preference helper for writes, so reader settings and popup settings share the same persistence wrapper.
- `useTranslator.ts` and the provider registry were left unchanged.

## Files changed

- `apps/readest-app/src/helpers/translationSettings.ts`
  - New canonical helper for reading and saving translation preferences.
- `apps/readest-app/src/app/reader/components/annotator/TranslatorPopup.tsx`
  - Migrated from `settings.globalReadSettings` to canonical `viewSettings` preferences.
- `apps/readest-app/src/app/reader/components/annotator/Annotator.tsx`
  - Passes `bookKey` into `TranslatorPopup`.
- `apps/readest-app/src/app/reader/hooks/useTextTranslation.ts`
  - Reads provider and target language via the canonical helper.
- `apps/readest-app/src/components/settings/LangPanel.tsx`
  - Uses the same helper for translation preference persistence.
- `apps/readest-app/src/__tests__/helpers/translationSettings.test.ts`
  - Covers helper fallback behavior and persistence delegation.

## Why this is safe

- The provider registry, translation API calls, caching, and rendering pipeline were not changed.
- The inline translation hook still uses `viewSettings`; this patch only made the popup converge to the same source.
- Persistence now reuses the existing reader path, `saveViewSettings(...)`, instead of inventing a new storage mechanism.
- The refactor is narrow: only preference access and persistence changed.
- Validation completed:
  - `pnpm test -- --watch=false src/__tests__/helpers/translationSettings.test.ts`
  - `pnpm lint`

## Remaining limitations

- `globalReadSettings.translationProvider` and `globalReadSettings.translateTargetLang` still exist in the settings types and defaults. They are now legacy duplication for reader translation and were intentionally not removed in this step.
- Popup translation still keeps local React state for the currently selected provider and target language, but that state is now synchronized from canonical `viewSettings`.
- This step does not introduce provider abstraction changes, chapter translation, block prefetching policies, or local/GPU translation.

## Manual validation steps

1. Open a book and confirm inline translation is enabled.
2. In the reader language/settings panel, set provider `A` and target language `X`.
3. Trigger inline translation and confirm translated blocks use provider `A` and target language `X`.
4. Select text and open the translation popup. Confirm the popup selects also show provider `A` and target language `X`.
5. Change the popup provider to `B`. Close the popup and trigger inline translation again. Confirm inline translation now follows provider `B`.
6. Change the popup target language to `Y`. Confirm newly translated inline blocks and popup translations both use `Y`.
7. Reopen the reader or restart the app. Confirm provider `B` and target language `Y` persist.
8. Open the language/settings panel and confirm it shows the same provider and target language values selected in the popup.
9. Verify no regression in the existing flow:

- popup translation still returns translated text
- inline translation still injects translated blocks
- switching provider still respects auth/quota filtering

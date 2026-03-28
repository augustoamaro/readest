# Readest Translation Architecture Audit

## 1. Goal

This audit maps the current translation architecture in the checked-out Readest codebase before any functional changes are made.
The goal is to identify the real UI entry points, service boundaries, provider implementations, cache layers, and rendering flow that exist today.
The output is meant to reduce refactor risk for a future fork that supports local GPU translation, external API-key providers, and stronger local caching.
When something is not directly supported by code in this tree, it is marked as an inference and the validation gap is called out explicitly.

## 2. Current Translation Flow

### A. Selection translation popup

1. User selects text in the reader, uses the selection toolbar, uses the quick action, presses `Ctrl/Cmd+T`, or right-clicks a PDF selection.
2. `src/app/reader/hooks/useTextSelector.ts` captures the DOM `Selection`, builds a `TextSelection`, and calls `getAnnotationText`.
3. `src/app/reader/components/annotator/Annotator.tsx` extracts plain text from the selected `Range` with `getTextFromRange`, then passes it through `transformContent` with the `punctuation` transformer in reverse mode.
4. `Annotator.tsx` opens `TranslatorPopup.tsx`.
5. `src/app/reader/components/annotator/TranslatorPopup.tsx` strips newlines from the selected text and calls `useTranslator().translate([input])`.
6. `src/hooks/useTranslator.ts` preprocesses the text, checks the client translation cache, calls the selected provider, stores results in the cache, polishes the translated output, and returns `string[]`.
7. `TranslatorPopup.tsx` renders the translated string in the popup.

### B. Inline reader translation

1. User enables translation from the header toggle or the Language settings panel.
2. `src/app/reader/components/FoliateViewer.tsx` mounts `useTextTranslation(bookKey, viewRef.current)`.
3. `src/app/reader/hooks/useTextTranslation.ts` walks text-bearing DOM elements in the reader, observes visible elements with `IntersectionObserver`, and schedules nearby elements for translation.
4. Each scheduled element is translated one element at a time through the same `useTranslator().translate([text])` hook path.
5. The translated result is appended back into the DOM as `.translation-target` nodes, and the original source nodes are either preserved or blanked depending on `showTranslateSource`.
6. Reader styles from `getStyles(...)` render the source text and translated text together as an inline bilingual block.

### C. TOC translation

1. `src/app/reader/components/sidebar/TOCView.tsx` also mounts `useTextTranslation(...)`, but against the TOC container instead of the iframe reader content.
2. The same queue, cache, and provider path is reused.
3. The result is rendered with the TOC-specific CSS class `translation-target-toc`.

### D. Provider-specific transport

- DeepL goes through Readest's API proxy at `getAPIBaseUrl() + '/deepl/translate'`.
- Azure, Google, and Yandex call external services directly from the client or from Tauri's HTTP plugin.

## 3. Relevant Files

| File                                                                       | Responsibility                                          | Important notes                                                                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src/hooks/useTranslator.ts`                              | Central translation hook used by popup and inline flows | Owns preprocessing, client cache lookup, provider dispatch, cache writes, polishing, and DeepL quota fallback behavior.                              |
| `apps/readest-app/src/services/translators/types.ts`                       | Provider contract                                       | `TranslationProvider` is the current provider abstraction. It is intentionally small: `name`, `label`, auth flags, quota flag, and `translate(...)`. |
| `apps/readest-app/src/services/translators/providers/index.ts`             | Provider registry                                       | This is the main extension seam for adding a new provider. `createTranslator(...)` only validates name consistency.                                  |
| `apps/readest-app/src/services/translators/providers/deepl.ts`             | DeepL provider                                          | Hard-wired to Readest's API proxy, requires auth token, tracks daily quota, and can optionally use backend cache.                                    |
| `apps/readest-app/src/services/translators/providers/azure.ts`             | Azure provider                                          | Direct client integration; gets a Microsoft auth token from `edge.microsoft.com` and translates each line individually.                              |
| `apps/readest-app/src/services/translators/providers/google.ts`            | Google provider                                         | Direct client integration; translates each line individually through `translate.googleapis.com`.                                                     |
| `apps/readest-app/src/services/translators/providers/yandex.ts`            | Yandex provider                                         | Direct client integration to `translate.toil.cc`, currently pinned to `service = 'yandexgpt'`.                                                       |
| `apps/readest-app/src/services/translators/cache.ts`                       | Client-side translation cache                           | Real local cache exists today: in-memory plus IndexedDB, with auto-preload and auto-prune on browser load.                                           |
| `apps/readest-app/src/app/reader/hooks/useTextTranslation.ts`              | Inline translation engine                               | Walks DOM nodes, observes visibility, queues work, translates one element at a time, and injects bilingual DOM blocks.                               |
| `apps/readest-app/src/app/reader/components/annotator/Annotator.tsx`       | Selection flow entry point                              | Selection toolbar, quick actions, keyboard shortcut binding, PDF right-click translation entry, popup placement.                                     |
| `apps/readest-app/src/app/reader/components/annotator/TranslatorPopup.tsx` | Selection translation UI                                | Uses global read settings, not view settings, for provider and target language. Important source of configuration coupling.                          |
| `apps/readest-app/src/app/reader/hooks/useTextSelector.ts`                 | Selection capture                                       | Converts DOM selections into `TextSelection` objects and prepares text for annotation/translation actions.                                           |
| `apps/readest-app/src/utils/sel.ts`                                        | Selection geometry and text extraction                  | `getTextFromRange(...)` extracts plain text from a `Range`; popup placement is also computed here.                                                   |
| `apps/readest-app/src/utils/walk.ts`                                       | Inline translation segmentation helper                  | Defines what a "translatable element" is for inline translation. This is element-based, not chapter-based.                                           |
| `apps/readest-app/src/utils/style.ts`                                      | Translation CSS                                         | Adds `.translation-target`, `.translation-target-block`, and `.translation-target-toc` styles for both reader iframe and top-level DOM.              |
| `apps/readest-app/src/components/settings/LangPanel.tsx`                   | Translation settings UI                                 | Controls inline translation enablement, provider, target language, source visibility, and TTS text mode.                                             |
| `apps/readest-app/src/app/reader/components/TranslationToggler.tsx`        | Reader toggle button                                    | Header-bar on/off switch for inline translation. Disabled for cases where translation is not available.                                              |
| `apps/readest-app/src/pages/api/deepl/translate.ts`                        | DeepL proxy backend                                     | Handles auth validation, plan/quota checks, optional Cloudflare KV cache, and upstream DeepL calls.                                                  |
| `apps/readest-app/src/services/environment.ts`                             | API base URL resolution                                 | Outside web dev mode, `getAPIBaseUrl()` resolves to Readest-hosted web API, not a local-only service.                                                |
| `apps/readest-app/src/services/constants.ts`                               | Defaults and language lists                             | Important because translation defaults differ between `ReadSettings` and `TranslatorConfig`.                                                         |
| `apps/readest-app/src/helpers/settings.ts`                                 | Persistence helper                                      | Inline translation settings are persisted through `saveViewSettings(...)`; popup translation settings are not.                                       |
| `apps/readest-app/src/app/reader/hooks/useTTSControl.ts`                   | TTS integration with translated text                    | When translation is enabled, TTS can prefer source, translated, or both.                                                                             |
| `apps/readest-app/src/services/tts/TTSController.ts`                       | Bilingual TTS filtering                                 | Uses `ttsTargetLang` to filter SSML by language.                                                                                                     |
| `packages/foliate-js/tts.js`                                               | SSML generation from DOM                                | Preserves `lang` attributes into generated SSML, which is why translated DOM nodes can participate in TTS language filtering.                        |
| `apps/readest-app/src/store/parallelViewStore.ts`                          | Parallel Read state                                     | Separate from translation; manages split-screen multi-book reading groups.                                                                           |
| `apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx`          | Parallel Read UI entry                                  | Confirms that Parallel Read is implemented as a separate feature and not as part of the translation pipeline.                                        |

## 4. Current Providers

### Provider abstraction

Current providers implement `TranslationProvider` from `src/services/translators/types.ts`:

- `name`
- `label`
- `authRequired?`
- `quotaExceeded?`
- `translate(texts, sourceLang, targetLang, token?, useCache?)`

Registry and type narrowing live in `src/services/translators/providers/index.ts`.

### Providers found

#### 1. DeepL

- File: `src/services/translators/providers/deepl.ts`
- Integration style: app proxy
- Transport: `getAPIBaseUrl() + '/deepl/translate'`
- Auth: required
- Batch behavior: sends the full `text[]` array in a single request
- Extra behavior:
  - checks subscription plan and daily quota
  - updates `quotaExceeded`
  - optionally supports backend cache via `use_cache`

#### 2. Azure Translator

- File: `src/services/translators/providers/azure.ts`
- Integration style: direct client/Tauri HTTP
- Transport:
  - fetches bearer token from `https://edge.microsoft.com/translate/auth`
  - then calls `https://api-edge.cognitive.microsofttranslator.com/translate`
- Auth: no Readest login required
- Batch behavior: translates each input line separately with `Promise.all`
- Extra behavior:
  - caches the Microsoft token in memory for 8 minutes

#### 3. Google Translate

- File: `src/services/translators/providers/google.ts`
- Integration style: direct client/Tauri HTTP
- Transport: `https://translate.googleapis.com/translate_a/single`
- Auth: no Readest login required
- Batch behavior: translates each input line separately with `Promise.all`

#### 4. Yandex Translate

- File: `src/services/translators/providers/yandex.ts`
- Integration style: direct client/Tauri HTTP
- Transport: `https://translate.toil.cc/v2/translate/`
- Auth: no Readest login required
- Batch behavior: translates each input line separately with `Promise.all`
- Extra behavior:
  - current service is hard-coded to `yandexgpt`
  - source language `AUTO` is converted to `en` because the endpoint does not accept auto-detect

### Important integration detail

`TRANSLATOR_LANGS` in `src/services/constants.ts` is shared UI metadata. It is not a provider-specific capability map. The current code does not model per-provider language support, max batch size, or rate limits.

## 5. UI Entry Points

### Selection translation

- `src/app/reader/components/annotator/AnnotationTools.tsx`
  - defines the `translate` action in the selection toolbar
- `src/app/reader/components/annotator/Annotator.tsx`
  - `handleTranslation()` opens `TranslatorPopup`
  - keyboard shortcut binding triggers `handleTranslation()`
  - PDF right-click can open translation directly
- `src/helpers/shortcuts.ts`
  - `Ctrl/Cmd+T` is bound to `onTranslateSelection`
- `src/app/reader/components/annotator/TranslatorPopup.tsx`
  - actual UI for popup translation

### Inline translation

- `src/app/reader/components/TranslationToggler.tsx`
  - header-bar toggle for reader translation
- `src/components/settings/LangPanel.tsx`
  - persistent settings for inline translation provider, target language, source visibility, and TTS read-aloud mode
- `src/app/reader/components/FoliateViewer.tsx`
  - mounts `useTextTranslation(...)` for main reader content
- `src/app/reader/components/sidebar/TOCView.tsx`
  - mounts `useTextTranslation(...)` for TOC labels

### Related but not primary

- `src/components/UpdaterWindow.tsx`
  - also reuses `useTranslator`, but for translating release notes, not book content

## 6. Data Flow

### A. How text leaves the book for selection translation

1. `useTextSelector.ts` receives a browser `Selection`.
2. `Annotator.tsx` calls `getTextFromRange(range, rejectTags)`:
   - for Japanese, ruby annotation tags (`rt`) are excluded
3. `Annotator.tsx` passes the plain text into `transformContent(...)` with:
   - `transformers: ['punctuation']`
   - `reversePunctuationTransform: true`
4. The resulting plain string is stored on `selection.text`.
5. `TranslatorPopup.tsx` collapses line breaks with `text.replaceAll('\n', '').trim()`.
6. `useTranslator.ts` handles provider dispatch and caching.

### B. How text leaves the book for inline translation

1. `useTextTranslation.ts` calls `walkTextNodes(view, ['pre', 'code', 'math'])`.
2. `walkTextNodes(...)` collects DOM elements that:
   - have direct text nodes
   - or contain direct `span` text
   - or are leaf elements with text
3. Each collected element is treated as one translation unit.
4. `translateElement(...)` uses `el.textContent?.replaceAll('\n', '').trim()`.
5. Translation is requested as `translate([text])`, one element at a time.

### C. Current segmentation model

What exists today:

- selection-based translation: yes
- element/block-like inline translation: yes
- TOC entry translation: yes
- visible-range translation: yes
- chapter translation job: no dedicated implementation found
- whole-book translation job: no dedicated implementation found in this tree
- paragraph translation: approximately yes, but only insofar as a paragraph is represented by one collected DOM element

### D. How the result is returned and rendered

`useTranslator.ts` returns `string[]`, preserving input order.

For inline translation:

- the translated string is wrapped in appended DOM nodes
- wrapper class: `.translation-target`
- block class: `.translation-target-block` or `.translation-target-toc`
- target language is stored as `lang="<targetLang>"`

For popup translation:

- the first element of the returned array is rendered directly inside `TranslatorPopup.tsx`

### E. Current cache behavior

Client cache exists now in `src/services/translators/cache.ts`:

- in-memory cache
- IndexedDB store `TranslationCache / translations`
- key format: `provider:sourceLang:targetLang:text`
- auto preload on browser load:
  - 30-day max age
  - 10,000 entries
- auto prune on browser load and hourly:
  - 90-day max age
  - 100,000 entries
  - 10 MB max size

Backend cache exists only for DeepL, inside `src/pages/api/deepl/translate.ts`:

- optional Cloudflare KV cache
- keyed by SHA-1 hash of `sourceLang:targetLang:text`
- TTL: 90 days
- only used when `use_cache: true`

Important: the main reader translation flows do **not** pass `useCache: true` today, so normal book translation mostly relies on the client cache, not the backend KV cache.

## 7. Extension Points

### Best place to introduce a local provider

Lowest-friction insertion point:

- add a new provider module under `src/services/translators/providers/`
- register it in `src/services/translators/providers/index.ts`

Why this is the safest seam:

- existing UI already consumes the registry through `getTranslators()` and `getTranslator()`
- existing hook/caching/polishing pipeline can be reused initially
- no immediate reader UI rewrite is required

### Best place to introduce a provider via API key

Same registry seam as above, but the current provider interface is probably too small long-term.
Before adding multiple custom providers, extend the provider contract to include:

- provider capabilities
- auth mode
- supported language list
- max batch size
- retry/backoff policy

### Best place to introduce local cache

Current seam:

- `src/services/translators/cache.ts`

Recommended future direction:

- keep `getFromCache(...)` / `storeInCache(...)` as the public contract
- move actual storage backends behind adapters:
  - memory
  - IndexedDB
  - SQLite/file-based local cache
  - optional shared remote cache

### Best place to introduce an async translation queue

Current queue is embedded in:

- `src/app/reader/hooks/useTextTranslation.ts`

Key extraction candidates:

- `scheduleTranslation`
- `drainTranslationQueue`
- `translateElement`
- `createTranslationObserver`

Those functions are the best starting point for a reusable job queue with cancellation, dedupe, batching, and priority control.

### Best place to introduce chapter translation

Do **not** put chapter translation directly into the current DOM-observer hook.
The safer seam is to create a new segment/job layer that sits above providers and cache, then let both:

- visible-block translation
- chapter/full-book translation

consume the same segment pipeline.

Likely future components:

- `SegmentExtractor`
- `TranslationJobQueue`
- `TranslationService`

### Best place to introduce visible-block translation

The existing visible-block logic is already in `useTextTranslation.ts`:

- `IntersectionObserver`
- visible element window expansion
- `MAX_CONCURRENT_TRANSLATIONS = 5`

If you want to keep the current UX and just replace the provider later, this hook is the main place to adapt.

### Related feature seams

- Bilingual TTS: `src/app/reader/hooks/useTTSControl.ts` + `src/services/tts/TTSController.ts`
- Parallel Read: `src/store/parallelViewStore.ts` + `src/app/reader/components/sidebar/BookMenu.tsx`

## 8. Risks / Coupling

### 1. Split translation settings source

This is the biggest coupling issue found.

- Popup translation uses `settings.globalReadSettings.translationProvider` and `settings.globalReadSettings.translateTargetLang`.
- Inline translation uses `viewSettings.translationProvider` and `viewSettings.translateTargetLang`.

Consequences:

- popup and inline translation can use different providers
- popup and inline translation can use different target languages
- defaults already differ:
  - global read settings default target language is `EN`
  - view translation default target language is `''` (system language)

### 2. Popup settings are not persisted

`TranslatorPopup.tsx` mutates `settings.globalReadSettings` and calls `setSettings(settings)`, but it does **not** call `saveSettings(...)`.

Consequence:

- popup provider/target changes appear to be in-memory only

### 3. DeepL is coupled to Readest-hosted infrastructure

`deeplProvider` does not call DeepL directly in normal app usage.
It goes through `getAPIBaseUrl()`, which resolves to `https://web.readest.com/api` outside web dev mode.

Consequence:

- the current DeepL path depends on Readest's hosted API, auth, quotas, and backend cache

### 4. Inline translation is DOM-element based, not semantic

`walkTextNodes(...)` works on text-bearing DOM elements, not on explicit paragraph/chapter/section models.

Consequences:

- segmentation is only approximately paragraph-like
- batching is poor
- chapter/full-book translation will be awkward if built on the same mechanism

### 5. Visible translation is not batched

`useTextTranslation.ts` translates one element at a time with `translate([text])`.

Consequences:

- many small requests
- provider overhead is multiplied
- Google/Azure/Yandex then also split inside their own provider implementations

### 6. Provider capability model is too thin

The provider interface does not model:

- supported languages
- batch limits
- rate limits
- auto-detect support
- local/offline capability
- streaming vs blocking behavior

### 7. Shared mutable provider state

`quotaExceeded` lives on provider objects themselves and is mutated in place.
`useTranslator` also performs provider fallback internally.

Consequences:

- UI can drift from actual provider used
- state is harder to reason about in React than explicit store state

### 8. Popup provider display can diverge from actual provider

This is an observed architectural risk, not a confirmed user-visible bug in every case.

Reason:

- `TranslatorPopup.tsx` tracks provider in local component state
- `useTranslator.ts` may internally fall back to another available provider when auth or quota blocks the requested one

Validation note:

- this should be verified in runtime, but the code path is clearly split

### 9. Hiding source text mutates original DOM nodes

When `showTranslateSource` is false, the hook blanks original text nodes and stores them in DOM attributes.

Consequences:

- translation view is not just additive; it mutates source DOM text
- the code already recreates the viewer for some source-visibility transitions, which confirms this coupling is fragile

### 10. Backend cache is DeepL-only and mostly unused by reader translation

Cloudflare KV caching exists only in the DeepL API route and only when `use_cache` is enabled.
The current inline reader and popup flows do not opt into it.

### 11. PDF support is asymmetric

- selection popup translation is explicitly supported for PDF right-click
- inline translation is disabled by UI availability checks for PDF

This is workable, but it means translation behavior is feature-specific rather than provider-specific.

### 12. Full-book translation / bilingual ebook code was not found

Release notes mention:

- bilingual TTS
- full book translation
- bilingual ebooks

But in the current checked-out code I did **not** find a dedicated full-book translation pipeline, book artifact model, or chapter translation job runner.

This is an inference boundary.
Validation is needed against:

- another branch
- a private service
- runtime-loaded code outside this repository

## 9. Recommended Refactor Strategy

### Stage 1. Freeze current behavior with characterization tests

Before changing architecture, capture the current contract of:

- `useTranslator`
- client cache semantics
- inline DOM injection in `useTextTranslation`
- popup translation flow

This lowers regression risk during provider replacement.

### Stage 2. Unify translation preferences

Create one canonical translation preference source for:

- provider
- target language
- source visibility
- translation enabled state

Then make both:

- `TranslatorPopup.tsx`
- `useTextTranslation.ts`

read from that same source.

### Stage 3. Extract a non-React translation service

Move provider dispatch, caching, preprocessing, and polishing out of `useTranslator.ts` into a plain service module.
Keep `useTranslator` as a thin hook wrapper.

### Stage 4. Expand the provider interface

Introduce a richer provider contract, for example:

- `supportsAutoDetect`
- `supportsOffline`
- `supportedLanguages`
- `maxBatchSize`
- `translateBatch(...)`
- auth/config metadata

### Stage 5. Separate segmentation from transport

Introduce a segment model such as:

```ts
type TranslationSegment = {
  id: string;
  text: string;
  sourceLang?: string;
  targetLang: string;
  location?: string;
  context?: string;
};
```

This gives one common input format for:

- selection translation
- visible-block translation
- chapter translation
- TOC translation

### Stage 6. Extract the inline queue into a reusable scheduler

Move DOM-queue logic out of `useTextTranslation.ts` so it can power:

- current visible translation
- future prefetch of nearby paragraphs
- future chapter jobs

### Stage 7. Add pluggable cache backends

Keep current cache API stable, but support new backends behind it:

- IndexedDB
- local file / SQLite
- optional remote cache

### Stage 8. Add new providers behind the registry

After the service boundary exists:

- add one API-key provider
- add one local/offline provider

Do not change reader UI yet.

### Stage 9. Add chapter/full-book translation only after the service boundary exists

At that point you can implement:

- chapter translation jobs
- persisted bilingual artifacts
- background GPU translation
- visible-block prefetch

without mixing transport logic into reader DOM hooks.

## 10. First Safe Implementation Step

The first practical implementation step should be:

**Create one canonical translation-preferences layer and make both `TranslatorPopup.tsx` and `useTextTranslation.ts` consume it, without changing provider implementations yet.**

Why this should come first:

- it removes the biggest current inconsistency in the architecture
- it gives a single control plane for any future local provider
- it reduces the risk that popup translation and inline translation diverge during the refactor
- it can be done without touching Tauri, build setup, or provider behavior

Immediately after that, extract the current `useTranslator` logic into a plain service so the future local provider can plug in without UI-specific branching.

## Notes On Unclear Areas

- Full-book translation and bilingual ebook generation are mentioned in `release-notes.json`, but I did not locate their implementation in this tree. Treat any statement about that feature as an inference until validated elsewhere.
- Bilingual TTS support is strongly suggested by `useTTSControl.ts`, `TTSController.ts`, and `packages/foliate-js/tts.js`. I did not perform runtime validation in this audit, so exact behavior should still be verified in the running app.

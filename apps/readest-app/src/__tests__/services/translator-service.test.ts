import { describe, expect, it, vi } from 'vitest';
import {
  createTranslationAbortError,
  ErrorCodes,
  isTranslationAbortError,
  resolveTranslatorSelection,
  throwIfTranslationAborted,
  translateTexts,
  TranslationServiceError,
  type TranslationProvider,
} from '@/services/translators';

const createTranslator = (
  name: string,
  overrides: Partial<TranslationProvider> = {},
): TranslationProvider => ({
  name,
  label: name,
  translate: vi.fn(async (texts: string[]) => texts),
  ...overrides,
});

describe('resolveTranslatorSelection', () => {
  it('falls back to the first available translator when the requested one is unavailable', () => {
    const translators = [
      createTranslator('deepl', { authRequired: true }),
      createTranslator('azure'),
      createTranslator('google', { quotaExceeded: true }),
    ];

    const selection = resolveTranslatorSelection({
      provider: 'deepl',
      token: null,
      translators,
    });

    expect(selection.selectedProvider).toBe('azure');
    expect(selection.translator.name).toBe('azure');
  });
});

describe('translateTexts', () => {
  it('preprocesses input, dispatches to the selected provider, stores new cache entries, and polishes the result', async () => {
    const translator = createTranslator('azure', {
      translate: vi.fn(async (texts: string[]) => texts.map((text) => `translated:${text}`)),
    });
    const getFromCache = vi.fn(async (text: string) =>
      text === 'pre:cached' ? 'cached:pre:cached' : null,
    );
    const storeInCache = vi.fn(async () => undefined);
    const preprocess = vi.fn((texts: string[]) => texts.map((text) => `pre:${text}`));
    const polish = vi.fn((texts: string[]) => texts.map((text) => `polished:${text}`));

    const results = await translateTexts(
      {
        input: ['cached', 'needs'],
        provider: 'azure',
        sourceLang: 'AUTO',
        targetLang: 'PT',
        token: 'token',
        useCache: true,
        translators: [translator],
      },
      { getFromCache, storeInCache, preprocess, polish },
    );

    expect(preprocess).toHaveBeenCalledWith(['cached', 'needs']);
    expect(translator.translate).toHaveBeenCalledWith(
      ['pre:needs'],
      'AUTO',
      'PT',
      'token',
      true,
      undefined,
    );
    expect(storeInCache).toHaveBeenCalledWith(
      'pre:needs',
      'translated:pre:needs',
      'AUTO',
      'PT',
      'azure',
    );
    expect(polish).toHaveBeenCalledWith(['cached:pre:cached', 'translated:pre:needs'], 'PT');
    expect(results).toEqual(['polished:cached:pre:cached', 'polished:translated:pre:needs']);
  });

  it('returns cached translations without calling the provider when all texts are cached', async () => {
    const translator = createTranslator('azure');
    const getFromCache = vi.fn(async (text: string) => `cached:${text}`);
    const storeInCache = vi.fn(async () => undefined);
    const preprocess = vi.fn((texts: string[]) => texts);
    const polish = vi.fn((texts: string[]) => texts);

    const results = await translateTexts(
      {
        input: ['one', 'two'],
        provider: 'azure',
        sourceLang: 'AUTO',
        targetLang: 'EN',
        enablePolishing: false,
        translators: [translator],
      },
      { getFromCache, storeInCache, preprocess, polish },
    );

    expect(translator.translate).not.toHaveBeenCalled();
    expect(storeInCache).not.toHaveBeenCalled();
    expect(results).toEqual(['cached:one', 'cached:two']);
  });

  it('wraps quota errors with fallback metadata', async () => {
    const translator = createTranslator('deepl', {
      translate: vi.fn(async () => {
        throw new Error(ErrorCodes.DAILY_QUOTA_EXCEEDED);
      }),
    });

    await expect(
      translateTexts(
        {
          input: ['text'],
          provider: 'deepl',
          sourceLang: 'AUTO',
          targetLang: 'EN',
          translators: [translator],
        },
        {
          getFromCache: vi.fn(async () => null),
          storeInCache: vi.fn(async () => undefined),
          preprocess: vi.fn((texts: string[]) => texts),
          polish: vi.fn((texts: string[]) => texts),
        },
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.DAILY_QUOTA_EXCEEDED,
      fallbackProvider: 'azure',
    } satisfies Partial<TranslationServiceError>);
  });

  it('passes AbortSignal through to the provider call', async () => {
    const signal = new AbortController().signal;
    const translator = createTranslator('azure', {
      translate: vi.fn(async (texts: string[]) => texts.map((text) => `translated:${text}`)),
    });

    await translateTexts(
      {
        input: ['text'],
        provider: 'azure',
        sourceLang: 'AUTO',
        targetLang: 'PT',
        signal,
        translators: [translator],
      },
      {
        getFromCache: vi.fn(async () => null),
        storeInCache: vi.fn(async () => undefined),
        preprocess: vi.fn((texts: string[]) => texts),
        polish: vi.fn((texts: string[]) => texts),
      },
    );

    expect(translator.translate).toHaveBeenCalledWith(
      ['text'],
      'AUTO',
      'PT',
      undefined,
      false,
      signal,
    );
  });

  it('throws a stable abort error before doing work when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const translator = createTranslator('azure');

    await expect(
      translateTexts(
        {
          input: ['text'],
          provider: 'azure',
          sourceLang: 'AUTO',
          targetLang: 'PT',
          signal: controller.signal,
          translators: [translator],
        },
        {
          getFromCache: vi.fn(async () => null),
          storeInCache: vi.fn(async () => undefined),
          preprocess: vi.fn((texts: string[]) => texts),
          polish: vi.fn((texts: string[]) => texts),
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(translator.translate).not.toHaveBeenCalled();
  });
});

describe('translation abort helpers', () => {
  it('creates and detects a stable abort error', () => {
    const abortError = createTranslationAbortError();

    expect(isTranslationAbortError(abortError)).toBe(true);
    expect(isTranslationAbortError(new Error('Request cancelled'))).toBe(true);
  });

  it('throws when asked to abort an already-aborted request', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => throwIfTranslationAborted(controller.signal)).toThrowError(/aborted/i);
  });
});

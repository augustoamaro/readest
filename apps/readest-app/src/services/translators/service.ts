import { getLocale } from '@/utils/misc';
import { getFromCache, storeInCache } from './cache';
import { polish } from './polish';
import { preprocess } from './preprocess';
import { getTranslators, TranslatorName } from './providers';
import {
  ErrorCodes,
  TranslationProvider,
  TranslationRequestOptions,
  UseTranslatorOptions,
} from './types';

export interface TranslatorSelection {
  selectedProvider: TranslatorName;
  translator: TranslationProvider;
}

export interface TranslationServiceDependencies {
  getFromCache: typeof getFromCache;
  storeInCache: typeof storeInCache;
  polish: typeof polish;
  preprocess: typeof preprocess;
}

export interface TranslateTextOptions extends UseTranslatorOptions, TranslationRequestOptions {
  input: string[];
  provider: TranslatorName;
  token?: string | null;
  useCache?: boolean;
  translators?: TranslationProvider[];
}

const defaultDependencies: TranslationServiceDependencies = {
  getFromCache,
  storeInCache,
  polish,
  preprocess,
};

export class TranslationServiceError extends Error {
  code?: string;
  fallbackProvider?: TranslatorName;

  constructor(message: string, options?: { code?: string; fallbackProvider?: TranslatorName }) {
    super(message);
    this.name = 'TranslationServiceError';
    this.code = options?.code;
    this.fallbackProvider = options?.fallbackProvider;
  }
}

export const createTranslationAbortError = () => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Translation request aborted', 'AbortError');
  }

  const error = new Error('Translation request aborted');
  error.name = 'AbortError';
  return error;
};

export const isTranslationAbortError = (error: unknown) => {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
};

export const throwIfTranslationAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createTranslationAbortError();
  }
};

export const getAvailableTranslators = (
  token?: string | null,
  translators: TranslationProvider[] = getTranslators(),
): TranslationProvider[] => {
  return translators.filter((translator) => (translator.authRequired ? !!token : true));
};

export const resolveTranslatorSelection = ({
  provider,
  token,
  translators = getTranslators(),
}: {
  provider: TranslatorName;
  token?: string | null;
  translators?: TranslationProvider[];
}): TranslatorSelection => {
  const availableTranslators = getAvailableTranslators(token, translators).filter(
    (translator) => !translator.quotaExceeded,
  );
  const selectedTranslator =
    availableTranslators.find((translator) => translator.name === provider) ||
    availableTranslators[0];

  if (!selectedTranslator) {
    throw new Error('No translators available');
  }

  return {
    selectedProvider: selectedTranslator.name as TranslatorName,
    translator: selectedTranslator,
  };
};

export const translateTexts = async (
  {
    input,
    provider,
    sourceLang = 'AUTO',
    targetLang = 'EN',
    enablePolishing = true,
    enablePreprocessing = true,
    token,
    useCache = false,
    signal,
    translators = getTranslators(),
  }: TranslateTextOptions,
  dependencies: TranslationServiceDependencies = defaultDependencies,
): Promise<string[]> => {
  throwIfTranslationAborted(signal);

  const sourceLanguage = sourceLang;
  const targetLanguage = targetLang || getLocale();
  const textsToTranslate = enablePreprocessing ? dependencies.preprocess(input) : input;

  if (textsToTranslate.length === 0 || textsToTranslate.every((text) => !text?.trim())) {
    return textsToTranslate;
  }

  const textsNeedingTranslation: string[] = [];
  const indicesNeedingTranslation: number[] = [];

  await Promise.all(
    textsToTranslate.map(async (text, index) => {
      if (!text?.trim()) return;

      const cachedTranslation = await dependencies.getFromCache(
        text,
        sourceLanguage,
        targetLanguage,
        provider,
      );

      if (cachedTranslation) return;

      textsNeedingTranslation.push(text);
      indicesNeedingTranslation.push(index);
    }),
  );

  throwIfTranslationAborted(signal);

  if (textsNeedingTranslation.length === 0) {
    const results = await Promise.all(
      textsToTranslate.map((text) =>
        dependencies
          .getFromCache(text, sourceLanguage, targetLanguage, provider)
          .then((cached) => cached || text),
      ),
    );

    return enablePolishing ? dependencies.polish(results, targetLanguage) : results;
  }

  const translator = translators.find((item) => item.name === provider);
  if (!translator) {
    throw new Error(`No translator found for provider: ${provider}`);
  }

  try {
    const translatedTexts = await translator.translate(
      textsNeedingTranslation,
      sourceLanguage,
      targetLanguage,
      token,
      useCache,
      signal,
    );

    throwIfTranslationAborted(signal);

    await Promise.all(
      textsNeedingTranslation.map(async (text, index) => {
        return dependencies.storeInCache(
          text,
          translatedTexts[index] || '',
          sourceLanguage,
          targetLanguage,
          provider,
        );
      }),
    );

    throwIfTranslationAborted(signal);

    const results = [...textsToTranslate];
    indicesNeedingTranslation.forEach((originalIndex, translationIndex) => {
      results[originalIndex] = translatedTexts[translationIndex] || '';
    });

    await Promise.all(
      results.map(async (_, index) => {
        if (!indicesNeedingTranslation.includes(index)) {
          const originalText = textsToTranslate[index];
          if (!originalText?.trim()) return;

          const cachedTranslation = await dependencies.getFromCache(
            originalText,
            sourceLanguage,
            targetLanguage,
            provider,
          );

          if (cachedTranslation) {
            results[index] = cachedTranslation;
          }
        }
      }),
    );

    return enablePolishing ? dependencies.polish(results, targetLanguage) : results;
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    if (isTranslationAbortError(normalizedError)) {
      throw normalizedError;
    }

    if (normalizedError.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
      throw new TranslationServiceError(normalizedError.message, {
        code: ErrorCodes.DAILY_QUOTA_EXCEEDED,
        fallbackProvider: 'azure',
      });
    }

    throw normalizedError;
  }
};

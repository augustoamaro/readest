import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getLocalCTranslate2BaseUrl, isTauriAppPlatform } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { ErrorCodes, TranslationProvider, TranslationProviderAvailability } from '../types';

const LOCAL_CTRANSLATE2_HEALTH_PATH = '/health';
const LOCAL_CTRANSLATE2_TRANSLATE_PATH = '/translate';

const buildLocalCTranslate2HealthEndpoint = () => {
  return new URL(LOCAL_CTRANSLATE2_HEALTH_PATH, getLocalCTranslate2BaseUrl()).toString();
};

const buildLocalCTranslate2Endpoint = () => {
  return new URL(LOCAL_CTRANSLATE2_TRANSLATE_PATH, getLocalCTranslate2BaseUrl()).toString();
};

const LOCAL_CTRANSLATE2_INVALID_PAIR_ERROR =
  'Unsupported language pair. Local CTranslate2 currently supports AUTO/EN -> PT/PT-BR/PT-PT only.';

const getLocalServiceError = (message?: string) => {
  return new Error(message || ErrorCodes.LOCAL_SERVICE_UNAVAILABLE);
};

const isLocalCTranslate2DebugEnabled = () => {
  if (process.env['NEXT_PUBLIC_LOCAL_CTRANSLATE2_DEBUG'] === 'true') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage?.getItem('readest.localCTranslate2.debug') === 'true';
  } catch {
    return false;
  }
};

const debugLocalCTranslate2 = (event: string, payload: Record<string, unknown>) => {
  if (!isLocalCTranslate2DebugEnabled()) return;
  console.info('[local-ctranslate2]', event, payload);
};

const normalizeLocalCTranslate2Lang = (lang: string | null | undefined) => {
  return String(lang ?? '')
    .trim()
    .replaceAll('_', '-');
};

const getLocaleParts = (lang: string) => {
  const sanitized = normalizeLocalCTranslate2Lang(lang);

  if (!sanitized) {
    return {
      raw: String(lang ?? ''),
      sanitized,
      normalized: '',
      language: '',
      region: '',
      baseName: '',
    };
  }

  try {
    const locale = new Intl.Locale(sanitized);
    return {
      raw: String(lang ?? ''),
      sanitized,
      normalized: sanitized.toUpperCase(),
      language: locale.language.toUpperCase(),
      region: locale.region?.toUpperCase() ?? '',
      baseName: locale.baseName.toUpperCase(),
    };
  } catch {
    const normalized = sanitized.toUpperCase();
    const parts = normalized.split('-').filter(Boolean);
    return {
      raw: String(lang ?? ''),
      sanitized,
      normalized,
      language: parts[0] ?? '',
      region: parts.find((part, index) => index > 0 && /^(?:[A-Z]{2}|\d{3})$/.test(part)) ?? '',
      baseName: normalized,
    };
  }
};

const normalizeLocalCTranslate2SourceLang = (sourceLang: string) => {
  const locale = getLocaleParts(sourceLang);
  debugLocalCTranslate2('normalize-source:start', {
    rawSourceLang: locale.raw,
    sanitizedSourceLang: locale.sanitized,
  });

  if (!locale.sanitized || locale.normalized === 'AUTO') {
    debugLocalCTranslate2('normalize-source:success', {
      rawSourceLang: locale.raw,
      normalizedSourceLang: 'AUTO',
    });
    return 'AUTO';
  }

  if (locale.language === 'EN') {
    debugLocalCTranslate2('normalize-source:success', {
      rawSourceLang: locale.raw,
      normalizedSourceLang: 'EN',
      parsedBaseName: locale.baseName,
    });
    return 'EN';
  }

  debugLocalCTranslate2('normalize-source:invalid', {
    rawSourceLang: locale.raw,
    sanitizedSourceLang: locale.sanitized,
    normalizedSourceLang: locale.normalized,
    parsedLanguage: locale.language,
    parsedRegion: locale.region,
    parsedBaseName: locale.baseName,
  });
  throw getLocalServiceError(LOCAL_CTRANSLATE2_INVALID_PAIR_ERROR);
};

const normalizeLocalCTranslate2TargetLang = (targetLang: string) => {
  const locale = getLocaleParts(targetLang);
  debugLocalCTranslate2('normalize-target:start', {
    rawTargetLang: locale.raw,
    sanitizedTargetLang: locale.sanitized,
  });

  if (locale.language !== 'PT') {
    debugLocalCTranslate2('normalize-target:invalid', {
      rawTargetLang: locale.raw,
      sanitizedTargetLang: locale.sanitized,
      normalizedTargetLang: locale.normalized,
      parsedLanguage: locale.language,
      parsedRegion: locale.region,
      parsedBaseName: locale.baseName,
    });
    throw getLocalServiceError(LOCAL_CTRANSLATE2_INVALID_PAIR_ERROR);
  }

  const normalizedTargetLang =
    locale.region === 'BR' ? 'PT-BR' : locale.region === 'PT' ? 'PT-PT' : 'PT';

  debugLocalCTranslate2('normalize-target:success', {
    rawTargetLang: locale.raw,
    normalizedTargetLang,
    parsedBaseName: locale.baseName,
    parsedRegion: locale.region,
  });

  return normalizedTargetLang;
};

const isAbortError = (error: unknown) => {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
};

const isTransportFailure = (error: unknown) => {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('econnrefused') ||
    message.includes('connection refused')
  );
};

export const localCTranslate2Provider: TranslationProvider = {
  name: 'local-ctranslate2',
  label: _('Local CTranslate2 (en->pt)'),
  checkAvailability: async (signal?: AbortSignal): Promise<TranslationProviderAvailability> => {
    const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;

    try {
      const response = await fetch(buildLocalCTranslate2HealthEndpoint(), {
        method: 'GET',
        signal,
      });

      if (!response.ok) {
        return {
          status: 'unavailable',
          checkedAt: Date.now(),
          message: ErrorCodes.LOCAL_SERVICE_UNAVAILABLE,
        };
      }

      const data = (await response.json()) as {
        status?: string;
        device?: string;
        model_path?: string;
        tokenizer?: string;
      };

      return {
        status: data.status === 'ok' ? 'available' : 'unavailable',
        checkedAt: Date.now(),
        message:
          data.status === 'ok' ? undefined : data.status || ErrorCodes.LOCAL_SERVICE_UNAVAILABLE,
        details: {
          device: data.device,
          modelPath: data.model_path,
          serviceStatus: data.status,
          tokenizer: data.tokenizer,
        },
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      return {
        status: 'unavailable',
        checkedAt: Date.now(),
        message: ErrorCodes.LOCAL_SERVICE_UNAVAILABLE,
      };
    }
  },
  translate: async (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    _token?: string | null,
    _useCache?: boolean,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    if (!texts.length) return [];

    try {
      debugLocalCTranslate2('translate:input', {
        sourceLang,
        targetLang,
        textCount: texts.length,
      });
      const normalizedSourceLang = normalizeLocalCTranslate2SourceLang(sourceLang);
      const normalizedTargetLang = normalizeLocalCTranslate2TargetLang(targetLang);
      debugLocalCTranslate2('translate:normalized', {
        sourceLang,
        normalizedSourceLang,
        targetLang,
        normalizedTargetLang,
        textCount: texts.length,
      });
      const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
      const response = await fetch(buildLocalCTranslate2Endpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          texts,
          source_lang: normalizedSourceLang,
          target_lang: normalizedTargetLang,
        }),
        signal,
      });

      if (!response.ok) {
        let errorMessage = `Local CTranslate2 request failed with status ${response.status}`;
        try {
          const data = await response.json();
          if (data && typeof data.error === 'string') {
            errorMessage = data.error;
          }
        } catch {
          // Best effort only; keep the status-based message when body parsing fails.
        }

        throw getLocalServiceError(errorMessage);
      }

      const data = (await response.json()) as {
        translations?: Array<{ text?: string } | string>;
        error?: string;
      };

      if (!data?.translations || !Array.isArray(data.translations)) {
        throw getLocalServiceError(
          data?.error || 'Invalid response from local CTranslate2 service.',
        );
      }

      return texts.map((line, index) => {
        if (!line?.trim().length) {
          return line;
        }

        const translation = data.translations?.[index];
        if (typeof translation === 'string') {
          return translation || line;
        }

        return translation?.text || line;
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      if (isTransportFailure(error)) {
        throw getLocalServiceError();
      }

      throw error;
    }
  },
};

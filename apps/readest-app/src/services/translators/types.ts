import { TranslatorName } from './providers';

export interface TranslationRequestOptions {
  signal?: AbortSignal;
}

export type TranslationProviderAvailabilityStatus = 'available' | 'unavailable' | 'unknown';

export interface TranslationProviderAvailability {
  status: TranslationProviderAvailabilityStatus;
  checkedAt: number;
  message?: string;
  details?: {
    device?: string;
    modelPath?: string;
    serviceStatus?: string;
    tokenizer?: string;
  };
}

export interface TranslationProvider {
  name: string;
  label: string;
  authRequired?: boolean;
  quotaExceeded?: boolean;
  checkAvailability?: (signal?: AbortSignal) => Promise<TranslationProviderAvailability>;
  translate: (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
    useCache?: boolean,
    signal?: AbortSignal,
  ) => Promise<string[]>;
}

export interface TranslationCache {
  [key: string]: string;
}

export interface UseTranslatorOptions {
  provider?: TranslatorName;
  sourceLang?: string;
  targetLang?: string;
  enablePolishing?: boolean;
  enablePreprocessing?: boolean;
}

export const ErrorCodes = {
  UNAUTHORIZED: 'Unauthorized',
  DEEPL_API_ERROR: 'DeepL API Error',
  DAILY_QUOTA_EXCEEDED: 'Daily Quota Exceeded',
  INTERNAL_SERVER_ERROR: 'Internal Server Error',
  LOCAL_SERVICE_UNAVAILABLE: 'Local CTranslate2 service is unavailable.',
};

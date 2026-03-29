import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  getDailyTranslationPlanData,
  getSubscriptionPlan,
  validateUserAndToken,
} from '@/utils/access';
import {
  recordDeepLProxyObservabilityEvent,
  type DeepLProxyObservabilityEvent,
} from './observability';
import { ErrorCodes } from '@/services/translators';
import { UsageStatsManager } from '@/utils/usage';

const DEFAULT_DEEPL_FREE_API = 'https://api-free.deepl.com/v2/translate';
const DEFAULT_DEEPL_PRO_API = 'https://api.deepl.com/v2/translate';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CloudflareEnv {
  TRANSLATIONS_KV?: KVNamespace;
}

interface DeepLProxyAbortBinding {
  signal: AbortSignal;
  dispose: () => void;
}

const LANG_V2_V1_MAP: Record<string, string> = {
  'ZH-HANS': 'ZH',
  'ZH-HANT': 'ZH-TW',
};

const getDeepLAPIKey = (keys: string | undefined) => {
  const keyArray = keys?.split(',') ?? [];
  return keyArray.length ? keyArray[Math.floor(Math.random() * keyArray.length)]! : '';
};

const generateCacheKey = (text: string, sourceLang: string, targetLang: string): string => {
  const inputString = `${sourceLang}:${targetLang}:${text}`;
  const hash = crypto.createHash('sha1').update(inputString).digest('hex');
  return `tr:${hash}`;
};

export const createDeepLProxyAbortError = () => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('DeepL proxy request aborted', 'AbortError');
  }

  const error = new Error('DeepL proxy request aborted');
  error.name = 'AbortError';
  return error;
};

export const isDeepLProxyAbortError = (error: unknown) => {
  const message =
    error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException)
      ? error.message
      : String(error);

  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    /request cancelled|request canceled|deepl proxy request aborted|operation was aborted/i.test(
      message,
    )
  );
};

export const throwIfDeepLProxyAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    const reason = signal.reason;
    if (
      reason instanceof Error ||
      (typeof DOMException !== 'undefined' && reason instanceof DOMException)
    ) {
      throw reason;
    }
    throw createDeepLProxyAbortError();
  }
};

export const createDeepLProxyAbortBinding = (
  req: NextApiRequest,
  res: NextApiResponse,
): DeepLProxyAbortBinding => {
  const controller = new AbortController();

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(createDeepLProxyAbortError());
    }
  };

  const handleRequestAborted = () => {
    abort();
  };

  const handleResponseClose = () => {
    if (!res.writableEnded) {
      abort();
    }
  };

  req.once('aborted', handleRequestAborted);
  res.once('close', handleResponseClose);

  return {
    signal: controller.signal,
    dispose: () => {
      req.off('aborted', handleRequestAborted);
      res.off('close', handleResponseClose);
    },
  };
};

const checkDailyUsage = async (userId: string, token: string, chars: number) => {
  const { quota: dailyQuota } = getDailyTranslationPlanData(token);
  const dailyUsage = await UsageStatsManager.getCurrentUsage(userId, 'translation_chars', 'daily');

  if (dailyQuota <= dailyUsage + chars) {
    throw new Error(ErrorCodes.DAILY_QUOTA_EXCEEDED);
  }
  return dailyUsage;
};

const updateDailyUsage = async (
  userId: string | undefined,
  token: string | undefined,
  incrementUsage: number,
  signal?: AbortSignal,
  requestId?: string,
) => {
  if (!userId || !token) return 0;

  try {
    const userPlan = getSubscriptionPlan(token);
    const newUsage = await UsageStatsManager.trackUsage(
      userId,
      'translation_chars',
      incrementUsage,
      {
        plan_type: userPlan,
        source: 'deepl_api',
      },
    );

    if (signal?.aborted) {
      recordDeepLProxyObservabilityEvent({
        type: 'postAbortUsageUpdate',
        timestamp: Date.now(),
        requestId,
      });
    }

    return newUsage;
  } catch (cacheError) {
    console.error('Update daily usage error:', cacheError);
  }

  return 0;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let env: Partial<CloudflareEnv> = {};
  try {
    env = (getCloudflareContext().env || {}) as CloudflareEnv;
  } catch {
    console.warn('Cloudflare context is not available. Skipping KV cache.');
  }
  const hasKVCache = !!env['TRANSLATIONS_KV'];

  const { user, token } = await validateUserAndToken(req.headers['authorization']);
  const { DEEPL_PRO_API, DEEPL_FREE_API } = process.env;
  const deepFreeApiUrl = DEEPL_FREE_API || DEFAULT_DEEPL_FREE_API;
  const deeplProApiUrl = DEEPL_PRO_API || DEFAULT_DEEPL_PRO_API;

  let deeplApiUrl = deepFreeApiUrl;
  let userPlan = 'free';
  if (user && token) {
    userPlan = getSubscriptionPlan(token);
    if (userPlan === 'pro') deeplApiUrl = deeplProApiUrl;
  }
  const deeplAuthKey =
    deeplApiUrl === deeplProApiUrl
      ? getDeepLAPIKey(process.env['DEEPL_PRO_API_KEYS'])
      : getDeepLAPIKey(process.env['DEEPL_FREE_API_KEYS']);

  const {
    text,
    source_lang: sourceLang = 'AUTO',
    target_lang: targetLang = 'EN',
    use_cache: useCache = false,
  }: { text: string[]; source_lang: string; target_lang: string; use_cache: boolean } = req.body;
  const abortBinding = createDeepLProxyAbortBinding(req, res);
  const requestId = crypto.randomUUID();
  const requestStartedAt = Date.now();
  let requestFinalized = false;

  const finalizeRequest = (
    event: Exclude<DeepLProxyObservabilityEvent, { type: 'requestStarted' }>,
  ) => {
    if (requestFinalized) return;
    requestFinalized = true;
    recordDeepLProxyObservabilityEvent(event);
  };

  const handleAbortObserved = () => {
    finalizeRequest({
      type: 'requestAborted',
      timestamp: Date.now(),
      requestId,
      durationMs: Date.now() - requestStartedAt,
    });
  };

  abortBinding.signal.addEventListener('abort', handleAbortObserved, { once: true });
  recordDeepLProxyObservabilityEvent({
    type: 'requestStarted',
    timestamp: requestStartedAt,
    requestId,
    charCount: text.reduce((sum, item) => sum + item.length, 0),
    textCount: text.length,
  });

  try {
    const translations = await Promise.all(
      text.map(async (singleText) => {
        throwIfDeepLProxyAborted(abortBinding.signal);

        if (!singleText?.trim()) {
          return { text: '', daily_usage: 0 };
        }
        if (useCache && hasKVCache) {
          try {
            const cacheKey = generateCacheKey(singleText, sourceLang, targetLang);
            const cachedTranslation = await env['TRANSLATIONS_KV']!.get(cacheKey);

            if (cachedTranslation) {
              return {
                text: cachedTranslation,
                daily_usage: 0,
                detected_source_language: sourceLang,
              };
            }
          } catch (cacheError) {
            console.error('Cache retrieval error:', cacheError);
          }
        }

        throwIfDeepLProxyAborted(abortBinding.signal);

        if (!user || !token) return res.status(401).json({ error: ErrorCodes.UNAUTHORIZED });
        await checkDailyUsage(user?.id, token, singleText.length);
        throwIfDeepLProxyAborted(abortBinding.signal);

        return await callDeepLAPI(
          singleText,
          sourceLang,
          targetLang,
          deeplApiUrl,
          deeplAuthKey,
          env['TRANSLATIONS_KV'],
          useCache,
          abortBinding.signal,
          requestId,
        );
      }),
    );

    throwIfDeepLProxyAborted(abortBinding.signal);

    const originalCharsCount = text.reduce((a, b) => a + b.length, 0);
    const translatedCharsCount = translations.reduce((a, b) => a + (b?.text.length || 0), 0);
    const newDailyUsage = await updateDailyUsage(
      user?.id,
      token,
      originalCharsCount + translatedCharsCount,
      abortBinding.signal,
      requestId,
    );
    throwIfDeepLProxyAborted(abortBinding.signal);

    translations.forEach((translation) => {
      if (translation && translation.text) {
        translation.daily_usage = newDailyUsage;
      }
    });

    if (abortBinding.signal.aborted || res.writableEnded) {
      if (res.writableEnded && !abortBinding.signal.aborted) {
        finalizeRequest({
          type: 'requestFailed',
          timestamp: Date.now(),
          requestId,
          durationMs: Date.now() - requestStartedAt,
          reason: `response_sent:${res.statusCode}`,
        });
      }
      return;
    }

    finalizeRequest({
      type: 'requestSucceeded',
      timestamp: Date.now(),
      requestId,
      durationMs: Date.now() - requestStartedAt,
      translationCount: translations.length,
    });
    return res.status(200).json({ translations });
  } catch (error) {
    if (isDeepLProxyAbortError(error) || abortBinding.signal.aborted) {
      return;
    }

    finalizeRequest({
      type: 'requestFailed',
      timestamp: Date.now(),
      requestId,
      durationMs: Date.now() - requestStartedAt,
      reason: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error && error.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
      return res.status(429).json({ error: ErrorCodes.DAILY_QUOTA_EXCEEDED });
    } else {
      console.error('Error proxying DeepL request:', error);
    }
    return res.status(500).json({ error: ErrorCodes.INTERNAL_SERVER_ERROR });
  } finally {
    abortBinding.signal.removeEventListener('abort', handleAbortObserved);
    abortBinding.dispose();
  }
};

export async function callDeepLAPI(
  text: string,
  sourceLang: string,
  targetLang: string,
  apiUrl: string,
  authKey: string,
  translationsKV: KVNamespace | undefined,
  useCache: boolean,
  signal?: AbortSignal,
  requestId?: string,
) {
  const isV2Api = apiUrl.endsWith('/v2/translate');
  throwIfDeepLProxyAborted(signal);

  // TODO: this should be processed in the client, but for now, we need to do it here
  // please remove this when most clients are updated
  const input = text.replaceAll('\n', '').trim();

  const requestBody: {
    text: string | string[];
    target_lang: string;
    source_lang?: string;
  } = {
    text: isV2Api ? [input] : input,
    source_lang: isV2Api ? sourceLang : (LANG_V2_V1_MAP[sourceLang] ?? sourceLang),
    target_lang: isV2Api ? targetLang : (LANG_V2_V1_MAP[targetLang] ?? targetLang),
  };

  if (isV2Api && requestBody.source_lang?.toUpperCase() === 'AUTO') {
    delete requestBody.source_lang;
  }
  const downstreamStartedAt = Date.now();
  recordDeepLProxyObservabilityEvent({
    type: 'downstreamFetchStarted',
    timestamp: downstreamStartedAt,
    requestId,
    textLength: input.length,
  });

  let translatedText = '';
  let detectedSourceLanguage = '';

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${authKey}`,
        'x-fingerprint': process.env['DEEPL_X_FINGERPRINT'] || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepL API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      translations?: { text: string; detected_source_language?: string }[];
      data?: string;
    };
    throwIfDeepLProxyAborted(signal);

    if (data.translations && data.translations.length > 0) {
      translatedText = data.translations[0]!.text;
      detectedSourceLanguage = data.translations[0]!.detected_source_language || '';
    } else if (data.data) {
      translatedText = data.data;
    }

    recordDeepLProxyObservabilityEvent({
      type: 'downstreamFetchSucceeded',
      timestamp: Date.now(),
      requestId,
      durationMs: Date.now() - downstreamStartedAt,
      textLength: input.length,
    });
  } catch (error) {
    const durationMs = Date.now() - downstreamStartedAt;

    if (isDeepLProxyAbortError(error)) {
      recordDeepLProxyObservabilityEvent({
        type: 'downstreamFetchAborted',
        timestamp: Date.now(),
        requestId,
        durationMs,
        textLength: input.length,
      });
    } else {
      recordDeepLProxyObservabilityEvent({
        type: 'downstreamFetchFailed',
        timestamp: Date.now(),
        requestId,
        durationMs,
        textLength: input.length,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    throw error;
  }

  if (useCache && translationsKV && translatedText) {
    throwIfDeepLProxyAborted(signal);
    try {
      const cacheKey = generateCacheKey(text, sourceLang, targetLang);
      await translationsKV.put(cacheKey, translatedText, { expirationTtl: 86400 * 90 });

      if (signal?.aborted) {
        recordDeepLProxyObservabilityEvent({
          type: 'postAbortCacheWrite',
          timestamp: Date.now(),
          requestId,
        });
      }
    } catch (cacheError) {
      console.error('Cache storage error:', cacheError);
    }
  }

  return {
    text: translatedText,
    daily_usage: 0,
    detected_source_language: detectedSourceLanguage,
  };
}

export default handler;

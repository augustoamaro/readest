import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runMiddlewareMock = vi.fn(async (_req: unknown, _res: unknown, _fn: unknown) => undefined);
const getCloudflareContextMock = vi.fn(() => {
  throw new Error('no cloudflare context');
});
const validateUserAndTokenMock = vi.fn(async (_authorization?: string | string[]) => ({
  user: { id: 'user-1' },
  token: 'token',
}));
const getSubscriptionPlanMock = vi.fn((_token: string) => 'free');
const getDailyTranslationPlanDataMock = vi.fn((_token: string) => ({ quota: 10_000 }));
const usageStatsGetCurrentUsageMock = vi.fn(
  async (_userId: string, _metric: string, _period: string) => 0,
);
const usageStatsTrackUsageMock = vi.fn(
  async (_userId: string, _metric: string, _value: number, _metadata?: Record<string, unknown>) =>
    10,
);

vi.mock('@/utils/cors', () => ({
  corsAllMethods: vi.fn(),
  runMiddleware: (req: unknown, res: unknown, fn: unknown) => runMiddlewareMock(req, res, fn),
}));

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => getCloudflareContextMock(),
}));

vi.mock('@/utils/access', () => ({
  validateUserAndToken: (authorization?: string | string[]) =>
    validateUserAndTokenMock(authorization),
  getSubscriptionPlan: (token: string) => getSubscriptionPlanMock(token),
  getDailyTranslationPlanData: (token: string) => getDailyTranslationPlanDataMock(token),
}));

vi.mock('@/utils/usage', () => ({
  UsageStatsManager: {
    getCurrentUsage: (userId: string, metric: string, period: string) =>
      usageStatsGetCurrentUsageMock(userId, metric, period),
    trackUsage: (
      userId: string,
      metric: string,
      value: number,
      metadata?: Record<string, unknown>,
    ) => usageStatsTrackUsageMock(userId, metric, value, metadata),
  },
}));

class MockRequest extends EventEmitter {
  method = 'POST';
  headers: Record<string, string> = { authorization: 'Bearer token' };
  body = {
    text: ['hello'],
    source_lang: 'AUTO',
    target_lang: 'EN',
    use_cache: false,
  };
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  writableEnded = false;
  status = vi.fn((code: number) => {
    this.statusCode = code;
    return this;
  });
  json = vi.fn((_body: unknown) => {
    this.writableEnded = true;
    return this;
  });
}

describe('DeepL proxy abort handling', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { resetDeepLProxyObservability } = await import('@/pages/api/deepl/observability');
    resetDeepLProxyObservability();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts the proxy signal when the client connection closes early', async () => {
    const { createDeepLProxyAbortBinding, isDeepLProxyAbortError } =
      await import('@/pages/api/deepl/translate');
    const req = new MockRequest();
    const res = new MockResponse();

    const binding = createDeepLProxyAbortBinding(req as never, res as never);

    res.emit('close');

    expect(binding.signal.aborted).toBe(true);
    expect(isDeepLProxyAbortError(binding.signal.reason)).toBe(true);

    binding.dispose();
  });

  it('passes the route abort signal to the downstream DeepL fetch', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: [{ text: 'ola' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { callDeepLAPI } = await import('@/pages/api/deepl/translate');

    await callDeepLAPI(
      'hello',
      'AUTO',
      'EN',
      'https://api-free.deepl.com/v2/translate',
      'auth-key',
      undefined,
      false,
      signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-free.deepl.com/v2/translate',
      expect.objectContaining({ signal }),
    );
  });

  it('stops the handler without returning 500 when the client aborts during downstream fetch', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const abortRequest = () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };

        if (init?.signal?.aborted) {
          abortRequest();
          return;
        }

        init?.signal?.addEventListener('abort', abortRequest, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { default: handler } = await import('@/pages/api/deepl/translate');
    const { getDeepLProxyObservabilitySnapshot } = await import('@/pages/api/deepl/observability');
    const req = new MockRequest();
    const res = new MockResponse();

    const handlerPromise = handler(req as never, res as never);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    res.emit('close');
    await handlerPromise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).not.toHaveBeenCalled();
    expect(usageStatsTrackUsageMock).not.toHaveBeenCalled();

    const snapshot = getDeepLProxyObservabilitySnapshot();
    expect(snapshot.metrics.requestsStarted).toBe(1);
    expect(snapshot.metrics.requestsAborted).toBe(1);
    expect(snapshot.metrics.downstreamFetchesStarted).toBe(1);
    expect(snapshot.metrics.downstreamFetchesAborted).toBe(1);
    expect(snapshot.derived.abortRate).toBe(1);
    expect(snapshot.derived.averageAbortDurationMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.recentEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'requestStarted',
        'downstreamFetchStarted',
        'downstreamFetchAborted',
        'requestAborted',
      ]),
    );
  });

  it('tracks usage side effects that finish after the client aborts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: [{ text: 'ola' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    let resolveUsageUpdate: ((value: number) => void) | undefined;
    usageStatsTrackUsageMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveUsageUpdate = resolve;
        }),
    );

    const { default: handler } = await import('@/pages/api/deepl/translate');
    const { getDeepLProxyObservabilitySnapshot } = await import('@/pages/api/deepl/observability');
    const req = new MockRequest();
    const res = new MockResponse();

    const handlerPromise = handler(req as never, res as never);
    await vi.waitFor(() => expect(usageStatsTrackUsageMock).toHaveBeenCalledTimes(1));
    res.emit('close');
    resolveUsageUpdate?.(10);
    await handlerPromise;

    const snapshot = getDeepLProxyObservabilitySnapshot();
    expect(snapshot.metrics.postAbortUsageUpdates).toBe(1);
    expect(snapshot.recentEvents.map((event) => event.type)).toContain('postAbortUsageUpdate');
  });
});

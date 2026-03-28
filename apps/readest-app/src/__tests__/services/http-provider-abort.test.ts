import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauriFetchMock = vi.fn();
const isTauriAppPlatformMock = vi.fn();
const getAPIBaseUrlMock = vi.fn(() => 'https://api.readest.test/api');
const normalizeToShortLangMock = vi.fn((lang: string) => lang);
const normalizeToFullLangMock = vi.fn((lang: string) => lang);
const getSubscriptionPlanMock = vi.fn<(token?: string | null) => string>(() => 'free');
const getTranslationQuotaMock = vi.fn<(plan: string) => number>(() => 1000);

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (input: URL | Request | string, init?: RequestInit) => tauriFetchMock(input, init),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => isTauriAppPlatformMock(),
  getAPIBaseUrl: () => getAPIBaseUrlMock(),
}));

vi.mock('@/utils/misc', () => ({
  stubTranslation: (value: string) => value,
}));

vi.mock('@/utils/lang', () => ({
  normalizeToShortLang: (lang: string) => normalizeToShortLangMock(lang),
  normalizeToFullLang: (lang: string) => normalizeToFullLangMock(lang),
}));

vi.mock('@/utils/access', () => ({
  getSubscriptionPlan: (token?: string | null) => getSubscriptionPlanMock(token),
  getTranslationQuota: (plan: string) => getTranslationQuotaMock(plan),
}));

describe('http translation providers abort support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    isTauriAppPlatformMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes AbortSignal to google browser fetch', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [[['ola', 'hello']]],
    });
    vi.stubGlobal('fetch', fetchMock);

    const { googleProvider } = await import('@/services/translators/providers/google');

    await googleProvider.translate(['hello'], 'AUTO', 'PT', undefined, undefined, signal);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('translate.googleapis.com'),
      expect.objectContaining({ signal }),
    );
  });

  it('passes AbortSignal to azure browser auth and translate requests', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'auth-token',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ translations: [{ text: 'ola' }] }],
      });
    vi.stubGlobal('fetch', fetchMock);

    const { azureProvider } = await import('@/services/translators/providers/azure');

    await azureProvider.translate(['hello'], 'AUTO', 'pt-BR', undefined, undefined, signal);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://edge.microsoft.com/translate/auth',
      expect.objectContaining({ signal }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('api-edge.cognitive.microsofttranslator.com/translate'),
      expect.objectContaining({ signal }),
    );
  });

  it('passes AbortSignal to yandex browser fetch', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: ['ola'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { yandexProvider } = await import('@/services/translators/providers/yandex');

    await yandexProvider.translate(['hello'], 'AUTO', 'PT', undefined, undefined, signal);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://translate.toil.cc/v2/translate/',
      expect.objectContaining({ signal }),
    );
  });

  it('passes AbortSignal to deepl client fetch', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: [{ text: 'ola' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { deeplProvider } = await import('@/services/translators/providers/deepl');

    await deeplProvider.translate(['hello'], 'AUTO', 'PT', 'token', false, signal);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.readest.test/api/deepl/translate',
      expect.objectContaining({ signal }),
    );
  });

  it('passes AbortSignal to tauri fetch when running in tauri', async () => {
    const signal = new AbortController().signal;
    isTauriAppPlatformMock.mockReturnValue(true);
    tauriFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [[['ola', 'hello']]],
    });

    const { googleProvider } = await import('@/services/translators/providers/google');

    await googleProvider.translate(['hello'], 'AUTO', 'PT', undefined, undefined, signal);

    expect(tauriFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('translate.googleapis.com'),
      expect.objectContaining({ signal }),
    );
  });
});

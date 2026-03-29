import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  getLocalCTranslate2BaseUrl: () => 'http://127.0.0.1:8765',
  isTauriAppPlatform: () => false,
}));

describe('localCTranslate2Provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts batched texts to the local HTTP service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        translations: [{ text: 'ola mundo' }, { text: 'bom dia' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    const result = await localCTranslate2Provider.translate(
      ['hello world', 'good morning'],
      'EN',
      'PT',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/translate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: ['hello world', 'good morning'],
          source_lang: 'EN',
          target_lang: 'PT',
        }),
      }),
    );
    expect(result).toEqual(['ola mundo', 'bom dia']);
  });

  it('preserves PT-BR as a valid target language', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: ['ola'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await localCTranslate2Provider.translate(['hello'], 'EN', 'PT-BR');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/translate',
      expect.objectContaining({
        body: JSON.stringify({
          texts: ['hello'],
          source_lang: 'EN',
          target_lang: 'PT-BR',
        }),
      }),
    );
  });

  it('accepts AUTO as source when translating to PT-BR', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: ['ola'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await localCTranslate2Provider.translate(
      ['hello'],
      'AUTO',
      'PT-BR',
      undefined,
      undefined,
      signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/translate',
      expect.objectContaining({
        signal,
        body: JSON.stringify({
          texts: ['hello'],
          source_lang: 'AUTO',
          target_lang: 'PT-BR',
        }),
      }),
    );
  });

  it('normalizes longer Portuguese locale tags to PT-BR', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: ['ola'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await localCTranslate2Provider.translate(['hello'], 'en-US', 'pt-BR-u-hc-h23');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/translate',
      expect.objectContaining({
        body: JSON.stringify({
          texts: ['hello'],
          source_lang: 'EN',
          target_lang: 'PT-BR',
        }),
      }),
    );
  });

  it('normalizes unsupported Portuguese regions to generic PT', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: ['ola'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await localCTranslate2Provider.translate(['hello'], 'EN', 'pt-AO');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/translate',
      expect.objectContaining({
        body: JSON.stringify({
          texts: ['hello'],
          source_lang: 'EN',
          target_lang: 'PT',
        }),
      }),
    );
  });

  it('checks local service availability through /health', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        model_path: '/models/nllb-200-ct2',
        device: 'cuda',
        tokenizer: 'facebook/nllb-200-distilled-600M',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    const availability = await localCTranslate2Provider.checkAvailability?.();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(availability).toEqual(
      expect.objectContaining({
        status: 'available',
        details: expect.objectContaining({
          device: 'cuda',
          modelPath: '/models/nllb-200-ct2',
        }),
      }),
    );
  });

  it('marks the provider as unavailable when the local healthcheck cannot connect', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    const availability = await localCTranslate2Provider.checkAvailability?.();

    expect(availability).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        message: 'Local CTranslate2 service is unavailable.',
      }),
    );
  });

  it('surfaces a backend error message when the local service rejects the language pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Unsupported language pair. Local CTranslate2 currently supports EN -> PT only.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await expect(localCTranslate2Provider.translate(['hola'], 'ES', 'PT')).rejects.toThrow(
      'Unsupported language pair. Local CTranslate2 currently supports AUTO/EN -> PT/PT-BR/PT-PT only.',
    );
  });

  it('fails early for an invalid target language without calling the local service', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await expect(localCTranslate2Provider.translate(['hello'], 'EN', 'es-ES')).rejects.toThrow(
      'Unsupported language pair. Local CTranslate2 currently supports AUTO/EN -> PT/PT-BR/PT-PT only.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails early for an invalid source language without calling the local service', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await expect(localCTranslate2Provider.translate(['bonjour'], 'FR', 'PT-BR')).rejects.toThrow(
      'Unsupported language pair. Local CTranslate2 currently supports AUTO/EN -> PT/PT-BR/PT-PT only.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

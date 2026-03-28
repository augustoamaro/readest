# HTTP Provider Abort Support

## Goal

Transformar a abort-readiness ja preparada na camada de traducao em cancelamento fisico real nos providers HTTP que suportam propagacao de `AbortSignal`, sem mudar UX nem reescrever a arquitetura.

## Which providers now support physical abort

- `google`: sim, no caminho web via `window.fetch` e no caminho Tauri via `@tauri-apps/plugin-http`
- `azure`: sim, tanto no request de auth token quanto no request de traducao, em web e Tauri
- `yandex`: sim, no caminho web via `window.fetch` e no caminho Tauri via `@tauri-apps/plugin-http`
- `deepl`: parcial. O cliente agora aborta fisicamente o request HTTP ate o endpoint `/deepl/translate`, mas o downstream do proxy no backend ainda nao e abortado nesta etapa

## How signal is propagated

- `TranslationProvider.translate(...)` agora aceita `signal?: AbortSignal`
- `service.translateTexts(...)` repassa `signal` ao provider e reconhece abort de forma estavel
- `facade` e `useTranslator` continuam repassando `signal` sem mudar a API visivel do app
- `inlineCoordinator` ja cria um `AbortController` por batch e agora esse `signal` chega ate o `fetch`/`tauriFetch` real dos providers HTTP

## Files changed

- `apps/readest-app/src/services/translators/providers/google.ts`
- `apps/readest-app/src/services/translators/providers/azure.ts`
- `apps/readest-app/src/services/translators/providers/yandex.ts`
- `apps/readest-app/src/services/translators/providers/deepl.ts`
- `apps/readest-app/src/services/translators/service.ts`
- `apps/readest-app/src/__tests__/services/http-provider-abort.test.ts`
- `apps/readest-app/src/__tests__/services/translator-service.test.ts`
- `docs/http-provider-abort-support.md`

## Why behavior should remain the same

- O fluxo funcional de traducao nao mudou.
- Quota, auth, fallback e retry continuam com a mesma politica.
- O novo comportamento so aparece quando existe cancelamento em voo; fora disso, os providers executam como antes.
- `AbortError` continua fora do retry leve no coordinator.

## Remaining limitations

- `deepl` ainda usa um endpoint proxy; abortar o request do cliente nao garante cancelar o request do servidor ate a API externa.
- O suporte fisico em Tauri depende do comportamento do `@tauri-apps/plugin-http` instalado; nesta codebase ele aceita `RequestInit` com `signal` e implementa cancelamento no bridge.
- Providers nao HTTP ou caminhos futuros locais/GPU nao foram tocados nesta etapa.

## Next step after this

O proximo passo recomendado e fechar o gap do `deepl` proxy, propagando cancelamento do request do cliente para o fetch do backend quando a rota `/deepl/translate` estiver em execucao. Depois disso, o cancelamento fisico ficara coerente em toda a cadeia HTTP atual.

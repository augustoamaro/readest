# DeepL Proxy Observability

## Goal

Adicionar observabilidade leve ao proxy DeepL para medir taxa de abort, tempo medio ate cancelamento e quantos side effects locais ainda terminam depois do disconnect do cliente, sem mudar UX nem introduzir analytics externos.

## What was added

- Um coletor em memoria com snapshot exportado para debug e testes.
- Contadores para requests do proxy:
  - `requestsStarted`
  - `requestsSucceeded`
  - `requestsFailed`
  - `requestsAborted`
- Contadores para o fetch downstream do DeepL:
  - `downstreamFetchesStarted`
  - `downstreamFetchesSucceeded`
  - `downstreamFetchesFailed`
  - `downstreamFetchesAborted`
- Contadores de side effects que terminaram depois do abort:
  - `postAbortUsageUpdates`
  - `postAbortCacheWrites`
- Metricas derivadas:
  - `abortRate`
  - `averageAbortDurationMs`
  - `averageRequestDurationMs`
  - `averageDownstreamDurationMs`

## How it is wired

- A rota `/deepl/translate` gera um `requestId`, registra `requestStarted` e fecha o request com `requestSucceeded`, `requestFailed` ou `requestAborted`.
- `callDeepLAPI(...)` registra o lifecycle do fetch downstream do DeepL.
- Se `trackUsage(...)` ou `KV.put(...)` terminarem depois de o cliente ja ter desconectado, isso fica contado nos eventos `postAbortUsageUpdate` e `postAbortCacheWrite`.

## Files changed

- `apps/readest-app/src/pages/api/deepl/observability.ts`
- `apps/readest-app/src/pages/api/deepl/translate.ts`
- `apps/readest-app/src/__tests__/pages/api/deepl-translate.test.ts`
- `docs/deepl-proxy-observability.md`

## Why this is safe

- A observabilidade e apenas em memoria e local ao processo.
- Nao muda resposta, quota, auth, cache ou UX.
- A rota continua tratando abort como `AbortError` e saindo silenciosamente quando o cliente desconecta.

## Remaining limitations

- As metricas nao sao persistidas entre restarts do processo.
- Ainda nao existe endpoint/UI para inspecionar o snapshot fora de debug/teste.
- A deteccao de disconnect continua dependente do runtime Node-compatible de `pages/api`.

## Next step

Se essas metricas mostrarem side effects relevantes apos disconnect, o passo seguinte e tornar quota/cache bookkeeping explicitamente signal-aware, ou mover esse estado para uma camada com cancelamento cooperativo mais fino.

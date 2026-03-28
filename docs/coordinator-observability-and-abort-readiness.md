# Coordinator Observability And Abort Readiness

## Goal

Adicionar observabilidade pequena ao `inlineCoordinator` e preparar a API de traducao para cancelamento real por request no futuro, sem mudar UX, sem trocar providers e sem exigir implementacao de abort fisico nesta etapa.

## Why observability matters now

O coordinator ja concentra batching, concorrencia, retry e dedupe. Sem observabilidade, fica dificil validar:

- onde o scheduler esta economizando trabalho
- quando batches estao falhando e sendo retried
- quantos resultados estao ficando obsoletos
- se o fluxo realmente alcanca estado idle

Esses sinais sao a base para depurar comportamento real e para decidir futuros ajustes de scheduling.

## What metrics/events were added

O coordinator agora aceita um callback opcional `onEvent` e mantem um snapshot interno com contadores cumulativos.

Eventos adicionados:

- `batchEnqueued`
- `batchStarted`
- `batchSucceeded`
- `batchRetried`
- `batchFailed`
- `dedupeHit`
- `staleResultIgnored`
- `idleReached`

Snapshot exposto por `getSnapshot()`:

- `generation`
- `queueSize`
- `activeBatches`
- `retryTimerCount`
- `inFlightBatchCount`
- contadores por tipo de evento

## How abort-readiness was prepared

- Foi introduzido `signal?: AbortSignal` no caminho de contrato de requisicao.
- `useTranslator` agora aceita `signal` por chamada de traducao.
- `facade` e `service` repassam esse `signal` ate o provider.
- O `service` agora reconhece abort antes e depois de pontos importantes do fluxo e usa um erro estavel do tipo `AbortError`.
- O `inlineCoordinator` cria um `AbortController` por batch em voo e aborta esses controllers em `cancel()` e `dispose()`.

Nesta etapa, isso prepara a API e o lifecycle para abort real, mas ainda nao obriga providers atuais a interromperem a request fisicamente.

## Files changed

- `apps/readest-app/src/services/translators/types.ts`
- `apps/readest-app/src/services/translators/service.ts`
- `apps/readest-app/src/services/translators/facade.ts`
- `apps/readest-app/src/services/translators/inlineCoordinator.ts`
- `apps/readest-app/src/hooks/useTranslator.ts`
- `apps/readest-app/src/app/reader/hooks/useTextTranslation.ts`
- `apps/readest-app/src/__tests__/services/translator-service.test.ts`
- `apps/readest-app/src/__tests__/services/translation-facade.test.ts`
- `apps/readest-app/src/__tests__/services/inlineCoordinator.test.ts`

## Why behavior should remain the same

- Nenhuma tela ou acao do usuario foi alterada.
- O hook do reader continua focado em observacao/renderizacao.
- Providers atuais continuam funcionando sem implementacao obrigatoria de abort real.
- O novo `signal` e opcional e backward-compatible.
- Observabilidade e interna/opcional; sem consumidor, ela nao muda o fluxo do app.

## Remaining limitations

- O cancelamento ainda e majoritariamente logico porque os providers atuais podem ignorar `signal`.
- A classificacao de erro retryable ainda depende de heuristica simples por `code` e mensagem.
- As metricas ainda sao locais ao coordinator; nao existe exportacao para analytics, logs persistentes ou painel de debug.
- O caminho de abort esta preparado, mas ainda nao existe `AbortSignal` propagado ate `fetch` em todos os providers.

## Next step after this

O proximo passo recomendado e adaptar os providers HTTP para aceitar e propagar `signal` ate `fetch` quando suportado. Isso converte o cancelamento preparado nesta etapa em cancelamento fisico real, sem reabrir o design do coordinator.

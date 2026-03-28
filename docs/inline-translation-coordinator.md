# Inline Translation Coordinator

## Goal

Mover queue lifecycle, batching, concorrencia e cancelamento do fluxo de traducao inline para uma camada pequena em `services/translators`, deixando `useTextTranslation` focado em descobrir elementos visiveis e aplicar o resultado no DOM. O objetivo desta etapa nao foi mudar UX nem providers, e sim validar um ponto de coordenacao reutilizavel para evolucoes futuras.

## Why queue lifecycle did not belong in the hook

Antes desta etapa, `useTextTranslation` acumulava responsabilidades demais:

- observava elementos visiveis
- gerenciava fila interna
- aplicava limites de concorrencia
- montava batches
- tratava cancelamento implicito ao trocar configuracao ou view
- aplicava traducoes no DOM

Esse acoplamento dificultava evoluir cancelamento, dedupe, scheduling mais avancado e futuras estrategias de provider sem reabrir o hook do reader.

## What moved to the coordinator

Foi introduzido um coordenador pequeno em `apps/readest-app/src/services/translators/inlineCoordinator.ts` com responsabilidades bem delimitadas:

- receber blocos inline para traducao
- deduplicar blocos por `id` dentro da geracao atual
- agrupar em batches pequenos
- limitar concorrencia
- ignorar resultados obsoletos apos `cancel()`
- emitir callback unico de resultados e callback de idle

`useTextTranslation` continua responsavel por:

- descobrir elementos visiveis
- associar elemento DOM a um `id` estavel
- enviar blocos ao coordenador
- aplicar o texto traduzido inline no DOM

## Files changed

- `apps/readest-app/src/services/translators/inlineCoordinator.ts`
- `apps/readest-app/src/services/translators/index.ts`
- `apps/readest-app/src/app/reader/hooks/useTextTranslation.ts`
- `apps/readest-app/src/__tests__/services/inlineCoordinator.test.ts`

## Why behavior should remain the same

- O fluxo de descoberta de elementos visiveis nao mudou.
- O render inline continua usando o mesmo markup e a mesma estrategia de atualizacao de DOM em batch.
- O batch size e a concorrencia permanecem os mesmos da etapa anterior, apenas sairam do hook e foram centralizados.
- O cancelamento continua conservador: resultados obsoletos sao ignorados, sem mudar provider, cache ou UI.

## Remaining limitations

- O cancelamento ainda e logico, nao fisico: requests em voo nao sao abortadas no provider, apenas ignoradas quando ficam obsoletas.
- Falha de provider ainda invalida o batch inteiro correspondente.
- Ainda nao existe priorizacao, retry, dedupe cross-view ou backpressure adaptativo.
- O cache continua com a mesma inicializacao atual e nao foi reorganizado nesta etapa.

## Next step after this

O proximo passo recomendado e promover o coordenador para uma politica de scheduling um pouco mais rica, sem tocar em provider local ainda. O alvo mais util e adicionar dedupe por texto e/ou retry leve por batch, mantendo a API de `facade` e do coordenador estavel para a futura entrada de fila persistente, batching mais inteligente e provider local.

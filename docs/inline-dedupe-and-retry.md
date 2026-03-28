# Inline Dedupe And Retry

## Goal

Fortalecer o scheduler de traducao inline sem mudar UX, providers ou arquitetura geral. Nesta etapa, o foco foi reduzir trabalho repetido dentro da mesma geracao de traducao e adicionar um retry curto e conservador para falhas com cara de rede ou servidor temporariamente indisponivel.

## Why dedupe/retry matter now

Com o lifecycle da fila ja movido para o coordenador, o proximo gargalo era operacional:

- blocos com texto equivalente ainda podiam ser traduzidos mais de uma vez na mesma geracao
- uma falha transitória de rede ou 5xx derrubava o batch inteiro sem tentativa curta de recuperacao

Esses dois pontos afetam eficiencia e resiliencia do scheduling e sao base importante antes de qualquer provider local.

## What changed

- O coordenador agora normaliza texto inline de forma simples e conservadora, colapsando whitespace e preservando o conteudo sem case-folding nem transformacoes semanticas.
- Blocos com texto normalizado equivalente compartilham uma unica traducao dentro da mesma geracao, inclusive quando chegam enquanto o batch ainda esta em voo.
- Depois que uma traducao equivalente ja foi concluida na geracao atual, novos blocos equivalentes recebem o resultado sem nova chamada ao provider.
- Foi adicionado retry leve por batch, com limite padrao de uma tentativa e pequeno delay.
- O retry so entra para falhas com perfil transitório, como rede, timeout e erros de servidor 5xx.
- Falhas de quota e autenticacao continuam sem retry.

## Files changed

- `apps/readest-app/src/services/translators/inlineCoordinator.ts`
- `apps/readest-app/src/__tests__/services/inlineCoordinator.test.ts`
- `docs/inline-dedupe-and-retry.md`

## Why behavior should remain the same

- O reader continua descobrindo os mesmos elementos visiveis e renderizando o mesmo markup inline.
- A associacao final continua por bloco original, com `id` e `originalText` preservados na volta ao hook.
- O batch size, a concorrencia e a interface publica do hook nao mudaram.
- O retry e curto, limitado e restrito a erros que parecem transitórios, para evitar loops agressivos ou mascarar falhas estruturais.

## Remaining limitations

- O retry continua logico e pequeno; requests em voo nao sao abortadas fisicamente no provider.
- A classificacao de erro transitório ainda depende de `code` conhecido e heuristica por mensagem.
- Dedupe vale apenas dentro da geracao atual do coordenador; nao existe dedupe persistente entre sessoes ou views.
- Falhas finais ainda derrubam o batch correspondente depois de esgotar o retry leve.

## Next step after this

O proximo passo recomendado e introduzir uma politica pequena de retry/backoff e observabilidade por batch, ainda sem tocar em provider local. O melhor candidato e registrar metricas/eventos do coordenador e preparar uma API de cancelamento real por request quando os providers passarem a suportar abort signal no futuro.

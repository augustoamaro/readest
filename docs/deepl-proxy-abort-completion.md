# DeepL Proxy Abort Completion

## Goal

Fechar o gap do proxy DeepL na rota `/deepl/translate`, propagando o cancelamento do request do cliente para o fetch executado no backend contra a API externa do DeepL, sem mudar UX nem reescrever a arquitetura.

## What was incomplete before

Antes desta etapa, o cliente ja abortava fisicamente o request ate `/deepl/translate`, mas a rota backend ainda continuava o trabalho local e o fetch downstream para o DeepL podia seguir em execucao mesmo depois do disconnect do cliente.

## How abort is now propagated through the DeepL proxy

- A rota cria um `AbortController` ligado ao lifecycle do request/resposta.
- O cancelamento e detectado por eventos Node-style do `NextApiRequest`/`NextApiResponse`:
  - `req.aborted`
  - `res.close` quando `writableEnded` ainda e falso
- O `signal` resultante e propagado para o `fetch` downstream que chama a API do DeepL.
- A rota tambem verifica esse `signal` antes e depois dos pontos principais do fluxo para parar cedo quando o cliente ja desconectou.
- Abort deixa de ser tratado como erro interno e sai silenciosamente, sem virar `500`.

## Files changed

- `apps/readest-app/src/pages/api/deepl/translate.ts`
- `apps/readest-app/src/__tests__/pages/api/deepl-translate.test.ts`
- `docs/deepl-proxy-abort-completion.md`

## Why behavior should remain the same

- Quando nao ha abort, quota, auth, cache e resposta continuam com o mesmo fluxo.
- O provider DeepL no cliente nao muda a UX; ele apenas se beneficia do cancelamento fisico completo do proxy.
- Abort continua fora do retry leve no coordinator porque o erro segue classificado como `AbortError`.

## Remaining limitations

- A deteccao de disconnect depende do runtime Node-compatible usado por `pages/api` e dos eventos `aborted`/`close`.
- Se o cliente desconectar antes de o handler da rota comecar, nao existe trabalho da rota para cancelar; isso continua sendo responsabilidade do runtime/framework.
- Operacoes internas ja iniciadas e nao signal-aware, como alguns passos de quota/usage bookkeeping, ainda nao sao fisicamente interrompidas no meio da execucao. O fetch externo do DeepL, que era o gap principal, agora e abortado.

## Next step after this

O proximo passo recomendado e consolidar uma pequena suite de observabilidade do proxy e dos providers para medir taxa de abort, tempo medio ate cancelamento e quantos batches ainda terminam em side effects locais apos disconnect. Isso ajuda a decidir se vale tornar quota/cache bookkeeping tambem signal-aware no futuro.

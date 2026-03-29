# Local CTranslate2 Healthcheck And Availability

## Goal

Adicionar healthcheck e disponibilidade explicita ao provider `local-ctranslate2` para que ele nao pareca uma opcao normal quando o servico local estiver fora do ar, sem mexer no fluxo dos outros providers.

## Why healthcheck is needed now

- O provider local ja aparece no app.
- Sem healthcheck, ele parece estar sempre pronto mesmo quando o servidor Python nao esta rodando.
- Isso gera UX confusa porque o erro so aparece na hora da traducao.

## Architecture choice

- Mantido o desenho atual com um endpoint HTTP local simples.
- O servidor Python agora expõe `GET /health`.
- A facade ganhou um cache leve de availability com TTL curto, sem polling agressivo e sem estado global pesado.

## Files changed

- `apps/readest-app/src/services/translators/types.ts`
- `apps/readest-app/src/services/translators/providers/local-ctranslate2.ts`
- `apps/readest-app/src/services/translators/facade.ts`
- `apps/readest-app/src/hooks/useTranslator.ts`
- `apps/readest-app/src/components/settings/LangPanel.tsx`
- `apps/readest-app/src/app/reader/components/annotator/TranslatorPopup.tsx`
- `apps/readest-app/src/__tests__/services/local-ctranslate2-provider.test.ts`
- `apps/readest-app/src/__tests__/services/translation-facade.test.ts`
- `local-services/ctranslate2/server.py`
- `docs/local-ctranslate2-healthcheck-and-availability.md`

## How availability is exposed

- O provider local implementa `checkAvailability(signal?)`.
- A facade agora expõe:
  - `getProviderAvailability(name)`
  - `refreshProviderAvailability(name, { force?, signal? })`
- O healthcheck retorna:
  - `status`
  - `model_path`
  - `device`
  - `tokenizer`
- O cache de availability usa TTL curto para evitar refetch agressivo a cada render.

## UI behavior

- No painel de idioma, se o provider local estiver offline:
  - ele sai da lista normal de opcoes
  - se ja estiver selecionado, continua aparecendo como selecionado, mas com label `Offline`
  - um texto curto explica que o servico local precisa ser iniciado
- No popup de traducao:
  - o provider local tambem nao aparece como opcao normal quando offline
  - se ja estiver selecionado, aparece como `Offline`
  - falhas de conexao mostram uma mensagem especifica para o servico local
- Os outros providers continuam com o mesmo comportamento atual.

## Current limitations

- Ainda nao existe polling continuo nem refresh manual dedicado na UI.
- Se o servico subir ou cair fora do TTL do cache, a UI so reflete isso no proximo refresh disparado pela tela.
- O provider local ainda nao e auto-start e o servidor Python nao interrompe a inferencia CT2 no meio.

## Next step after this

O proximo passo recomendado e adicionar um refresh manual pequeno na UI ou um healthcheck on-demand ao selecionar o provider local. Isso fecha o ciclo de disponibilidade antes de pensar em auto-start ou setup assistido de modelo.

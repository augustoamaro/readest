# Local CTranslate2 Provider Plan

## Goal

Adicionar o primeiro provider local opcional ao fork do Readest sem reescrever a arquitetura atual, reutilizando o registry de providers, o service, a facade e o pipeline de cache/orquestracao ja existentes.

## Why CTranslate2 was chosen for the first local provider

- CTranslate2 oferece inferencia local eficiente para modelos seq2seq em CPU e GPU.
- Ele encaixa bem no objetivo futuro de rodar traducao local em desktop sem depender do limite do app hospedado.
- Para uma primeira etapa conservadora, ele permite separar claramente:
  - app/provider TypeScript
  - backend local de inferencia
  - configuracao manual de modelo

## Architecture choice

- Escolha feita: pequeno servico local HTTP em Python.
- Motivo principal: menor acoplamento com o app atual.
- Vantagens:
  - o provider novo segue o mesmo padrao HTTP dos providers existentes
  - `AbortSignal` continua passando pelo caminho normal de `fetch`
  - nao exige introduzir gerenciamento de processo dentro do app nesta primeira etapa
  - deixa um contrato claro para evoluir depois para auto-start, healthcheck e observabilidade propria

## Provider contract

- Nome do provider: `local-ctranslate2`
- Endpoint esperado: `POST {NEXT_PUBLIC_LOCAL_CTRANSLATE2_BASE_URL}/translate`
- Request:
  - `texts: string[]`
  - `source_lang: string`
  - `target_lang: string`
- Response:
  - `translations: Array<{ text: string }>`
- O provider aceita batch de textos, repassa `signal?: AbortSignal` para o request HTTP local e usa o cache existente indiretamente via pipeline atual do `TranslationService`.

## Files added/changed

- `apps/readest-app/src/services/translators/providers/local-ctranslate2.ts`
- `apps/readest-app/src/services/translators/providers/index.ts`
- `apps/readest-app/src/services/environment.ts`
- `apps/readest-app/.env.local.example`
- `apps/readest-app/src/__tests__/services/local-ctranslate2-provider.test.ts`
- `local-services/ctranslate2/server.py`
- `local-services/ctranslate2/requirements.txt`
- `docs/local-ctranslate2-provider-plan.md`

## How to run locally

1. Criar um ambiente Python:
   `cd local-services/ctranslate2`
   `python3 -m venv .venv`
   `source .venv/bin/activate`
2. Instalar dependencias:
   `pip install -r requirements.txt`
3. Preparar um modelo CTranslate2 compativel com NLLB e apontar o caminho em `CTRANSLATE2_MODEL_PATH`.
4. Subir o servico local:
   `python server.py --model-path /caminho/do/modelo-ct2 --tokenizer facebook/nllb-200-distilled-600M --device cuda`
5. Configurar o app, se necessario:
   `NEXT_PUBLIC_LOCAL_CTRANSLATE2_BASE_URL=http://127.0.0.1:8765`
6. No Readest, selecionar o provider `Local CTranslate2 (en->pt)`.

## Current limitations

- Esta primeira versao foca apenas em English -> Portuguese.
- O servico local aceita `AUTO` como alias conservador para ingles; nao faz deteccao real de idioma.
- O request do app pode ser abortado com `AbortSignal`, mas o servidor Python ainda nao interrompe fisicamente uma inferencia CT2 ja iniciada.
- O setup do modelo ainda e manual.
- O provider ainda aparece como opcao geral; ele nao foi escondido por plataforma nem virou default.

## Next step after this

O proximo passo recomendado e adicionar healthcheck/availability na facade ou na UI de settings para que o provider local so apareca como pronto quando o servico local estiver acessivel. Depois disso, vale evoluir o servidor para cancelamento cooperativo, melhor suporte a pares de idioma e setup assistido do modelo.

#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


SUPPORTED_SOURCE_LANGS = {"AUTO", "EN", "EN-US", "EN-GB"}
SUPPORTED_TARGET_LANGS = {"PT", "PT-BR", "PT-PT"}
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_TOKENIZER = "facebook/nllb-200-distilled-600M"


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


class NLLBCTranslate2Translator:
    def __init__(
        self,
        model_path: str,
        tokenizer_name_or_path: str,
        device: str,
        compute_type: str,
        inter_threads: int,
        intra_threads: int,
    ) -> None:
        import ctranslate2
        from transformers import AutoTokenizer

        self._translator = ctranslate2.Translator(
            model_path,
            device=device,
            compute_type=compute_type,
            inter_threads=inter_threads,
            intra_threads=intra_threads,
        )
        self._tokenizer = AutoTokenizer.from_pretrained(tokenizer_name_or_path)

    def translate_batch(self, texts: list[str], source_lang: str, target_lang: str) -> list[str]:
        normalized_source = source_lang.upper()
        normalized_target = target_lang.upper()
        if normalized_source not in SUPPORTED_SOURCE_LANGS or normalized_target not in SUPPORTED_TARGET_LANGS:
            raise ValueError(
                "Unsupported language pair. Local CTranslate2 currently supports EN -> PT only."
            )

        cleaned_texts = [text.replace("\n", " ").strip() for text in texts]
        self._tokenizer.src_lang = "eng_Latn"

        source_tokens = []
        for text in cleaned_texts:
            token_ids = self._tokenizer.encode(text)
            source_tokens.append(self._tokenizer.convert_ids_to_tokens(token_ids))

        target_prefix = [["por_Latn"]] * len(source_tokens)
        results = self._translator.translate_batch(source_tokens, target_prefix=target_prefix)

        translations: list[str] = []
        for result in results:
            tokens = result.hypotheses[0]
            if tokens and tokens[0] == "por_Latn":
                tokens = tokens[1:]
            token_ids = self._tokenizer.convert_tokens_to_ids(tokens)
            translations.append(self._tokenizer.decode(token_ids, skip_special_tokens=True).strip())

        return translations


def build_handler(translator: NLLBCTranslate2Translator):
    class LocalCTranslate2Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self) -> None:
            json_response(self, 204, {})

        def do_GET(self) -> None:
            if self.path != "/health":
                json_response(self, 404, {"error": "Not found"})
                return

            json_response(
                self,
                200,
                {
                    "status": "ok",
                    "provider": "local-ctranslate2",
                    "supported_source_langs": sorted(SUPPORTED_SOURCE_LANGS),
                    "supported_target_langs": sorted(SUPPORTED_TARGET_LANGS),
                },
            )

        def do_POST(self) -> None:
            if self.path != "/translate":
                json_response(self, 404, {"error": "Not found"})
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)

            try:
                payload = json.loads(raw_body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                json_response(self, 400, {"error": "Invalid JSON body"})
                return

            texts = payload.get("texts")
            source_lang = str(payload.get("source_lang", "AUTO")).upper()
            target_lang = str(payload.get("target_lang", "PT")).upper()

            if not isinstance(texts, list) or not all(isinstance(item, str) for item in texts):
                json_response(self, 400, {"error": '"texts" must be an array of strings'})
                return

            try:
                translations = translator.translate_batch(texts, source_lang, target_lang)
            except ValueError as exc:
                json_response(self, 422, {"error": str(exc)})
                return
            except Exception as exc:  # pragma: no cover - defensive path for local setup
                json_response(self, 500, {"error": f"Local translation failed: {exc}"})
                return

            json_response(
                self,
                200,
                {
                    "translations": [{"text": translated} for translated in translations],
                },
            )

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            return

    return LocalCTranslate2Handler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local CTranslate2 translation service for Readest")
    parser.add_argument("--host", default=os.environ.get("CTRANSLATE2_HOST", DEFAULT_HOST))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("CTRANSLATE2_PORT", str(DEFAULT_PORT))),
    )
    parser.add_argument(
        "--model-path",
        default=os.environ.get("CTRANSLATE2_MODEL_PATH"),
        required=os.environ.get("CTRANSLATE2_MODEL_PATH") is None,
    )
    parser.add_argument(
        "--tokenizer",
        default=os.environ.get("CTRANSLATE2_TOKENIZER", DEFAULT_TOKENIZER),
    )
    parser.add_argument(
        "--device",
        default=os.environ.get("CTRANSLATE2_DEVICE", "cuda"),
    )
    parser.add_argument(
        "--compute-type",
        default=os.environ.get("CTRANSLATE2_COMPUTE_TYPE", "default"),
    )
    parser.add_argument(
        "--inter-threads",
        type=int,
        default=int(os.environ.get("CTRANSLATE2_INTER_THREADS", "1")),
    )
    parser.add_argument(
        "--intra-threads",
        type=int,
        default=int(os.environ.get("CTRANSLATE2_INTRA_THREADS", "0")),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    translator = NLLBCTranslate2Translator(
        model_path=args.model_path,
        tokenizer_name_or_path=args.tokenizer,
        device=args.device,
        compute_type=args.compute_type,
        inter_threads=args.inter_threads,
        intra_threads=args.intra_threads,
    )
    server = ThreadingHTTPServer((args.host, args.port), build_handler(translator))
    print(
        f"Local CTranslate2 server listening on http://{args.host}:{args.port} "
        f"using model={args.model_path} tokenizer={args.tokenizer} device={args.device}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()

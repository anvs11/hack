"""Replaceable replay and local Hugging Face analysis adapters."""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.app.config import (
    REPOSITORY_ROOT,
    allow_hf_download,
    get_hf_cache_dir,
    get_hf_model_id,
)
from backend.app.modules.publications.schemas import (
    Analyzer,
    Category,
    Criteria,
    Entity,
    Evidence,
    Priority,
)


Generator = Callable[..., Any]


class AnalyzerUnavailable(RuntimeError):
    pass


class AnalyzerOutputInvalid(RuntimeError):
    pass


class AnalysisDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    prompt_version: str
    summary: str
    facts: list[str]
    entities: list[Entity]
    category: Category
    proposed_priority: Priority
    criteria: Criteria
    score: int = Field(ge=0)
    evidence: list[Evidence]
    uncertainty: float = Field(ge=0, le=1)
    needs_review: bool


class LiveModelOutput(BaseModel):
    """Fields the model may propose before deterministic scoring exists."""

    model_config = ConfigDict(extra="forbid")

    summary: str
    facts: list[str]
    entities: list[Entity]
    category: Category
    criteria: Criteria
    evidence: list[Evidence]
    uncertainty: float = Field(ge=0, le=1)


class ContentAnalyzer(Protocol):
    analyzer: Analyzer

    def analyze(
        self,
        *,
        publication_id: str,
        title: str,
        content: str,
    ) -> AnalysisDraft: ...


class ReplayAnalyzer:
    analyzer = Analyzer.REPLAY

    def __init__(self, replay_path: Path | None = None) -> None:
        self.replay_path = replay_path or (
            REPOSITORY_ROOT / "data" / "seed" / "replay-analyses.json"
        )

    def analyze(
        self,
        *,
        publication_id: str,
        title: str,
        content: str,
    ) -> AnalysisDraft:
        del title, content
        try:
            with self.replay_path.open(encoding="utf-8") as stream:
                rows = json.load(stream)
            row = next(
                (item for item in rows if item.get("publication_id") == publication_id),
                None,
            )
            if row is None:
                raise AnalyzerUnavailable("Для публикации нет replay-анализа")
            values = {field: row[field] for field in AnalysisDraft.model_fields}
            return AnalysisDraft.model_validate(values)
        except AnalyzerUnavailable:
            raise
        except (OSError, KeyError, TypeError, json.JSONDecodeError, ValidationError) as error:
            raise AnalyzerOutputInvalid("Replay-анализ повреждён") from error


class LiveLLMAnalyzer:
    analyzer = Analyzer.LIVE_LLM
    prompt_version = "analysis-v2"

    def __init__(
        self,
        *,
        generator: Generator | None = None,
        model_id: str | None = None,
        cache_dir: Path | None = None,
        download_allowed: bool | None = None,
    ) -> None:
        self.model_id = model_id or get_hf_model_id()
        self.cache_dir = cache_dir or get_hf_cache_dir()
        self.download_allowed = (
            allow_hf_download() if download_allowed is None else download_allowed
        )
        self._generator = generator

    def analyze(
        self,
        *,
        publication_id: str,
        title: str,
        content: str,
    ) -> AnalysisDraft:
        del publication_id
        generator = self._generator or self._load_generator()
        prompt = _analysis_prompt(title=title, content=content)
        last_error: Exception | None = None

        for attempt in range(2):
            try:
                result = generator(
                    text=[
                        {
                            "role": "user",
                            "content": [{"type": "text", "text": prompt}],
                        }
                    ],
                    max_new_tokens=768,
                    do_sample=False,
                    return_full_text=False,
                )
                model_output = LiveModelOutput.model_validate(
                    _extract_json(_generated_text(result))
                )
                return AnalysisDraft(
                    model=self.model_id,
                    prompt_version=self.prompt_version,
                    **model_output.model_dump(),
                    proposed_priority=Priority.UNKNOWN,
                    score=0,
                    needs_review=True,
                )
            except (AnalyzerOutputInvalid, ValidationError) as error:
                last_error = error
                prompt += (
                    "\nПредыдущий ответ не прошёл JSON Schema. "
                    "Верни только один исправленный JSON-объект."
                )
            except Exception as error:
                raise AnalyzerUnavailable(
                    "Локальный Hugging Face analyzer недоступен"
                ) from error

        raise AnalyzerOutputInvalid("LLM дважды вернула невалидный JSON") from last_error

    def _load_generator(self) -> Generator:
        try:
            from transformers import pipeline

            return pipeline(
                "image-text-to-text",
                model=self.model_id,
                dtype="auto",
                model_kwargs={
                    "cache_dir": str(self.cache_dir),
                    "local_files_only": not self.download_allowed,
                    "trust_remote_code": False,
                },
            )
        except Exception as error:
            raise AnalyzerUnavailable(
                "Qwen не найден локально; установи LLM-зависимости и явно разреши download"
            ) from error


def build_analyzer(analyzer: Analyzer) -> ContentAnalyzer:
    if analyzer is Analyzer.REPLAY:
        return ReplayAnalyzer()
    return LiveLLMAnalyzer()


def _analysis_prompt(*, title: str, content: str) -> str:
    schema = LiveModelOutput.model_json_schema()
    return (
        "Проанализируй публикацию для PR/GR-специалиста. Summary должен содержать "
        "3-5 коротких предложений. "
        "Не добавляй факты, которых нет в тексте. Evidence.quote должен быть точной "
        "цитатой из текста. Оцени K1-K6 целыми числами от 0 до 3: "
        "K1 — применимость к бизнесу, K2 — юридическая сила или зрелость события, "
        "K3 — финансовое влияние, K4 — сложность адаптации, "
        "K5 — юридический или репутационный риск, K6 — срочность. "
        "Установи hard flag только при прямом основании в тексте: "
        "H1 — изменение ИТ-аккредитации или льгот; "
        "H2 — уголовная, блокирующая ответственность или риск приостановки сервиса; "
        "H3 — признание ИИ, конфиденциальных данных, ЦОД или ПО стратегически значимыми; "
        "H4 — обязательный судебный или правовой прецедент, прямо применимый к бизнесу. "
        "Верни только JSON по схеме ниже. Не вычисляй score и priority — это делает "
        "обычный код.\n"
        f"JSON Schema: {json.dumps(schema, ensure_ascii=False)}\n"
        f"Заголовок: {title}\nТекст: {content}"
    )


def _generated_text(result: Any) -> str:
    if not isinstance(result, list) or not result or not isinstance(result[0], dict):
        raise AnalyzerOutputInvalid("Неожиданный ответ transformers pipeline")
    generated = result[0].get("generated_text")
    if isinstance(generated, str):
        return generated
    if isinstance(generated, list):
        for message in reversed(generated):
            content = message.get("content") if isinstance(message, dict) else None
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                for part in reversed(content):
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        return part["text"]
    raise AnalyzerOutputInvalid("В ответе модели нет generated_text")


def _extract_json(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _end = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise AnalyzerOutputInvalid("В ответе модели нет JSON-объекта")

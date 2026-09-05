"""Replaceable replay and local Hugging Face analysis adapters."""

import json
import re
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from backend.app.config import (
    REPOSITORY_ROOT,
    allow_hf_download,
    get_hf_cache_dir,
    get_hf_model_id,
    get_llm_api_base_url,
    get_llm_api_key,
    get_llm_api_model_id,
    get_llm_api_timeout,
    get_llm_reasoning_effort,
    get_llm_max_input_chars,
    get_llm_max_new_tokens,
    get_llm_provider,
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
    importance_score: int | None = Field(default=None, ge=0)
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

    @field_validator("summary")
    @classmethod
    def validate_summary_sentences(cls, value: str) -> str:
        summary = value.strip()
        sentence_count = len(re.findall(r"[.!?]+(?:\s|$)", summary))
        if not 3 <= sentence_count <= 5:
            raise ValueError("summary must contain 3 to 5 sentences")
        return summary


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
    prompt_version = "analysis-v3"

    def __init__(
        self,
        *,
        generator: Generator | None = None,
        model_id: str | None = None,
        cache_dir: Path | None = None,
        download_allowed: bool | None = None,
        max_input_chars: int | None = None,
        max_new_tokens: int | None = None,
        provider: str | None = None,
        api_base_url: str | None = None,
        api_key: str | None = None,
        api_timeout: int | None = None,
        reasoning_effort: str | None = None,
    ) -> None:
        self.provider = provider or get_llm_provider()
        self.model_id = model_id or (
            get_llm_api_model_id()
            if self.provider == "openai_compatible"
            else get_hf_model_id()
        )
        self.cache_dir = cache_dir or get_hf_cache_dir()
        self.download_allowed = (
            allow_hf_download() if download_allowed is None else download_allowed
        )
        self.max_input_chars = max_input_chars or get_llm_max_input_chars()
        self.max_new_tokens = max_new_tokens or get_llm_max_new_tokens()
        self.api_base_url = api_base_url or get_llm_api_base_url()
        self.api_key = api_key or get_llm_api_key()
        self.api_timeout = api_timeout or get_llm_api_timeout()
        self.reasoning_effort = (
            reasoning_effort
            if reasoning_effort is not None
            else get_llm_reasoning_effort()
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
        if self._generator is None:
            self._generator = self._load_generator()
        generator = self._generator
        prompt = _analysis_prompt(
            title=title,
            content=content[: self.max_input_chars],
        )
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
                    max_new_tokens=self.max_new_tokens,
                    do_sample=False,
                    return_full_text=False,
                )
                model_output = LiveModelOutput.model_validate(
                    _extract_json(_generated_text(result))
                )
                normalized_content = _normalize_text(content)
                for evidence in model_output.evidence:
                    quote = _normalize_text(evidence.quote)
                    if not quote or quote not in normalized_content:
                        raise AnalyzerOutputInvalid(
                            "Evidence.quote должен быть дословной цитатой из исходного текста"
                        )
                if len(content.strip()) >= 500 and len(model_output.summary) >= len(content):
                    raise AnalyzerOutputInvalid(
                        "Live summary must be shorter than the source text"
                    )
                return AnalysisDraft(
                    model=self.model_id,
                    prompt_version=self.prompt_version,
                    **model_output.model_dump(),
                    proposed_priority=Priority.UNKNOWN,
                    importance_score=None,
                    needs_review=True,
                )
            except (AnalyzerOutputInvalid, ValidationError) as error:
                last_error = error
                prompt += (
                    "\nПредыдущий ответ не прошёл JSON Schema или проверку точности цитат. "
                    "Скопируй каждый Evidence.quote дословно из исходного текста и верни "
                    "только один исправленный JSON-объект."
                )
            except AnalyzerUnavailable:
                raise
            except Exception as error:
                raise AnalyzerUnavailable("LLM analyzer недоступен") from error

        raise AnalyzerOutputInvalid("LLM дважды вернула невалидный JSON") from last_error

    def _load_generator(self) -> Generator:
        if self.provider == "openai_compatible":
            if not self.api_base_url or not self.api_key:
                raise AnalyzerUnavailable(
                    "Сервис AI-анализа не настроен: добавьте адрес и ключ inference API"
                )
            return OpenAICompatibleGenerator(
                base_url=self.api_base_url,
                api_key=self.api_key,
                model_id=self.model_id,
                timeout=self.api_timeout,
                reasoning_effort=self.reasoning_effort,
            )
        try:
            from huggingface_hub import snapshot_download
            from transformers import AutoConfig, pipeline

            local_model = Path(self.model_id)
            if not local_model.exists():
                local_model = Path(
                    snapshot_download(
                        repo_id=self.model_id,
                        cache_dir=self.cache_dir,
                        local_files_only=not self.download_allowed,
                    )
                )
            loading = {
                "local_files_only": True,
                "trust_remote_code": False,
            }
            config = AutoConfig.from_pretrained(local_model, **loading)
            task = (
                "image-text-to-text"
                if config.model_type == "qwen3_5"
                else "text-generation"
            )
            generator = pipeline(
                task,
                model=local_model,
                dtype="auto",
            )
            if task == "text-generation":
                return _TextGeneratorAdapter(generator)
            return generator
        except Exception as error:
            raise AnalyzerUnavailable(
                "Qwen не найден локально; установи LLM-зависимости и явно разреши download"
            ) from error


class _TextGeneratorAdapter:
    """Accept the same multimodal chat envelope as the Qwen 3.5 pipeline."""

    def __init__(self, generator: Generator) -> None:
        self.generator = generator

    def __call__(self, *, text: list[dict[str, Any]], **kwargs: Any) -> Any:
        return self.generator(_plain_messages(text), **kwargs)


class OpenAICompatibleGenerator:
    """Small adapter for vLLM, Hugging Face routers and compatible providers."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model_id: str,
        timeout: int,
        reasoning_effort: str | None = None,
    ) -> None:
        self.url = f"{base_url.rstrip('/')}/chat/completions"
        self.api_key = api_key
        self.model_id = model_id
        self.timeout = timeout
        self.reasoning_effort = reasoning_effort

    def __call__(
        self,
        *,
        text: list[dict[str, Any]],
        max_new_tokens: int,
        do_sample: bool,
        return_full_text: bool,
    ) -> list[dict[str, str]]:
        del do_sample, return_full_text
        messages = _plain_messages(text)
        payload: dict[str, Any] = {
            "model": self.model_id,
            "messages": messages,
            "temperature": 0,
            "max_tokens": max_new_tokens,
        }
        if self.reasoning_effort:
            payload["reasoning"] = {"effort": self.reasoning_effort}
        body = json.dumps(payload).encode("utf-8")
        request = Request(
            self.url,
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "AI-Product-Hack/0.4",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            generated = payload["choices"][0]["message"]["content"]
            if not isinstance(generated, str):
                raise TypeError("message content is not a string")
            return [{"generated_text": generated}]
        except (
            HTTPError,
            URLError,
            KeyError,
            IndexError,
            TypeError,
            json.JSONDecodeError,
        ) as error:
            raise AnalyzerUnavailable("OpenAI-compatible LLM request failed") from error


def _plain_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    result = []
    for message in messages:
        parts = message.get("content", [])
        content = "\n".join(
            part["text"]
            for part in parts
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
        result.append({"role": message.get("role", "user"), "content": content})
    return result


@lru_cache(maxsize=2)
def build_analyzer(analyzer: Analyzer) -> ContentAnalyzer:
    if analyzer is Analyzer.REPLAY:
        return ReplayAnalyzer()
    return LiveLLMAnalyzer()


def _analysis_prompt(*, title: str, content: str) -> str:
    schema = LiveModelOutput.model_json_schema()
    return (
        "Проанализируй публикацию для PR/GR-специалиста. Summary должен содержать "
        "3-5 коротких предложений и быть короче исходного текста. "
        "Не добавляй факты, которых нет в тексте. Evidence.quote должен быть точной "
        "цитатой, дословно скопированной из текста без исправлений и пересказа. "
        "Оцени каждый критерий целым числом от 0 до 3. "
        "Если в тексте не хватает данных, верни null, а не придумывай оценку: "
        "business_relevance — применимость к бизнесу; "
        "event_maturity — подтверждённость и зрелость события; "
        "financial_impact — возможное финансовое влияние; "
        "implementation_effort — сложность необходимых изменений; "
        "risk_severity — тяжесть юридического или репутационного риска; "
        "action_urgency — срочность реакции. "
        "Установи hard signal только при прямом основании в тексте: "
        "state_support_or_accreditation_change — изменение господдержки, льгот или аккредитации; "
        "service_or_legal_blocking_risk — блокировка сервиса, запрет, уголовная ответственность; "
        "strategic_technology_status — ИИ, данные, ЦОД или ПО объявлены стратегически значимыми; "
        "binding_legal_precedent — обязательный правовой или судебный прецедент для бизнеса. "
        "Верни только JSON по схеме ниже. Не вычисляй importance_score и priority — это делает "
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


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).casefold()


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

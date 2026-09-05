"""Contract-shaped publication and analysis response models."""

from datetime import datetime
from enum import StrEnum
from typing import Self

from pydantic import (
    AliasChoices,
    AwareDatetime,
    AnyUrl,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class Category(StrEnum):
    REGULATION = "regulation"
    REPUTATION = "reputation"
    COMPETITOR = "competitor"
    TREND = "trend"
    UNKNOWN = "unknown"


class Priority(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"


class Analyzer(StrEnum):
    REPLAY = "replay"
    LIVE_LLM = "live_llm"


class DecisionStatus(StrEnum):
    CONFIRMED = "confirmed"
    CORRECTED = "corrected"
    REJECTED = "rejected"


class PublicationVisibility(StrEnum):
    ACTIVE = "active"
    HIDDEN = "hidden"
    ALL = "all"


class Entity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    value: str


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim: str
    quote: str = Field(max_length=500)


class Criteria(BaseModel):
    model_config = ConfigDict(extra="forbid")

    business_relevance: int | None = Field(
        ge=0,
        le=3,
        validation_alias=AliasChoices("business_relevance", "K1"),
    )
    event_maturity: int | None = Field(
        ge=0,
        le=3,
        validation_alias=AliasChoices("event_maturity", "K2"),
    )
    financial_impact: int | None = Field(
        ge=0,
        le=3,
        validation_alias=AliasChoices("financial_impact", "K3"),
    )
    implementation_effort: int | None = Field(
        ge=0,
        le=3,
        validation_alias=AliasChoices("implementation_effort", "K4"),
    )
    risk_severity: int | None = Field(
        ge=0,
        le=3,
        validation_alias=AliasChoices("risk_severity", "K5"),
    )
    action_urgency: int | None = Field(
        ge=0,
        le=3,
        validation_alias=AliasChoices("action_urgency", "K6"),
    )
    state_support_or_accreditation_change: bool = Field(
        validation_alias=AliasChoices("state_support_or_accreditation_change", "H1")
    )
    service_or_legal_blocking_risk: bool = Field(
        validation_alias=AliasChoices("service_or_legal_blocking_risk", "H2")
    )
    strategic_technology_status: bool = Field(
        validation_alias=AliasChoices("strategic_technology_status", "H3")
    )
    binding_legal_precedent: bool = Field(
        validation_alias=AliasChoices("binding_legal_precedent", "H4")
    )


class PublicationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source_id: str
    external_id: str
    title: str
    original_url: AnyUrl
    published_at: datetime
    collected_at: datetime
    content: str
    content_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    is_demo: bool
    latest_analysis_id: str | None = None
    latest_revision_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    is_hidden: bool = False
    is_manual: bool = False
    updated_at: datetime


class PublicationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    original_url: AnyUrl
    published_at: AwareDatetime
    content: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    author_id: str = Field(min_length=1)

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str]) -> list[str]:
        return _normalize_tags(value)


class PublicationPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1)
    tags: list[str] | None = None
    is_hidden: bool | None = None
    author_id: str = Field(min_length=1)

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str] | None) -> list[str] | None:
        return _normalize_tags(value) if value is not None else None

    @model_validator(mode="after")
    def require_edit(self) -> Self:
        editable = {"title", "tags", "is_hidden"}
        submitted = editable.intersection(self.model_fields_set)
        if not submitted:
            raise ValueError("at least one editable field is required")
        if any(getattr(self, field) is None for field in submitted):
            raise ValueError("patch fields cannot be null")
        return self


def _normalize_tags(tags: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_tag in tags:
        tag = " ".join(raw_tag.split())
        key = tag.casefold()
        if not tag or key in seen:
            continue
        seen.add(key)
        normalized.append(tag)
    return normalized


class PublicationRevisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    publication_id: str
    version: int = Field(ge=1)
    title: str
    tags: list[str]
    is_hidden: bool
    author_id: str
    created_at: datetime


class AnalysisVersionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    publication_id: str
    version: int = Field(ge=1)
    analyzer: Analyzer
    model: str
    prompt_version: str
    input_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    summary: str
    facts: list[str]
    entities: list[Entity]
    category: Category
    proposed_priority: Priority
    criteria: Criteria
    importance_score: int | None = Field(
        ge=0,
        le=18,
        validation_alias=AliasChoices("importance_score", "score"),
    )
    evidence: list[Evidence]
    uncertainty: float = Field(ge=0, le=1)
    needs_review: bool
    created_at: datetime


class SpecialistDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    publication_id: str
    analysis_id: str
    version: int = Field(ge=1)
    status: DecisionStatus
    final_summary: str | None = None
    final_category: Category
    final_priority: Priority
    comment: str | None = None
    author_id: str
    created_at: datetime


class PublicationDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    publication: PublicationResponse
    latest_analysis: AnalysisVersionResponse | None = None
    latest_decision: SpecialistDecision | None = None


class PublicationList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[PublicationDetail]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)


class PublicationHistory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    publication_id: str
    revisions: list[PublicationRevisionResponse]
    analyses: list[AnalysisVersionResponse]
    decisions: list[SpecialistDecision]

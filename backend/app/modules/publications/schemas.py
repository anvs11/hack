"""Contract-shaped publication and analysis response models."""

from datetime import datetime
from enum import StrEnum

from pydantic import AnyUrl, BaseModel, ConfigDict, Field


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

    K1: int = Field(ge=0, le=3)
    K2: int = Field(ge=0, le=3)
    K3: int = Field(ge=0, le=3)
    K4: int = Field(ge=0, le=3)
    K5: int = Field(ge=0, le=3)
    K6: int = Field(ge=0, le=3)
    H1: bool
    H2: bool
    H3: bool
    H4: bool


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
    score: int = Field(ge=0, le=18)
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
    analyses: list[AnalysisVersionResponse]
    decisions: list[SpecialistDecision]

"""Contract-shaped semantic duplicate review models."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from backend.app.modules.publications.schemas import PublicationDetail


class DuplicateStatus(StrEnum):
    UNREVIEWED = "unreviewed"
    DUPLICATE = "duplicate"
    RELATED = "related"
    DIFFERENT = "different"


class DuplicateFilterStatus(StrEnum):
    ALL = "all"
    UNREVIEWED = "unreviewed"
    DUPLICATE = "duplicate"
    RELATED = "related"
    DIFFERENT = "different"


class DuplicateVerdict(StrEnum):
    DUPLICATE = "duplicate"
    RELATED = "related"
    DIFFERENT = "different"


class DuplicateReviewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict: DuplicateVerdict
    reviewer_id: str = Field(min_length=1)
    comment: str | None = Field(default=None, max_length=2000)


class DuplicateReviewResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    candidate_id: str
    version: int = Field(ge=1)
    verdict: DuplicateVerdict
    reviewer_id: str
    comment: str | None
    created_at: datetime


class DuplicateCandidateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    publication: PublicationDetail
    candidate_publication: PublicationDetail
    model: str
    similarity: float = Field(ge=-1, le=1)
    status: DuplicateStatus
    reviews: list[DuplicateReviewResponse]
    created_at: datetime


class DuplicateCandidateList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[DuplicateCandidateResponse]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)


class DuplicateBackfillReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    publications: int = Field(ge=0)
    candidates_created: int = Field(ge=0)
    candidates_already_present: int = Field(ge=0)
    duration_seconds: float = Field(ge=0)

"""Contract-shaped regulatory case response models."""

from datetime import datetime
from enum import StrEnum

from pydantic import AnyUrl, BaseModel, ConfigDict


class LifecycleStage(StrEnum):
    DRAFT = "draft"
    INTRODUCED = "introduced"
    ADOPTED = "adopted"
    PUBLISHED = "published"
    EFFECTIVE = "effective"
    AMENDED = "amended"
    REPEALED = "repealed"


class ConfirmationSourceType(StrEnum):
    REGULATOR = "regulator"
    OFFICIAL_PUBLICATION = "official_publication"


class RegulatoryCaseResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    registration_number: str
    current_stage: LifecycleStage
    responsible_user_id: str
    related_publication_ids: list[str]
    created_at: datetime
    updated_at: datetime


class LifecycleEventResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    regulatory_case_id: str
    stage: LifecycleStage
    occurred_at: datetime
    confirmation_url: AnyUrl
    confirmation_source_type: ConfirmationSourceType
    comment: str | None
    author_id: str
    created_at: datetime


class RegulatoryCaseDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regulatory_case: RegulatoryCaseResponse
    timeline: list[LifecycleEventResponse]

"""Contract-shaped regulatory case response models."""

from datetime import datetime
from enum import StrEnum

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, field_validator, model_validator


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


class RegulatoryCaseOrigin(StrEnum):
    MANUAL = "manual"
    AUTOMATIC = "automatic"


class RegulatoryCaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    registration_number: str
    current_stage: LifecycleStage
    responsible_user_id: str
    related_publication_ids: list[str] = Field(default_factory=list)


class RegulatoryCasePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    registration_number: str | None = None
    responsible_user_id: str | None = None

    @field_validator("title", "registration_number", "responsible_user_id")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized

    @model_validator(mode="after")
    def require_non_null_field(self):
        submitted = self.model_fields_set
        if not submitted:
            raise ValueError("at least one editable field is required")
        if any(getattr(self, field) is None for field in submitted):
            raise ValueError("patch fields cannot be null")
        return self


class LifecycleEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: LifecycleStage
    occurred_at: datetime
    confirmation_url: AnyUrl
    confirmation_source_type: ConfirmationSourceType
    comment: str | None = None
    author_id: str


class RegulatoryCaseResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    registration_number: str
    current_stage: LifecycleStage
    responsible_user_id: str
    origin: RegulatoryCaseOrigin
    needs_review: bool
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

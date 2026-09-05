"""Contract-shaped source response models."""

from datetime import datetime
from enum import StrEnum
from typing import Literal, Self

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, model_validator


class SourceType(StrEnum):
    RSS = "rss"
    REGULATOR = "regulator"
    TELEGRAM = "telegram"
    TELEGRAM_ARCHIVE = "telegram_archive"
    FILE = "file"
    SEED = "seed"


class SourceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    type: SourceType
    url: AnyUrl
    enabled: bool
    last_checked_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    is_demo: bool


class SourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    type: SourceType
    url: AnyUrl
    enabled: bool = True

    @model_validator(mode="after")
    def require_compatible_url(self) -> Self:
        validate_source_url(self.type, str(self.url))
        return self


class SourcePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    url: AnyUrl | None = None
    enabled: bool | None = None

    @model_validator(mode="after")
    def require_non_null_field(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("patch fields cannot be null")
        return self


def validate_source_url(source_type: SourceType, value: str) -> None:
    scheme = value.split(":", 1)[0].casefold()
    file_types = {SourceType.FILE, SourceType.SEED, SourceType.TELEGRAM_ARCHIVE}
    if source_type in file_types and scheme != "file":
        raise ValueError(f"{source_type.value} source must use a file URL")
    if source_type not in file_types and scheme not in {"http", "https"}:
        raise ValueError(f"{source_type.value} source must use an http(s) URL")


class SourceCollectionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    status: Literal["success", "partial", "failed"]
    collected: int = Field(ge=0)
    created: int = Field(ge=0)
    already_seen: int = Field(ge=0)
    content_duplicates: int = Field(ge=0)
    exact_duplicates: int = Field(ge=0)
    semantic_candidates: int = Field(ge=0)
    error: str | None


class CollectionReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["completed", "partial_failure", "failed"]
    started_at: datetime
    finished_at: datetime
    sources: list[SourceCollectionResult]
    collected: int = Field(ge=0)
    created: int = Field(ge=0)
    already_seen: int = Field(ge=0)
    content_duplicates: int = Field(ge=0)
    exact_duplicates: int = Field(ge=0)
    semantic_candidates: int = Field(ge=0)


class DemoSeedImportReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: int = Field(ge=0)
    publications: int = Field(ge=0)
    analyses: int = Field(ge=0)
    duplicates: int = Field(ge=0)

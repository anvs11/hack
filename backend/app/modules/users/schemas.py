"""Contract models for the current user's profile."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

UserRole = Literal["gr", "pr", "manager"]
ViewMode = Literal["compact", "expert"]
DigestMinimumPriority = Literal["critical", "high", "medium", "low"]


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    telegram_id: int | None
    name: str
    username: str | None
    role: UserRole
    view_mode: ViewMode
    start_filters: dict[str, Any]
    can_assign_tasks: bool
    can_confirm_analysis: bool
    updated_at: datetime


class UserPreferencesPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    view_mode: ViewMode | None = None
    start_filters: dict[str, Any] | None = Field(default=None)


class TelegramDigestSettingsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available: bool
    enabled: bool
    minimum_priority: DigestMinimumPriority
    delivery_interval_minutes: Literal[15] = 15
    updated_at: datetime


class TelegramDigestSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    minimum_priority: DigestMinimumPriority | None = None

    @model_validator(mode="after")
    def require_change(self):
        if not self.model_fields_set:
            raise ValueError("at least one setting is required")
        return self

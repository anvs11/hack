"""Contract-shaped Telegram Mini App authentication models."""

from datetime import datetime
from typing import Literal

from pydantic import AnyUrl, BaseModel, ConfigDict, Field


class TelegramAuthRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    init_data: str = Field(min_length=1, max_length=8192)


class TelegramUser(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
    language_code: str | None = None
    photo_url: AnyUrl | None = None


class TelegramAuthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    authenticated: Literal[True] = True
    user: TelegramUser
    auth_date: datetime
    query_id: str | None = None

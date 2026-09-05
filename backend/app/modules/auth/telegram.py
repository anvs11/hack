"""Validation of Telegram Mini App launch data."""

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl

from pydantic import ValidationError

from backend.app.errors import ApiError
from backend.app.modules.auth.schemas import TelegramAuthResponse, TelegramUser


def validate_telegram_init_data(
    init_data: str,
    *,
    bot_token: str,
    max_age_seconds: int,
    now: datetime | None = None,
) -> TelegramAuthResponse:
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        raise _unauthorized("Telegram launch data payload is invalid") from None
    values = dict(pairs)
    if len(values) != len(pairs):
        raise _unauthorized("Telegram launch data contains duplicate fields")
    received_hash = values.pop("hash", "")
    if len(received_hash) != 64:
        raise _unauthorized("Telegram launch data signature is missing")

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(values.items())
    )
    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(received_hash.casefold(), expected_hash):
        raise _unauthorized("Telegram launch data signature is invalid")

    checked_at = (now or datetime.now(UTC)).astimezone(UTC)
    try:
        auth_date = datetime.fromtimestamp(int(values["auth_date"]), tz=UTC)
        raw_user = json.loads(values["user"])
        user = TelegramUser.model_validate(
            {
                key: raw_user.get(key)
                for key in (
                    "id",
                    "first_name",
                    "last_name",
                    "username",
                    "language_code",
                    "photo_url",
                )
                if key in raw_user
            }
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, ValidationError):
        raise _unauthorized("Telegram launch data payload is invalid") from None

    if auth_date > checked_at + timedelta(seconds=30):
        raise _unauthorized("Telegram launch data is dated in the future")
    if checked_at - auth_date > timedelta(seconds=max_age_seconds):
        raise _unauthorized("Telegram launch data has expired")

    return TelegramAuthResponse(
        user=user,
        auth_date=auth_date,
        query_id=values.get("query_id"),
    )


def _unauthorized(message: str) -> ApiError:
    return ApiError(status_code=401, code="telegram_auth_invalid", message=message)

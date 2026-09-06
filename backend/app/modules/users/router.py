"""Current-user profile routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from backend.app.config import (
    get_telegram_auth_max_age,
    get_telegram_bot_token,
    local_identity_enabled,
)
from backend.app.db import get_session
from backend.app.errors import ApiError
from backend.app.modules.auth.telegram import validate_telegram_init_data
from backend.app.modules.users.schemas import (
    TelegramDigestSettingsPatch,
    TelegramDigestSettingsResponse,
    UserPreferencesPatch,
    UserProfileResponse,
)
from backend.app.modules.users.service import (
    LOCAL_IDENTITY,
    UserIdentity,
    get_digest_settings,
    get_or_create_profile,
    telegram_identity,
    update_digest_settings,
    update_preferences,
)


router = APIRouter()


def current_identity(
    init_data: Annotated[
        str | None,
        Header(alias="X-Telegram-Init-Data", max_length=8192),
    ] = None,
) -> UserIdentity:
    if not init_data:
        if local_identity_enabled():
            return LOCAL_IDENTITY
        raise ApiError(
            status_code=401,
            code="telegram_launch_required",
            message="Open the application inside Telegram",
        )
    bot_token = get_telegram_bot_token()
    if bot_token is None:
        raise ApiError(
            status_code=503,
            code="telegram_auth_unavailable",
            message="Telegram authentication is not configured",
        )
    auth = validate_telegram_init_data(
        init_data,
        bot_token=bot_token,
        max_age_seconds=get_telegram_auth_max_age(),
    )
    return telegram_identity(auth.user)


@router.get("/api/me", operation_id="getMyProfile", response_model=UserProfileResponse)
def get_my_profile(
    session: Annotated[Session, Depends(get_session)],
    identity: Annotated[UserIdentity, Depends(current_identity)],
) -> UserProfileResponse:
    return get_or_create_profile(session, identity)


@router.patch("/api/me", operation_id="updateMyPreferences", response_model=UserProfileResponse)
def update_my_preferences(
    request: UserPreferencesPatch,
    session: Annotated[Session, Depends(get_session)],
    identity: Annotated[UserIdentity, Depends(current_identity)],
) -> UserProfileResponse:
    return update_preferences(session, identity, request)


@router.get(
    "/api/me/telegram-digest-settings",
    operation_id="getMyTelegramDigestSettings",
    response_model=TelegramDigestSettingsResponse,
)
def get_my_telegram_digest_settings(
    session: Annotated[Session, Depends(get_session)],
    identity: Annotated[UserIdentity, Depends(current_identity)],
) -> TelegramDigestSettingsResponse:
    return get_digest_settings(session, identity)


@router.patch(
    "/api/me/telegram-digest-settings",
    operation_id="updateMyTelegramDigestSettings",
    response_model=TelegramDigestSettingsResponse,
)
def update_my_telegram_digest_settings(
    request: TelegramDigestSettingsPatch,
    session: Annotated[Session, Depends(get_session)],
    identity: Annotated[UserIdentity, Depends(current_identity)],
) -> TelegramDigestSettingsResponse:
    return update_digest_settings(session, identity, request)

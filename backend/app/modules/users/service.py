"""Resolve identities and persist user-owned preferences."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.modules.auth.schemas import TelegramUser
from backend.app.errors import ApiError
from backend.app.modules.users.models import TelegramDigestPreference, UserProfile
from backend.app.modules.users.schemas import (
    TelegramDigestSettingsPatch,
    TelegramDigestSettingsResponse,
    UserPreferencesPatch,
    UserProfileResponse,
)


@dataclass(frozen=True)
class UserIdentity:
    id: str
    telegram_id: int | None
    name: str
    username: str | None


LOCAL_IDENTITY = UserIdentity(
    id="local:gr",
    telegram_id=None,
    name="GR-специалист",
    username=None,
)


def telegram_identity(user: TelegramUser) -> UserIdentity:
    name = " ".join(part for part in (user.first_name, user.last_name) if part)
    return UserIdentity(
        id=f"telegram:{user.id}",
        telegram_id=user.id,
        name=name,
        username=user.username,
    )


def get_or_create_profile(
    session: Session,
    identity: UserIdentity,
) -> UserProfileResponse:
    row = session.get(UserProfile, identity.id)
    if row is None:
        row = UserProfile(
            id=identity.id,
            telegram_id=str(identity.telegram_id) if identity.telegram_id else None,
            name=identity.name,
            username=identity.username,
            role="gr",
            view_mode="expert",
            start_filters_json="{}",
            can_assign_tasks=1,
            can_confirm_analysis=1,
            updated_at=_now(),
        )
        session.add(row)
        try:
            session.commit()
        except IntegrityError:
            # Two initial page requests may create the same Telegram profile.
            # Keep the winner and return the already committed row.
            session.rollback()
            row = session.get(UserProfile, identity.id)
            if row is None:
                raise
    elif row.name != identity.name or row.username != identity.username:
        row.name = identity.name
        row.username = identity.username
        row.updated_at = _now()
        session.commit()
    _ensure_digest_preference(session, identity)
    response = _response(row)
    session.rollback()
    return response


def update_preferences(
    session: Session,
    identity: UserIdentity,
    patch: UserPreferencesPatch,
) -> UserProfileResponse:
    get_or_create_profile(session, identity)
    # Serializing the committed row may start a read transaction; close it before
    # opening the preference update in the same request-scoped session.
    session.rollback()
    row = session.get(UserProfile, identity.id)
    if row is None:
        raise RuntimeError("User profile disappeared during update")
    if patch.view_mode is not None:
        row.view_mode = patch.view_mode
    if patch.start_filters is not None:
        row.start_filters_json = json.dumps(
            patch.start_filters,
            ensure_ascii=False,
            sort_keys=True,
        )
    row.updated_at = _now()
    session.commit()
    return _response(row)


def get_digest_settings(
    session: Session,
    identity: UserIdentity,
) -> TelegramDigestSettingsResponse:
    get_or_create_profile(session, identity)
    session.rollback()
    row = _get_or_create_digest_preference(session, identity)
    return _digest_settings_response(row, identity.telegram_id is not None)


def update_digest_settings(
    session: Session,
    identity: UserIdentity,
    patch: TelegramDigestSettingsPatch,
) -> TelegramDigestSettingsResponse:
    get_or_create_profile(session, identity)
    session.rollback()
    row = _get_or_create_digest_preference(session, identity)
    if patch.enabled is True and identity.telegram_id is None:
        raise ApiError(
            status_code=422,
            code="telegram_launch_required",
            message="Open the application inside Telegram to enable automatic reports",
        )
    if patch.enabled is not None:
        if patch.enabled and not row.enabled:
            row.deliver_after = _now()
        row.enabled = int(patch.enabled)
    if patch.minimum_priority is not None:
        row.minimum_priority = patch.minimum_priority
    row.updated_at = _now()
    session.commit()
    return _digest_settings_response(row, identity.telegram_id is not None)


def _get_or_create_digest_preference(
    session: Session,
    identity: UserIdentity,
) -> TelegramDigestPreference:
    return _ensure_digest_preference(session, identity)


def _ensure_digest_preference(
    session: Session,
    identity: UserIdentity,
) -> TelegramDigestPreference:
    row = session.get(TelegramDigestPreference, identity.id)
    if row is not None:
        return row
    row = TelegramDigestPreference(
        user_id=identity.id,
        enabled=int(identity.telegram_id is not None),
        minimum_priority="high",
        deliver_after=_now(),
        updated_at=_now(),
    )
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        row = session.get(TelegramDigestPreference, identity.id)
        if row is None:
            raise
    return row


def _digest_settings_response(
    row: TelegramDigestPreference,
    available: bool,
) -> TelegramDigestSettingsResponse:
    return TelegramDigestSettingsResponse(
        available=available,
        enabled=bool(row.enabled) and available,
        minimum_priority=row.minimum_priority,
        updated_at=row.updated_at,
    )


def _response(row: UserProfile) -> UserProfileResponse:
    return UserProfileResponse(
        id=row.id,
        telegram_id=int(row.telegram_id) if row.telegram_id else None,
        name=row.name,
        username=row.username,
        role=row.role,
        view_mode=row.view_mode,
        start_filters=json.loads(row.start_filters_json),
        can_assign_tasks=bool(row.can_assign_tasks),
        can_confirm_analysis=bool(row.can_confirm_analysis),
        updated_at=row.updated_at,
    )


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")

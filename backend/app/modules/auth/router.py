"""Authentication HTTP routes."""

from fastapi import APIRouter

from backend.app.config import get_telegram_auth_max_age, get_telegram_bot_token
from backend.app.errors import ApiError
from backend.app.modules.auth.schemas import TelegramAuthRequest, TelegramAuthResponse
from backend.app.modules.auth.telegram import validate_telegram_init_data


router = APIRouter()


@router.post(
    "/api/auth/telegram",
    operation_id="authenticateTelegram",
    response_model=TelegramAuthResponse,
)
def authenticate_telegram(request: TelegramAuthRequest) -> TelegramAuthResponse:
    bot_token = get_telegram_bot_token()
    if bot_token is None:
        raise ApiError(
            status_code=503,
            code="telegram_auth_unavailable",
            message="Telegram authentication is not configured",
        )
    return validate_telegram_init_data(
        request.init_data,
        bot_token=bot_token,
        max_age_seconds=get_telegram_auth_max_age(),
    )

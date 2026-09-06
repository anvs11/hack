"""Authentication HTTP routes."""

from typing import Annotated

from fastapi import APIRouter, Depends

from backend.app.config import get_telegram_auth_max_age, get_telegram_bot_token
from backend.app.errors import ApiError
from backend.app.modules.auth.schemas import (
    TelegramAuthRequest,
    TelegramAuthResponse,
    TelegramReportDeliveryRequest,
    TelegramReportDeliveryResponse,
)
from backend.app.modules.auth.telegram_delivery import send_report_messages
from backend.app.modules.auth.telegram import validate_telegram_init_data
from backend.app.modules.users.router import current_identity
from backend.app.modules.users.service import UserIdentity


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


@router.post(
    "/api/telegram/report-deliveries",
    operation_id="createTelegramReportDelivery",
    response_model=TelegramReportDeliveryResponse,
)
def create_telegram_report_delivery(
    request: TelegramReportDeliveryRequest,
    identity: Annotated[UserIdentity, Depends(current_identity)],
) -> TelegramReportDeliveryResponse:
    if identity.telegram_id is None:
        raise ApiError(
            status_code=401,
            code="telegram_launch_required",
            message="Open the report inside the Telegram Mini App",
        )
    bot_token = get_telegram_bot_token()
    if bot_token is None:
        raise ApiError(
            status_code=503,
            code="telegram_auth_unavailable",
            message="Telegram authentication is not configured",
        )
    message_count = send_report_messages(
        bot_token=bot_token,
        chat_id=identity.telegram_id,
        content=request.content,
    )
    return TelegramReportDeliveryResponse(message_count=message_count)

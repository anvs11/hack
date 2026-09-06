"""Deliver plain-text reports through the configured Telegram bot."""

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from backend.app.errors import ApiError


TELEGRAM_MESSAGE_LIMIT = 4096
SAFE_CHUNK_SIZE = 3900


def send_report_messages(*, bot_token: str, chat_id: int, content: str) -> int:
    chunks = _message_chunks(content)
    endpoint = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    for chunk in chunks:
        request = Request(
            endpoint,
            data=json.dumps(
                {
                    "chat_id": chat_id,
                    "text": chunk,
                    "link_preview_options": {"is_disabled": True},
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=20) as response:  # noqa: S310
                payload = json.loads(response.read())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise _delivery_error() from error
        if not payload.get("ok"):
            raise _delivery_error()
    return len(chunks)


def _message_chunks(content: str) -> list[str]:
    remaining = content.strip()
    if not remaining:
        raise ApiError(
            status_code=422,
            code="empty_report",
            message="Report content is empty",
        )
    chunks: list[str] = []
    while remaining:
        if len(remaining) <= SAFE_CHUNK_SIZE:
            chunks.append(remaining)
            break
        split_at = remaining.rfind("\n", 0, SAFE_CHUNK_SIZE)
        if split_at < SAFE_CHUNK_SIZE // 2:
            split_at = SAFE_CHUNK_SIZE
        chunks.append(remaining[:split_at].rstrip())
        remaining = remaining[split_at:].lstrip()
    return chunks


def _delivery_error() -> ApiError:
    return ApiError(
        status_code=502,
        code="telegram_delivery_failed",
        message="Telegram did not accept the report message",
    )

import hashlib
import hmac
import json
from datetime import UTC, datetime
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from backend.app.main import create_app


BOT_TOKEN = "123456:test-token"


def _signed_init_data(*, auth_date: int, user: dict[str, object] | None = None) -> str:
    values = {
        "auth_date": str(auth_date),
        "query_id": "AAExampleQuery",
        "user": json.dumps(
            user or {"id": 42, "first_name": "Егор", "username": "egor"},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
    }
    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(values.items())
    )
    secret_key = hmac.new(
        b"WebAppData",
        BOT_TOKEN.encode(),
        hashlib.sha256,
    ).digest()
    values["hash"] = hmac.new(
        secret_key,
        data_check_string.encode(),
        hashlib.sha256,
    ).hexdigest()
    return urlencode(values)


def test_telegram_auth_requires_server_configuration(monkeypatch) -> None:
    monkeypatch.delenv("HACK_TELEGRAM_BOT_TOKEN", raising=False)

    with TestClient(create_app()) as client:
        response = client.post("/api/auth/telegram", json={"init_data": "x=1"})

    assert response.status_code == 503
    assert response.json()["code"] == "telegram_auth_unavailable"


def test_telegram_auth_validates_signature_and_returns_user(monkeypatch) -> None:
    monkeypatch.setenv("HACK_TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    auth_date = int(datetime.now(UTC).timestamp())

    with TestClient(create_app()) as client:
        response = client.post(
            "/api/auth/telegram",
            json={"init_data": _signed_init_data(auth_date=auth_date)},
        )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert response.json()["user"] == {
        "id": 42,
        "first_name": "Егор",
        "last_name": None,
        "username": "egor",
        "language_code": None,
        "photo_url": None,
    }
    assert response.json()["query_id"] == "AAExampleQuery"


def test_telegram_auth_rejects_tampering(monkeypatch) -> None:
    monkeypatch.setenv("HACK_TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    init_data = _signed_init_data(auth_date=int(datetime.now(UTC).timestamp()))
    init_data = f"{init_data[:-1]}{'0' if init_data[-1] != '0' else '1'}"

    with TestClient(create_app()) as client:
        response = client.post(
            "/api/auth/telegram",
            json={"init_data": init_data},
        )

    assert response.status_code == 401
    assert response.json()["code"] == "telegram_auth_invalid"


def test_telegram_auth_rejects_malformed_payload(monkeypatch) -> None:
    monkeypatch.setenv("HACK_TELEGRAM_BOT_TOKEN", BOT_TOKEN)

    with TestClient(create_app()) as client:
        response = client.post(
            "/api/auth/telegram",
            json={"init_data": "broken"},
        )

    assert response.status_code == 401
    assert response.json()["code"] == "telegram_auth_invalid"

import hashlib
import hmac
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.main import create_app
from backend.app.modules.users.models import UserProfile
from backend.tests.seed import seed_test_database


BOT_TOKEN = "123456:test-token"


def _signed_init_data() -> str:
    values = {
        "auth_date": str(int(datetime.now(UTC).timestamp())),
        "user": json.dumps(
            {"id": 42, "first_name": "Егор", "username": "egor"},
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


def test_local_user_selects_and_persists_own_view_mode(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'profiles.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        original = client.get("/api/me")
        updated = client.patch("/api/me", json={"view_mode": "compact"})
        loaded = client.get("/api/me")

    assert original.status_code == 200
    assert original.json()["role"] == "gr"
    assert updated.status_code == 200
    assert updated.json()["view_mode"] == "compact"
    assert loaded.json()["view_mode"] == "compact"
    engine.dispose()


def test_local_user_can_configure_threshold_but_not_enable_telegram_delivery(
    tmp_path: Path,
) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'local-digest-settings.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as client:
        loaded = client.get("/api/me/telegram-digest-settings")
        changed = client.patch(
            "/api/me/telegram-digest-settings",
            json={"minimum_priority": "medium"},
        )
        rejected = client.patch(
            "/api/me/telegram-digest-settings",
            json={"enabled": True},
        )

    assert loaded.status_code == 200
    assert loaded.json() | {"updated_at": "ignored"} == {
        "available": False,
        "enabled": False,
        "minimum_priority": "high",
        "delivery_interval_minutes": 15,
        "updated_at": "ignored",
    }
    assert changed.status_code == 200
    assert changed.json()["minimum_priority"] == "medium"
    assert rejected.status_code == 422
    assert rejected.json()["code"] == "telegram_launch_required"
    engine.dispose()


def test_parallel_initial_requests_create_one_profile(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'parallel-profile.sqlite3'}")

    with TestClient(create_app(database_engine=engine)) as client:
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: client.get("/api/me"), range(8)))

    assert {response.status_code for response in responses} == {200}
    assert {response.json()["id"] for response in responses} == {"local:gr"}
    with Session(engine) as session:
        assert session.query(UserProfile).count() == 1
    engine.dispose()


def test_public_mode_requires_signed_telegram_identity(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HACK_ALLOW_LOCAL_IDENTITY", "0")
    engine = build_engine(f"sqlite:///{tmp_path / 'public-profile.sqlite3'}")

    with TestClient(create_app(database_engine=engine)) as client:
        response = client.get("/api/me")

    assert response.status_code == 401
    assert response.json()["code"] == "telegram_launch_required"
    engine.dispose()


def test_telegram_profile_comes_from_signed_launch_data(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HACK_TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    engine = build_engine(f"sqlite:///{tmp_path / 'telegram-profile.sqlite3'}")
    headers = {"X-Telegram-Init-Data": _signed_init_data()}

    with TestClient(create_app(database_engine=engine)) as client:
        response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    assert response.json() | {"updated_at": "ignored"} == {
        "id": "telegram:42",
        "telegram_id": 42,
        "name": "Егор",
        "username": "egor",
        "role": "gr",
        "view_mode": "expert",
        "start_filters": {},
        "can_assign_tasks": True,
        "can_confirm_analysis": True,
        "updated_at": "ignored",
    }
    engine.dispose()


def test_telegram_user_gets_automatic_reports_enabled_by_default(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HACK_TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    engine = build_engine(f"sqlite:///{tmp_path / 'telegram-digest-settings.sqlite3'}")
    headers = {"X-Telegram-Init-Data": _signed_init_data()}

    with TestClient(create_app(database_engine=engine)) as client:
        response = client.get("/api/me/telegram-digest-settings", headers=headers)

    assert response.status_code == 200
    assert response.json()["available"] is True
    assert response.json()["enabled"] is True
    assert response.json()["minimum_priority"] == "high"
    engine.dispose()


def test_report_delivery_uses_authenticated_telegram_user(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HACK_TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    delivered: list[tuple[str, int, str]] = []

    def fake_send(*, bot_token: str, chat_id: int, content: str) -> int:
        delivered.append((bot_token, chat_id, content))
        return 2

    monkeypatch.setattr(
        "backend.app.modules.auth.router.send_report_messages",
        fake_send,
    )
    engine = build_engine(f"sqlite:///{tmp_path / 'telegram-report.sqlite3'}")
    headers = {"X-Telegram-Init-Data": _signed_init_data()}
    with TestClient(create_app(database_engine=engine)) as client:
        response = client.post(
            "/api/telegram/report-deliveries",
            headers=headers,
            json={"content": "Отчёт"},
        )

    assert response.status_code == 200
    assert response.json() == {"delivered": True, "message_count": 2}
    assert delivered == [(BOT_TOKEN, 42, "Отчёт")]
    engine.dispose()


def test_manager_permission_is_enforced_by_backend(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'manager.sqlite3'}")
    seed_test_database(engine)
    with TestClient(create_app(database_engine=engine)) as client:
        assert client.get("/api/me").status_code == 200
        with Session(engine) as session, session.begin():
            profile = session.get(UserProfile, "local:gr")
            assert profile is not None
            profile.role = "manager"
            profile.can_confirm_analysis = 0
        response = client.post(
            "/api/publications/pub-001/decisions",
            json={
                "analysis_id": "analysis-001",
                "status": "confirmed",
                "final_summary": None,
                "final_category": "regulation",
                "final_priority": "high",
                "comment": None,
                "author_id": "someone-else",
            },
        )

    assert response.status_code == 403
    assert response.json()["code"] == "analysis_confirmation_forbidden"
    engine.dispose()

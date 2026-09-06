from pathlib import Path

from sqlalchemy.orm import Session

from backend.app.db import build_engine, create_schema
from backend.app.modules.users.models import TelegramDigestDelivery, TelegramDigestPreference, UserProfile
from backend.app.modules.users.telegram_digest import deliver_pending_telegram_digests
from backend.tests.seed import seed_test_database


def test_automatic_digest_delivers_each_relevant_analysis_once(
    tmp_path: Path,
    monkeypatch,
) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'telegram-digest.sqlite3'}")
    create_schema(engine)
    seed_test_database(engine)
    now = "2026-09-06T10:00:00Z"
    with Session(engine) as session, session.begin():
        session.add(
            UserProfile(
                id="telegram:42",
                telegram_id="42",
                name="Егор",
                username="egor",
                role="gr",
                view_mode="expert",
                start_filters_json="{}",
                can_assign_tasks=1,
                can_confirm_analysis=1,
                updated_at=now,
            )
        )
        session.flush()
        session.add(
            TelegramDigestPreference(
                user_id="telegram:42",
                enabled=1,
                minimum_priority="high",
                deliver_after="2026-08-31T00:00:00Z",
                updated_at=now,
            )
        )

    messages: list[tuple[str, int, str]] = []

    def fake_send(*, bot_token: str, chat_id: int, content: str) -> int:
        messages.append((bot_token, chat_id, content))
        return 1

    monkeypatch.setattr(
        "backend.app.modules.users.telegram_digest.send_report_messages",
        fake_send,
    )
    with Session(engine, expire_on_commit=False) as session:
        first = deliver_pending_telegram_digests(session, bot_token="secret")
        second = deliver_pending_telegram_digests(session, bot_token="secret")

    assert first.configured is True
    assert first.users_delivered == 1
    assert first.analyses_delivered == 3
    assert second.users_delivered == 0
    assert len(messages) == 1
    assert messages[0][0:2] == ("secret", 42)
    assert "Новых релевантных событий: 3" in messages[0][2]
    assert "Источники:" in messages[0][2]
    with Session(engine) as session:
        assert session.query(TelegramDigestDelivery).count() == 3
    engine.dispose()


def test_automatic_digest_does_not_send_backlog_created_before_subscription(
    tmp_path: Path,
    monkeypatch,
) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'telegram-backlog.sqlite3'}")
    create_schema(engine)
    seed_test_database(engine)
    with Session(engine) as session, session.begin():
        session.add(
            UserProfile(
                id="telegram:43",
                telegram_id="43",
                name="Анна",
                username="anna",
                role="gr",
                view_mode="expert",
                start_filters_json="{}",
                can_assign_tasks=1,
                can_confirm_analysis=1,
                updated_at="2026-09-06T10:00:00Z",
            )
        )
        session.flush()
        session.add(
            TelegramDigestPreference(
                user_id="telegram:43",
                enabled=1,
                minimum_priority="high",
                deliver_after="2026-09-06T10:00:00Z",
                updated_at="2026-09-06T10:00:00Z",
            )
        )

    messages: list[str] = []
    monkeypatch.setattr(
        "backend.app.modules.users.telegram_digest.send_report_messages",
        lambda **kwargs: messages.append(kwargs["content"]) or 1,
    )
    with Session(engine) as session:
        report = deliver_pending_telegram_digests(session, bot_token="secret")

    assert report.users_delivered == 0
    assert messages == []
    engine.dispose()


def test_automatic_digest_is_disabled_without_bot_token(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'no-token.sqlite3'}")
    create_schema(engine)
    with Session(engine) as session:
        report = deliver_pending_telegram_digests(session, bot_token=None)

    assert report.configured is False
    assert report.users_checked == 0
    engine.dispose()

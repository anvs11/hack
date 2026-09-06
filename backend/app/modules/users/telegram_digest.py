"""Build and deliver incremental role-aware Telegram digests."""

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.auth.telegram_delivery import send_report_messages
from backend.app.modules.publications.models import Publication, PublicationSourceReference
from backend.app.modules.publications.schemas import AnalysisVersionResponse
from backend.app.modules.users.models import (
    TelegramDigestDelivery,
    TelegramDigestPreference,
    UserProfile,
)


PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4}
PRIORITY_LABELS = {
    "critical": "Критический",
    "high": "Высокий",
    "medium": "Средний",
    "low": "Низкий",
    "unknown": "Не определён",
}
CATEGORY_LABELS = {
    "regulation": "Регуляторика",
    "reputation": "Репутация",
    "competitor": "Конкуренты",
    "trend": "Тренды",
    "unknown": "Не определена",
}
ROLE_LABELS = {"gr": "GR", "pr": "PR", "manager": "Руководитель"}


@dataclass(frozen=True)
class TelegramDigestRunReport:
    configured: bool
    users_checked: int
    users_delivered: int
    analyses_delivered: int
    failures: tuple[str, ...]

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class _DigestItem:
    analysis_id: str
    created_at: str
    title: str
    summary: str
    category: str
    priority: str
    urls: tuple[str, ...]


def deliver_pending_telegram_digests(
    session: Session,
    *,
    bot_token: str | None,
) -> TelegramDigestRunReport:
    """Send each enabled user only analyses not delivered to that user before."""

    if not bot_token:
        return TelegramDigestRunReport(False, 0, 0, 0, ())

    with session.begin():
        profiles = list(
            session.scalars(
                select(UserProfile)
                .join(
                    TelegramDigestPreference,
                    TelegramDigestPreference.user_id == UserProfile.id,
                )
                .where(
                    UserProfile.telegram_id.is_not(None),
                    TelegramDigestPreference.enabled == 1,
                )
                .order_by(UserProfile.id)
            )
        )

    delivered_users = 0
    delivered_analyses = 0
    failures: list[str] = []
    for profile in profiles:
        profile_id = profile.id
        profile_name = profile.name
        profile_role = profile.role
        telegram_id = int(profile.telegram_id or 0)
        try:
            items = _pending_items(session, profile)
            if not items:
                session.rollback()
                continue
            session.rollback()
            content = _render_digest(profile_name, profile_role, items)
            send_report_messages(
                bot_token=bot_token,
                chat_id=telegram_id,
                content=content,
            )
            delivered_at = _now()
            with session.begin():
                session.add_all(
                    TelegramDigestDelivery(
                        id=f"telegram-digest-delivery-{uuid4().hex}",
                        user_id=profile_id,
                        analysis_id=item.analysis_id,
                        delivered_at=delivered_at,
                    )
                    for item in items
                )
            delivered_users += 1
            delivered_analyses += len(items)
        except Exception as error:  # one chat must not stop collection for everyone
            session.rollback()
            failures.append(f"{profile_id}:{type(error).__name__}")

    return TelegramDigestRunReport(
        configured=True,
        users_checked=len(profiles),
        users_delivered=delivered_users,
        analyses_delivered=delivered_analyses,
        failures=tuple(failures),
    )


def _pending_items(session: Session, profile: UserProfile) -> list[_DigestItem]:
    preference = session.get(TelegramDigestPreference, profile.id)
    if preference is None:
        return []
    delivered_ids = set(
        session.scalars(
            select(TelegramDigestDelivery.analysis_id).where(
                TelegramDigestDelivery.user_id == profile.id
            )
        )
    )
    analyses = list(
        session.scalars(
            select(AnalysisVersion).order_by(
                AnalysisVersion.publication_id,
                AnalysisVersion.version.desc(),
            )
        )
    )
    latest: dict[str, AnalysisVersion] = {}
    for row in analyses:
        latest.setdefault(row.publication_id, row)

    start_filters = json.loads(profile.start_filters_json)
    items: list[_DigestItem] = []
    for row in latest.values():
        if row.id in delivered_ids:
            continue
        analysis = AnalysisVersionResponse.model_validate_json(row.payload_json)
        if analysis.created_at <= _parse_datetime(preference.deliver_after):
            continue
        if not _is_relevant(
            role=profile.role,
            start_filters=start_filters,
            category=analysis.category.value,
            priority=analysis.proposed_priority.value,
            minimum_priority=preference.minimum_priority,
        ):
            continue
        publication = session.get(Publication, row.publication_id)
        if publication is None:
            continue
        payload = json.loads(publication.payload_json)
        references = list(
            session.scalars(
                select(PublicationSourceReference)
                .where(PublicationSourceReference.publication_id == publication.id)
                .order_by(PublicationSourceReference.published_at.desc())
            )
        )
        urls = tuple(
            dict.fromkeys(
                [str(payload["original_url"])]
                + [reference.original_url for reference in references]
            )
        )
        items.append(
            _DigestItem(
                analysis_id=row.id,
                created_at=analysis.created_at.isoformat(),
                title=str(payload["title"]),
                summary=analysis.summary,
                category=analysis.category.value,
                priority=analysis.proposed_priority.value,
                urls=urls,
            )
        )
    return sorted(items, key=lambda item: (item.created_at, item.analysis_id), reverse=True)


def _is_relevant(
    *,
    role: str,
    start_filters: dict,
    category: str,
    priority: str,
    minimum_priority: str,
) -> bool:
    if PRIORITY_ORDER.get(priority, 4) > PRIORITY_ORDER[minimum_priority]:
        return False
    selected_category = start_filters.get("category")
    if isinstance(selected_category, str) and selected_category:
        return category == selected_category
    selected_priority = start_filters.get("proposed_priority")
    if isinstance(selected_priority, str) and selected_priority:
        return priority == selected_priority
    if role == "manager":
        return priority in {"critical", "high"}
    if role == "gr":
        return category == "regulation" or priority in {"critical", "high"}
    if role == "pr":
        return category != "regulation" or priority in {"critical", "high"}
    return True


def _render_digest(name: str, role: str, items: list[_DigestItem]) -> str:
    lines = [
        "RegRadar · автоматический отчёт",
        f"Для: {name} · {ROLE_LABELS.get(role, role)}",
        f"Новых релевантных событий: {len(items)}",
        "",
    ]
    for index, item in enumerate(items, 1):
        lines.extend(
            [
                f"{index}. [{PRIORITY_LABELS[item.priority]}] {item.title}",
                f"Категория: {CATEGORY_LABELS[item.category]}",
                item.summary,
                "Источники:",
                *[f"- {url}" for url in item.urls[:3]],
                "",
            ]
        )
    return "\n".join(lines).strip()


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")

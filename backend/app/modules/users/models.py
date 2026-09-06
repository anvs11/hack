"""Storage model for a Telegram or local development user."""

from sqlalchemy import ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db import Base


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    telegram_id: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    username: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    view_mode: Mapped[str] = mapped_column(Text, nullable=False)
    start_filters_json: Mapped[str] = mapped_column(Text, nullable=False)
    can_assign_tasks: Mapped[int] = mapped_column(Integer, nullable=False)
    can_confirm_analysis: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class TelegramDigestPreference(Base):
    """Per-user delivery settings kept separate from permissions and UI mode."""

    __tablename__ = "telegram_digest_preferences"

    user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("user_profiles.id"),
        primary_key=True,
    )
    enabled: Mapped[int] = mapped_column(Integer, nullable=False)
    minimum_priority: Mapped[str] = mapped_column(Text, nullable=False)
    deliver_after: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class TelegramDigestDelivery(Base):
    """Records analyses already delivered to a user to prevent repeated alerts."""

    __tablename__ = "telegram_digest_deliveries"
    __table_args__ = (UniqueConstraint("user_id", "analysis_id"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("user_profiles.id"),
        nullable=False,
    )
    analysis_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("analysis_versions.id"),
        nullable=False,
    )
    delivered_at: Mapped[str] = mapped_column(Text, nullable=False)

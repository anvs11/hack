"""Storage model for immutable specialist decision versions."""

from sqlalchemy import ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db import Base


class SpecialistDecision(Base):
    __tablename__ = "specialist_decisions"
    __table_args__ = (UniqueConstraint("publication_id", "version"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    publication_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("publications.id"),
        nullable=False,
    )
    analysis_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("analysis_versions.id"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)

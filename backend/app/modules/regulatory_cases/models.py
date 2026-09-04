"""Storage models for regulatory cases and publication links."""

from sqlalchemy import ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db import Base


class RegulatoryCase(Base):
    __tablename__ = "regulatory_cases"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    registration_number: Mapped[str] = mapped_column(Text, nullable=False)
    current_stage: Mapped[str] = mapped_column(Text, nullable=False)
    responsible_user_id: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class RegulatoryCasePublication(Base):
    __tablename__ = "regulatory_case_publications"
    __table_args__ = (UniqueConstraint("case_id", "publication_id"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    case_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("regulatory_cases.id"),
        nullable=False,
    )
    publication_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("publications.id"),
        nullable=False,
    )
    created_at: Mapped[str] = mapped_column(Text, nullable=False)

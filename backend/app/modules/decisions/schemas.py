"""Contract-shaped specialist decision request models."""

from pydantic import BaseModel, ConfigDict

from backend.app.modules.publications.schemas import Category, DecisionStatus, Priority


class SpecialistDecisionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_id: str
    status: DecisionStatus
    final_summary: str | None = None
    final_category: Category
    final_priority: Priority
    comment: str | None = None
    author_id: str

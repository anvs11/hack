"""Temporary deterministic scoring methodology for the MVP."""

from dataclasses import dataclass

from backend.app.modules.publications.schemas import Criteria, Priority


CRITERIA_FIELDS = ("K1", "K2", "K3", "K4", "K5", "K6")
HARD_FLAG_FIELDS = ("H1", "H2", "H3", "H4")


@dataclass(frozen=True)
class ScoringResult:
    score: int
    proposed_priority: Priority
    has_hard_flag: bool


def score_criteria(criteria: Criteria) -> ScoringResult:
    """Calculate a reproducible AI proposal without making a human decision."""
    score = sum(getattr(criteria, field) for field in CRITERIA_FIELDS)
    proposed_priority = _base_priority(score)
    has_hard_flag = any(getattr(criteria, field) for field in HARD_FLAG_FIELDS)
    if has_hard_flag and proposed_priority in {Priority.LOW, Priority.MEDIUM}:
        proposed_priority = Priority.HIGH
    return ScoringResult(
        score=score,
        proposed_priority=proposed_priority,
        has_hard_flag=has_hard_flag,
    )


def _base_priority(score: int) -> Priority:
    if score >= 15:
        return Priority.CRITICAL
    if score >= 10:
        return Priority.HIGH
    if score >= 5:
        return Priority.MEDIUM
    return Priority.LOW

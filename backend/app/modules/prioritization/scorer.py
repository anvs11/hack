"""Deterministic and explainable importance methodology for the MVP."""

from dataclasses import dataclass

from backend.app.modules.publications.schemas import Criteria, Priority


CRITERIA_FIELDS = (
    "business_relevance",
    "event_maturity",
    "financial_impact",
    "implementation_effort",
    "risk_severity",
    "action_urgency",
)
HARD_SIGNAL_FIELDS = (
    "state_support_or_accreditation_change",
    "service_or_legal_blocking_risk",
    "strategic_technology_status",
    "binding_legal_precedent",
)


@dataclass(frozen=True)
class ScoringResult:
    importance_score: int | None
    proposed_priority: Priority
    has_hard_signal: bool
    has_unknown_criterion: bool


def score_criteria(criteria: Criteria) -> ScoringResult:
    """Calculate a reproducible AI proposal without making a human decision."""
    values = [getattr(criteria, field) for field in CRITERIA_FIELDS]
    has_unknown_criterion = any(value is None for value in values)
    importance_score = None if has_unknown_criterion else sum(values)
    proposed_priority = (
        Priority.UNKNOWN
        if importance_score is None
        else _base_priority(importance_score)
    )
    has_hard_signal = any(getattr(criteria, field) for field in HARD_SIGNAL_FIELDS)
    if has_hard_signal and proposed_priority in {
        Priority.UNKNOWN,
        Priority.LOW,
        Priority.MEDIUM,
    }:
        proposed_priority = Priority.HIGH
    return ScoringResult(
        importance_score=importance_score,
        proposed_priority=proposed_priority,
        has_hard_signal=has_hard_signal,
        has_unknown_criterion=has_unknown_criterion,
    )


def _base_priority(score: int) -> Priority:
    if score >= 15:
        return Priority.CRITICAL
    if score >= 10:
        return Priority.HIGH
    if score >= 5:
        return Priority.MEDIUM
    return Priority.LOW

import pytest

from backend.app.modules.prioritization.scorer import score_criteria
from backend.app.modules.publications.schemas import Criteria, Priority


RATING_FIELDS = (
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


def _criteria(score: int, **hard_signals: bool) -> Criteria:
    values: dict[str, int | bool] = {}
    remaining = score
    for field in RATING_FIELDS:
        value = min(remaining, 3)
        values[field] = value
        remaining -= value
    values.update({field: False for field in HARD_SIGNAL_FIELDS})
    values.update(hard_signals)
    return Criteria.model_validate(values)


@pytest.mark.parametrize(
    ("score", "expected_priority"),
    [
        (0, Priority.LOW),
        (4, Priority.LOW),
        (5, Priority.MEDIUM),
        (9, Priority.MEDIUM),
        (10, Priority.HIGH),
        (14, Priority.HIGH),
        (15, Priority.CRITICAL),
        (18, Priority.CRITICAL),
    ],
)
def test_score_boundaries(score: int, expected_priority: Priority) -> None:
    result = score_criteria(_criteria(score))

    assert result.importance_score == score
    assert result.proposed_priority is expected_priority
    assert result.has_hard_signal is False


@pytest.mark.parametrize("hard_signal", HARD_SIGNAL_FIELDS)
def test_each_hard_signal_escalates_to_high(hard_signal: str) -> None:
    result = score_criteria(_criteria(0, **{hard_signal: True}))

    assert result.importance_score == 0
    assert result.proposed_priority is Priority.HIGH
    assert result.has_hard_signal is True


def test_hard_flag_does_not_lower_critical_priority() -> None:
    result = score_criteria(
        _criteria(18, state_support_or_accreditation_change=True)
    )

    assert result.proposed_priority is Priority.CRITICAL


def test_same_criteria_always_produce_same_result() -> None:
    criteria = _criteria(8, strategic_technology_status=True)

    assert score_criteria(criteria) == score_criteria(criteria)


def test_legacy_criteria_names_remain_readable() -> None:
    criteria = Criteria.model_validate(
        {
            "K1": 3,
            "K2": 2,
            "K3": 1,
            "K4": 0,
            "K5": 2,
            "K6": 1,
            "H1": True,
            "H2": False,
            "H3": False,
            "H4": False,
        }
    )

    assert criteria.business_relevance == 3
    assert criteria.state_support_or_accreditation_change is True
    assert "K1" not in criteria.model_dump()


def test_unknown_criterion_does_not_turn_into_zero() -> None:
    criteria = _criteria(8).model_copy(update={"financial_impact": None})

    result = score_criteria(criteria)

    assert result.importance_score is None
    assert result.proposed_priority is Priority.UNKNOWN
    assert result.has_unknown_criterion is True


def test_hard_signal_with_unknown_criterion_still_requires_high_priority_review() -> None:
    criteria = _criteria(
        8,
        service_or_legal_blocking_risk=True,
    ).model_copy(update={"financial_impact": None})

    result = score_criteria(criteria)

    assert result.importance_score is None
    assert result.proposed_priority is Priority.HIGH
    assert result.has_hard_signal is True

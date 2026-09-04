import pytest

from backend.app.modules.prioritization.scorer import score_criteria
from backend.app.modules.publications.schemas import Criteria, Priority


def _criteria(score: int, **hard_flags: bool) -> Criteria:
    values: dict[str, int | bool] = {}
    remaining = score
    for field in ("K1", "K2", "K3", "K4", "K5", "K6"):
        value = min(remaining, 3)
        values[field] = value
        remaining -= value
    values.update({field: False for field in ("H1", "H2", "H3", "H4")})
    values.update(hard_flags)
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

    assert result.score == score
    assert result.proposed_priority is expected_priority
    assert result.has_hard_flag is False


@pytest.mark.parametrize("hard_flag", ["H1", "H2", "H3", "H4"])
def test_each_hard_flag_escalates_to_high(hard_flag: str) -> None:
    result = score_criteria(_criteria(0, **{hard_flag: True}))

    assert result.score == 0
    assert result.proposed_priority is Priority.HIGH
    assert result.has_hard_flag is True


def test_hard_flag_does_not_lower_critical_priority() -> None:
    result = score_criteria(_criteria(18, H1=True))

    assert result.proposed_priority is Priority.CRITICAL


def test_same_criteria_always_produce_same_result() -> None:
    criteria = _criteria(8, H3=True)

    assert score_criteria(criteria) == score_criteria(criteria)

from backend.app.modules.regulatory_cases.schemas import LifecycleStage
from backend.app.modules.regulatory_cases.service import (
    ALLOWED_TRANSITIONS,
    is_valid_transition,
)


def test_lifecycle_transition_matrix_is_explicit_and_complete() -> None:
    assert ALLOWED_TRANSITIONS == {
        LifecycleStage.DRAFT: frozenset({LifecycleStage.INTRODUCED}),
        LifecycleStage.INTRODUCED: frozenset({LifecycleStage.ADOPTED}),
        LifecycleStage.ADOPTED: frozenset({LifecycleStage.PUBLISHED}),
        LifecycleStage.PUBLISHED: frozenset({LifecycleStage.EFFECTIVE}),
        LifecycleStage.EFFECTIVE: frozenset(
            {LifecycleStage.AMENDED, LifecycleStage.REPEALED}
        ),
        LifecycleStage.AMENDED: frozenset(
            {LifecycleStage.EFFECTIVE, LifecycleStage.REPEALED}
        ),
        LifecycleStage.REPEALED: frozenset(),
    }


def test_only_first_event_may_confirm_the_current_stage() -> None:
    assert is_valid_transition(
        LifecycleStage.DRAFT,
        LifecycleStage.DRAFT,
        has_events=False,
    )
    assert not is_valid_transition(
        LifecycleStage.DRAFT,
        LifecycleStage.DRAFT,
        has_events=True,
    )

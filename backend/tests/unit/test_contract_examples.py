import json
from pathlib import Path

import pytest

from backend.app.modules.publications.schemas import (
    AnalysisVersionResponse,
    PublicationResponse,
)
from backend.app.modules.regulatory_cases.schemas import (
    LifecycleEventResponse,
    RegulatoryCaseResponse,
)
from backend.app.modules.sources.schemas import (
    CollectionReport,
    DemoSeedImportReport,
)


EXAMPLES = Path(__file__).resolve().parents[3] / "contracts" / "examples"


@pytest.mark.parametrize("path", sorted(EXAMPLES.glob("*.json")))
def test_contract_example_is_valid_json(path: Path) -> None:
    assert isinstance(json.loads(path.read_text(encoding="utf-8")), dict)


@pytest.mark.parametrize(
    ("filename", "model"),
    [
        ("publication.json", PublicationResponse),
        ("analysis-version.json", AnalysisVersionResponse),
        ("collection-report.json", CollectionReport),
        ("demo-seed-import-report.json", DemoSeedImportReport),
        ("regulatory-case.json", RegulatoryCaseResponse),
        ("lifecycle-event.json", LifecycleEventResponse),
    ],
)
def test_implemented_contract_example_matches_backend_model(filename, model) -> None:
    payload = json.loads((EXAMPLES / filename).read_text(encoding="utf-8"))

    model.model_validate(payload)

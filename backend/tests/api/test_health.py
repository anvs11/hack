from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.db import build_engine
from backend.app.errors import install_error_handlers
from backend.app.main import app, create_app


@pytest.fixture
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'health.sqlite3'}")
    with TestClient(create_app(database_engine=engine)) as test_client:
        yield test_client
    engine.dispose()


def test_health_matches_contract(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_route_uses_contract_error_shape(client: TestClient) -> None:
    response = client.get("/api/missing")

    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "Not Found"}


def test_local_frontend_origin_is_allowed(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_unknown_origin_is_not_allowed(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": "https://example.org",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert "access-control-allow-origin" not in response.headers


def test_validation_error_uses_contract_error_shape() -> None:
    validation_app = FastAPI()
    install_error_handlers(validation_app)

    @validation_app.get("/number")
    def get_number(value: int) -> dict[str, int]:
        return {"value": value}

    response = TestClient(validation_app).get("/number", params={"value": "wrong"})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["message"] == "Request validation failed"
    assert response.json()["details"]["errors"]


def test_only_implemented_api_routes_are_exposed() -> None:
    schema = app.openapi()
    api_paths = set(schema["paths"])

    assert api_paths == {
        "/api/collections",
        "/api/demo/seed",
        "/api/health",
        "/api/publications",
        "/api/publications/{publication_id}",
        "/api/publications/{publication_id}/analyses",
        "/api/publications/{publication_id}/decisions",
        "/api/publications/{publication_id}/history",
        "/api/regulatory-cases",
        "/api/regulatory-cases/{case_id}",
        "/api/regulatory-cases/{case_id}/lifecycle-events",
        "/api/regulatory-cases/{case_id}/publications/{publication_id}",
        "/api/sources",
        "/api/sources/{source_id}",
        "/api/sources/{source_id}/collections",
    }
    assert schema["paths"]["/api/health"]["get"]["operationId"] == "getHealth"
    assert schema["paths"]["/api/demo/seed"]["post"]["operationId"] == (
        "importDemoSeed"
    )
    assert schema["paths"]["/api/collections"]["post"]["operationId"] == (
        "collectEnabledSources"
    )
    assert schema["paths"]["/api/publications"]["get"]["operationId"] == (
        "listPublications"
    )
    publication_detail = schema["paths"]["/api/publications/{publication_id}"]["get"]
    assert publication_detail["operationId"] == "getPublication"
    analyze = schema["paths"]["/api/publications/{publication_id}/analyses"]["post"]
    assert analyze["operationId"] == "createPublicationAnalysis"
    assert schema["paths"]["/api/regulatory-cases"]["post"]["operationId"] == (
        "createRegulatoryCase"
    )
    lifecycle = schema["paths"][
        "/api/regulatory-cases/{case_id}/lifecycle-events"
    ]["post"]
    assert lifecycle["operationId"] == "createLifecycleEvent"
    assert schema["paths"]["/api/sources"]["get"]["operationId"] == "listSources"
    assert schema["paths"]["/api/sources"]["post"]["operationId"] == "createSource"
    assert schema["paths"]["/api/sources/{source_id}"]["patch"]["operationId"] == (
        "updateSource"
    )
    refresh = schema["paths"]["/api/sources/{source_id}/collections"]["post"]
    assert refresh["operationId"] == "collectSource"

"""HTTP routes for source reads and ingestion operations."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.db import get_session
from backend.app.modules.sources.collection_service import (
    collect_enabled_sources,
    collect_source,
)
from backend.app.modules.sources.schemas import (
    CollectionReport,
    DemoSeedImportReport,
    SourceCreate,
    SourcePatch,
    SourceResponse,
)
from backend.app.modules.sources.seed_service import import_demo_seed
from backend.app.modules.sources.service import (
    create_source as create_source_record,
    list_sources as read_sources,
    update_source as update_source_record,
)


router = APIRouter()


@router.get(
    "/api/sources",
    operation_id="listSources",
    response_model=list[SourceResponse],
)
def list_sources(session: Annotated[Session, Depends(get_session)]) -> list[SourceResponse]:
    return read_sources(session)


@router.post(
    "/api/sources",
    operation_id="createSource",
    response_model=SourceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_source(
    source: SourceCreate,
    session: Annotated[Session, Depends(get_session)],
) -> SourceResponse:
    return create_source_record(session, source)


@router.patch(
    "/api/sources/{source_id}",
    operation_id="updateSource",
    response_model=SourceResponse,
)
def update_source(
    source_id: str,
    patch: SourcePatch,
    session: Annotated[Session, Depends(get_session)],
) -> SourceResponse:
    source = update_source_record(session, source_id, patch)
    if source is None:
        raise HTTPException(status_code=404, detail="Источник не найден")
    return source


@router.post(
    "/api/sources/{source_id}/collections",
    operation_id="collectSource",
    response_model=CollectionReport,
)
def collect_single_source(
    source_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> CollectionReport:
    report = collect_source(session, source_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Источник не найден")
    return report


@router.post(
    "/api/collections",
    operation_id="collectEnabledSources",
    response_model=CollectionReport,
)
def collect_all_sources(
    session: Annotated[Session, Depends(get_session)],
) -> CollectionReport:
    return collect_enabled_sources(session)


@router.post(
    "/api/demo/seed",
    operation_id="importDemoSeed",
    response_model=DemoSeedImportReport,
)
def import_demo_data(request: Request) -> DemoSeedImportReport:
    engine: Engine = request.app.state.database_engine
    result = import_demo_seed(engine)
    return DemoSeedImportReport(
        sources=result.sources,
        publications=result.publications,
        analyses=result.analyses,
        duplicates=result.duplicates,
    )

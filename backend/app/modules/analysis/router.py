"""HTTP endpoint for creating immutable publication analyses."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from backend.app.db import get_session
from backend.app.modules.analysis.service import create_analysis_version
from backend.app.modules.publications.schemas import AnalysisVersionResponse, Analyzer


router = APIRouter()


class AnalysisCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analyzer: Analyzer = Analyzer.REPLAY


@router.post(
    "/api/publications/{publication_id}/analyses",
    operation_id="createPublicationAnalysis",
    response_model=AnalysisVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_publication_analysis(
    publication_id: str,
    session: Annotated[Session, Depends(get_session)],
    request: AnalysisCreate | None = None,
) -> AnalysisVersionResponse:
    analyzer = request.analyzer if request else Analyzer.REPLAY
    analysis = create_analysis_version(session, publication_id, analyzer)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Публикация не найдена")
    return analysis

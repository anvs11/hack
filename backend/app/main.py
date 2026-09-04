"""Application entrypoint used by the canonical Uvicorn command."""

from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Engine

from backend.app.db import build_session_factory, create_schema, default_engine
from backend.app.errors import install_error_handlers
from backend.app.modules.analysis.router import router as analysis_router
from backend.app.modules.decisions.router import router as decisions_router
from backend.app.modules.publications.router import router as publications_router
from backend.app.modules.regulatory_cases.router import router as regulatory_cases_router
from backend.app.modules.sources.router import router as sources_router


LOCAL_FRONTEND_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
)


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]


def create_app(database_engine: Engine | None = None) -> FastAPI:
    engine = database_engine or default_engine

    @asynccontextmanager
    async def lifespan(_application: FastAPI):
        create_schema(engine)
        yield

    application = FastAPI(
        title="PR/GR AI Analytics API",
        version="0.2.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    application.state.database_engine = engine
    application.state.database_session_factory = build_session_factory(engine)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(LOCAL_FRONTEND_ORIGINS),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(application)
    application.include_router(analysis_router)
    application.include_router(decisions_router)
    application.include_router(publications_router)
    application.include_router(regulatory_cases_router)
    application.include_router(sources_router)

    @application.get(
        "/api/health",
        operation_id="getHealth",
        response_model=HealthResponse,
    )
    def get_health() -> HealthResponse:
        return HealthResponse(status="ok")

    return application


app = create_app()

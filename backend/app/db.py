"""SQLAlchemy engine, schema bootstrap and FastAPI session dependency."""

from collections.abc import Generator
from pathlib import Path

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from backend.app.config import get_database_url


class Base(DeclarativeBase):
    pass


def build_engine(database_url: str | None = None) -> Engine:
    url = database_url or get_database_url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args)

    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(dbapi_connection: object, _connection_record: object) -> None:
            cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

    return engine


def _ensure_sqlite_parent(engine: Engine) -> None:
    url = make_url(str(engine.url))
    if url.drivername == "sqlite" and url.database not in (None, "", ":memory:"):
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)


def create_schema(engine: Engine) -> None:
    """Create missing demo tables without changing existing rows."""

    from backend.app.modules.analysis import models as _analysis_models
    from backend.app.modules.decisions import models as _decision_models
    from backend.app.modules.publications import models as _publication_models
    from backend.app.modules.regulatory_cases import models as _case_models
    from backend.app.modules.sources import models as _source_models

    _ = (
        _analysis_models,
        _case_models,
        _decision_models,
        _publication_models,
        _source_models,
    )
    _ensure_sqlite_parent(engine)
    Base.metadata.create_all(engine)


default_engine = build_engine()


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


SessionLocal = build_session_factory(default_engine)


def get_session(request: Request) -> Generator[Session, None, None]:
    """Yield one database session per request."""

    factory: sessionmaker[Session] = getattr(
        request.app.state,
        "database_session_factory",
        SessionLocal,
    )
    with factory() as session:
        yield session

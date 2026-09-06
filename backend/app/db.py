"""SQLAlchemy engine, schema bootstrap and FastAPI session dependency."""

from collections.abc import Generator
from pathlib import Path

from fastapi import Request
from sqlalchemy import Engine, create_engine, event, inspect, text
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
    """Create missing application tables without changing existing rows."""

    from backend.app.modules.analysis import models as _analysis_models
    from backend.app.modules.decisions import models as _decision_models
    from backend.app.modules.publications import models as _publication_models
    from backend.app.modules.regulatory_cases import models as _case_models
    from backend.app.modules.sources import models as _source_models
    from backend.app.modules.users import models as _user_models

    _ = (
        _analysis_models,
        _case_models,
        _decision_models,
        _publication_models,
        _source_models,
        _user_models,
    )
    _ensure_sqlite_parent(engine)
    Base.metadata.create_all(engine)
    if engine.dialect.name == "sqlite":
        columns = {
            column["name"]
            for column in inspect(engine).get_columns("telegram_digest_preferences")
        }
        if "deliver_after" not in columns:
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "ALTER TABLE telegram_digest_preferences "
                        "ADD COLUMN deliver_after TEXT NOT NULL "
                        "DEFAULT '1970-01-01T00:00:00Z'"
                    )
                )
                connection.execute(
                    text(
                        "UPDATE telegram_digest_preferences "
                        "SET deliver_after = updated_at"
                    )
                )
        case_columns = {
            column["name"]
            for column in inspect(engine).get_columns("regulatory_cases")
        }
        with engine.begin() as connection:
            if "origin" not in case_columns:
                connection.execute(
                    text(
                        "ALTER TABLE regulatory_cases ADD COLUMN origin TEXT NOT NULL "
                        "DEFAULT 'manual'"
                    )
                )
            if "needs_review" not in case_columns:
                connection.execute(
                    text(
                        "ALTER TABLE regulatory_cases ADD COLUMN needs_review INTEGER "
                        "NOT NULL DEFAULT 0"
                    )
                )
            if "identifier_key" not in case_columns:
                connection.execute(
                    text("ALTER TABLE regulatory_cases ADD COLUMN identifier_key TEXT")
                )
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS "
                    "ix_regulatory_cases_identifier_key "
                    "ON regulatory_cases(identifier_key)"
                )
            )
    # v0.5 briefly exposed a middle "standard" mode. Collapse it into the
    # detailed mode while keeping existing local and deployed profiles valid.
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE user_profiles SET view_mode = 'expert' "
                "WHERE view_mode = 'standard'"
            )
        )


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

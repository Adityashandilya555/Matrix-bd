"""Database layer — engine, session, ORM models."""
from app.db.base import Base
from app.db.session import SessionLocal, engine, get_db, transaction
from app.db import models  # ensures models register with Base.metadata
# Attaches the NSO capture hooks to MatrixSession. Imported here (after session
# and models), and capture registers itself at its own bottom, so importing
# either app.db or app.integrations.capture first works.
import app.integrations.capture  # noqa: E402,F401

__all__ = ["Base", "SessionLocal", "engine", "get_db", "models", "transaction"]

"""SQLAlchemy declarative base."""
from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base — every ORM model inherits from this."""

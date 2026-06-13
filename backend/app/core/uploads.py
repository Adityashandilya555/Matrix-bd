"""Shared upload helpers.

`read_upload_capped` is the single guard every multipart endpoint uses to read a
file body. It enforces a hard size cap — first via the declared part size when
present, then defensively while streaming — so no endpoint can buffer an
unbounded body into process memory and OOM the backend (#93).
"""
from __future__ import annotations

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

# Read the spooled file in 1 MB chunks so we never materialise more than the cap
# (plus one chunk) in memory before rejecting an oversized upload.
_CHUNK_BYTES = 1024 * 1024

# ── Content-type allowlist (#177) ─────────────────────────────────────────
# Covers every type the UI actually accepts: LOI inputs accept .pdf/.doc/.docx,
# photo/logo inputs accept image/* (incl. iPhone HEIC and the non-standard
# image/jpg alias some clients send), and project/design deliverables include
# legacy Office (.doc/.xls) and CSV exports. Deliberately excludes risky types
# like image/svg+xml (script-bearing) and application/zip (opaque archive).
ALLOWED_MIME = {
    # Images
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
    "image/heic", "image/heif",
    # Documents
    "application/pdf",
    "application/msword",                                                        # .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   # .docx
    "application/vnd.ms-excel",                                                  # .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         # .xlsx
    "text/csv",                                                                  # .csv
}

def _unsupported(ct: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail=f"File type '{ct}' not allowed.",
    )

def _too_large(limit: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=f"File too large. Maximum upload size is {limit // (1024 * 1024)} MB.",
    )


async def read_upload_capped(file: UploadFile, *, max_bytes: int | None = None) -> bytes:
    """Read an UploadFile fully, but never more than ``max_bytes``.

    Raises 413 if the declared part size exceeds the cap (fast path) or if the
    streamed body grows past it (defensive — a lying/absent Content-Length).
    """
    limit = max_bytes if max_bytes is not None else settings.max_upload_bytes

    # Restrict allowed content-types (#177)
    content_type = getattr(file, "content_type", None)
    if isinstance(file, UploadFile):
        if not content_type or not content_type.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing or empty Content-Type header."
            )
    if content_type and content_type not in ALLOWED_MIME:
        raise _unsupported(content_type)

    # Fast reject when the multipart part already declares an oversized body.
    declared = getattr(file, "size", None)
    if declared is not None and declared > limit:
        raise _too_large(limit)

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise _too_large(limit)
        chunks.append(chunk)
    return b"".join(chunks)

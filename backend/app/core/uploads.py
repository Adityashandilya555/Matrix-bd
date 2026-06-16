"""Shared upload helpers.

`read_upload_capped` is the single guard every multipart endpoint uses to read a
file body. It enforces a hard size cap — first via the declared part size when
present, then defensively while streaming — so no endpoint can buffer an
unbounded body into process memory and OOM the backend (#93).
"""
from __future__ import annotations

import logging

import filetype
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

_log = logging.getLogger("matrix.uploads")

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
    # text/csv is accepted for project/design deliverables and CSV exports.
    # CSV/Excel formula-injection (#226, 4.2) is a DOWNSTREAM risk only: nothing
    # in this app parses or renders an uploaded CSV — files are served via
    # short-lived Supabase signed download URLs, never inline. Accepted risk;
    # do not sanitise cell contents (that would mutate user data).
    "text/csv",                                                                  # .csv
}

# Magic-byte validation (#226, 4.1). The declared multipart Content-Type is
# attacker-controlled, so a benign type can wrap a malicious payload. For types
# with a STRONG, reliable byte signature we reconcile the declared type against
# the actual bytes and reject mismatches. Each declared type maps to the set of
# detected MIMEs we accept (OOXML can surface as its specific type or, for an
# oddly-packed-but-valid file, the generic zip container).
_STRONG_MAGIC: dict[str, set[str]] = {
    "image/jpeg": {"image/jpeg"},
    "image/jpg":  {"image/jpeg"},   # non-standard alias some clients send
    "image/png":  {"image/png"},
    "image/webp": {"image/webp"},
    "image/gif":  {"image/gif"},
    "image/heic": {"image/heic", "image/heif"},
    "image/heif": {"image/heic", "image/heif"},
    "application/pdf": {"application/pdf"},
    # OOXML files (.docx/.xlsx) are ZIP containers, but filetype introspects the
    # package and returns the SPECIFIC OOXML mime for genuine documents. We do
    # NOT accept a bare application/zip here: that would let any arbitrary ZIP be
    # uploaded while claiming to be .docx/.xlsx, defeating the mismatch check.
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
}
# Declared types deliberately NOT byte-checked: legacy OLE2 Office (.doc/.xls)
# and text/csv have weak/absent magic, so a strict check would reject genuine
# files. They pass on the declared-type allowlist alone (allow-with-warning).
_WEAK_MAGIC = {"application/msword", "application/vnd.ms-excel", "text/csv"}

def _unsupported(ct: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail=f"File type '{ct}' not allowed.",
    )

def _content_mismatch(declared: str) -> HTTPException:
    # The detected type is logged at the call site, not echoed to the client
    # (no need to reveal sniffing internals in the error body).
    return HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail=f"File content does not match its declared type '{declared}'.",
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
    data = b"".join(chunks)

    # Magic-byte reconciliation (#226). The body is already buffered, so this is
    # no extra I/O. Only enforce for strong-signature types; weak/absent-magic
    # types (legacy Office, CSV) pass on the declared allowlist alone so genuine
    # files are never rejected. A POSITIVE mismatch (bytes detected as a
    # different, known type) is rejected; an undetectable body is allowed.
    if content_type in _STRONG_MAGIC:
        kind = filetype.guess(data)
        if kind is not None and kind.mime not in _STRONG_MAGIC[content_type]:
            _log.warning(
                "upload rejected: declared %s but bytes detected as %s",
                content_type, kind.mime,
            )
            raise _content_mismatch(content_type)
    return data

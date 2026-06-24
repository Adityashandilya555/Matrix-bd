"""Shared upload helpers.

Defensively caps file sizes to prevent OOM errors, and validates allowed MIME types.
"""
from __future__ import annotations

import logging

import filetype
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

_log = logging.getLogger("matrix.uploads")

# Read in 1 MB chunks to cap memory footprint
_CHUNK_BYTES = 1024 * 1024

# ── Content-type allowlist ─────────────────────────────────────────
# Allowed file types: images, PDFs, Word/Excel documents, and CSV.
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
    # text/csv
    "text/csv",                                                                  # .csv
}

# Magic-byte validation. Reconcile declared type against actual bytes for strong-magic types.
_STRONG_MAGIC: dict[str, set[str]] = {
    "image/jpeg": {"image/jpeg"},
    "image/jpg":  {"image/jpeg"},   # non-standard alias some clients send
    "image/png":  {"image/png"},
    "image/webp": {"image/webp"},
    "image/gif":  {"image/gif"},
    "image/heic": {"image/heic", "image/heif"},
    "image/heif": {"image/heic", "image/heif"},
    "application/pdf": {"application/pdf"},
    # OOXML files (.docx/.xlsx) are ZIP containers and may sniff as application/zip if markers
    # fall outside the scan window. These are allowed with a warning.
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
}
# The two OOXML container types.
_OOXML_MIME = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
# Declared types deliberately NOT byte-checked due to weak/absent magic signatures.
_WEAK_MAGIC = {"application/msword", "application/vnd.ms-excel", "text/csv"}

# Import-time invariant.
if set(_STRONG_MAGIC) | _WEAK_MAGIC != ALLOWED_MIME:  # pragma: no cover - invariant
    raise RuntimeError(
        "uploads allowlist drift: set(_STRONG_MAGIC) | _WEAK_MAGIC must equal ALLOWED_MIME"
    )

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

    # Restrict allowed content-types
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

    # Magic-byte reconciliation. Enforce only for strong-signature types.
    if content_type in _STRONG_MAGIC:
        kind = filetype.guess(data)
        if kind is not None and kind.mime not in _STRONG_MAGIC[content_type]:
            # A declared OOXML whose markers fall past filetype's scan window is application/zip.
            # Allow application/zip for OOXML types with a warning, reject other mismatches.
            if content_type in _OOXML_MIME and kind.mime == "application/zip":
                _log.warning(
                    "upload allowed with warning: declared %s, bytes sniffed as "
                    "application/zip (OOXML markers likely past the scan window)",
                    content_type,
                )
            else:
                _log.warning(
                    "upload rejected: declared %s but bytes detected as %s",
                    content_type, kind.mime,
                )
                raise _content_mismatch(content_type)
    return data

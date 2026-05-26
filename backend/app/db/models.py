"""SQLAlchemy ORM models for the Matrix platform.

Mirrors `backend/database/schema.sql` 1:1, plus the additions enumerated in
`Matrix_dev/02_Data_&_State/Proposed_Schema_Additions.md` (which translate to
the SQL emitted by `Matrix_dev/02_Data_&_State/run_alter_table.md`).

All tables are tenant-scoped. Every query the service layer emits must filter
by `tenant_id` to keep the multi-tenant boundary tight.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


# ── Tenant + User ─────────────────────────────────────────────────────────

class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    plan: Mapped[str] = mapped_column(Text, nullable=False, server_default="standard")
    seat_limit: Mapped[int] = mapped_column(Integer, nullable=False, server_default="10")
    workspace_code: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="executive")
    email: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # ADDED (run_alter_table §users): supervisor metadata (display only).
    assigned_city: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        Index("idx_users_tenant_id_role", "tenant_id", "role"),
    )


# ── Site + SiteDetail ─────────────────────────────────────────────────────

class Site(Base):
    __tablename__ = "sites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    # Sequential / display code (e.g. "BT-MUM-A12C"). NOT in schema.sql today —
    # backend generates it client-side. Add column via run_alter_table §sites.
    code: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="draft_submitted")
    name: Mapped[str] = mapped_column(Text, nullable=False)
    city: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[Optional[str]] = mapped_column(Text)
    visit_date: Mapped[Optional[date]] = mapped_column(Date)
    notes: Mapped[Optional[str]] = mapped_column(Text)

    # Pipeline-stage fields (some exist; expected_rent + rent_type + rent_set_at are added)
    model: Mapped[Optional[str]] = mapped_column(Text)  # Postgres enum at the DB level
    spoc_name: Mapped[Optional[str]] = mapped_column(Text)
    spoc_email: Mapped[Optional[str]] = mapped_column(Text)
    spoc_phone: Mapped[Optional[str]] = mapped_column(Text)
    google_maps_pin: Mapped[Optional[str]] = mapped_column(Text)
    expected_rent: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    rent_type: Mapped[Optional[str]] = mapped_column(Text)
    rent_set_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Ownership
    submitted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    supervisor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    # Timestamps for each state transition
    draft_submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    shortlisted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    details_submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    loi_uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    pushed_to_payments_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    rejected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Soft-delete / rejection metadata
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text)
    archive_note: Mapped[Optional[str]] = mapped_column(Text)
    # Snapshot of sites.status taken at archive time so Revive can restore exactly.
    archived_from_status: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        Index("idx_sites_tenant_id_status", "tenant_id", "status"),
        Index("idx_sites_assigned_to", "assigned_to"),
        Index("idx_sites_supervisor_id", "supervisor_id"),
        Index("idx_sites_submitted_by", "submitted_by"),
        CheckConstraint("rent_type IN ('fixed','revshare') OR rent_type IS NULL", name="chk_sites_rent_type"),
    )


class SiteDetail(Base):
    __tablename__ = "site_details"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id"), unique=True, nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    carpet_area_sqft: Mapped[Optional[float]] = mapped_column(Numeric)
    estimated_monthly_sales: Mapped[Optional[float]] = mapped_column(Numeric)
    score: Mapped[Optional[float]] = mapped_column(Numeric)
    rent_type: Mapped[Optional[str]] = mapped_column(Text)
    fixed_rent_amt: Mapped[Optional[float]] = mapped_column(Numeric)
    escalation_pct: Mapped[Optional[float]] = mapped_column(Numeric)
    brokerage: Mapped[Optional[float]] = mapped_column(Numeric)
    rev_share_pct: Mapped[Optional[float]] = mapped_column(Numeric)
    cam_charges: Mapped[Optional[float]] = mapped_column(Numeric)
    security_deposit: Mapped[Optional[float]] = mapped_column(Numeric)
    capex: Mapped[Optional[float]] = mapped_column(Numeric)
    lock_in_months: Mapped[Optional[int]] = mapped_column(Integer)
    tenure_months: Mapped[Optional[int]] = mapped_column(Integer)
    rent_free_days: Mapped[Optional[int]] = mapped_column(Integer)
    nearest_starbucks_m: Mapped[Optional[int]] = mapped_column(Integer)
    nearest_twc_m: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )


# ── Audit + Stage Events + Approvals ──────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    # ADDED by run_alter_table §audit_logs: site_id FK so the activity feed query
    # `WHERE site_id = $1` is fast and meaningful.
    site_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"))
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    actor_name: Mapped[Optional[str]] = mapped_column(Text)  # denormalised for the activity tab
    action: Mapped[str] = mapped_column(Text, nullable=False)
    # Generic entity pointers retained for non-site events (e.g. assign_role)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    entity_type: Mapped[Optional[str]] = mapped_column(Text)
    # ADDED: stage transition columns
    from_status: Mapped[Optional[str]] = mapped_column(Text)
    to_status: Mapped[Optional[str]] = mapped_column(Text)
    # ADDED: field-level diff columns (for action='pipeline_field_edited')
    field_name: Mapped[Optional[str]] = mapped_column(Text)
    from_value: Mapped[Optional[str]] = mapped_column(Text)
    to_value: Mapped[Optional[str]] = mapped_column(Text)
    detail: Mapped[Optional[str]] = mapped_column(Text)
    old_value: Mapped[Optional[dict]] = mapped_column(JSONB)
    new_value: Mapped[Optional[dict]] = mapped_column(JSONB)
    ip_address: Mapped[Optional[str]] = mapped_column(Text)
    user_agent: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_audit_logs_site_id_created_at", "site_id", "created_at"),
        Index("idx_audit_logs_tenant_id_created_at", "tenant_id", "created_at"),
    )


class StageEvent(Base):
    __tablename__ = "stage_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id"), nullable=False)
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    from_status: Mapped[Optional[str]] = mapped_column(Text)
    to_status: Mapped[Optional[str]] = mapped_column(Text)
    actor_role: Mapped[Optional[str]] = mapped_column(Text)
    api_route: Mapped[Optional[str]] = mapped_column(Text)
    source: Mapped[Optional[str]] = mapped_column(Text, server_default="web")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    metadata_json: Mapped[Optional[dict]] = mapped_column("metadata", JSONB)


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id"), nullable=False)
    approver_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    expected_loi_days: Mapped[Optional[int]] = mapped_column(Integer)
    loi_deadline: Mapped[Optional[date]] = mapped_column(Date)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    rejection_category: Mapped[Optional[str]] = mapped_column(Text)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_approvals_site_id", "site_id"),
        Index("idx_approvals_approver_id", "approver_id"),
    )


# ── Files + Notifications ─────────────────────────────────────────────────

class SiteFile(Base):
    __tablename__ = "site_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id"), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    file_type: Mapped[str] = mapped_column(Text, nullable=False)  # postgres enum file_type
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_size_kb: Mapped[Optional[int]] = mapped_column(Integer)
    mime_type: Mapped[Optional[str]] = mapped_column(Text)
    is_primary: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="false")
    source: Mapped[str] = mapped_column(Text, nullable=False, server_default="manual_upload")
    onedrive_item_id: Mapped[Optional[str]] = mapped_column(Text)
    onedrive_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_site_files_site_id_type", "site_id", "file_type"),
    )


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    site_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id"))
    recipient_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    recipient_email: Mapped[Optional[str]] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False, server_default="email")
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    subject: Mapped[Optional[str]] = mapped_column(Text)
    body: Mapped[Optional[str]] = mapped_column(Text)
    payload: Mapped[Optional[dict]] = mapped_column(JSONB)
    failed_reason: Mapped[Optional[str]] = mapped_column(Text)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("channel IN ('email','slack','in_app')", name="chk_notification_channel"),
        CheckConstraint("status IN ('pending','sent','failed','skipped')", name="chk_notification_status"),
        Index("idx_notification_outbox_status", "status"),
    )


# ── Shortlist delegation ──────────────────────────────────────────────────

class ShortlistDelegation(Base):
    __tablename__ = "shortlist_delegations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id"), nullable=False)
    delegate_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    granted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    notes: Mapped[Optional[str]] = mapped_column(Text)

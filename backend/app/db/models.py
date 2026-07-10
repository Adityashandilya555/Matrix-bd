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
from typing import ClassVar, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

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
    model: Mapped[Optional[str]] = mapped_column(Text)  # free text — store_model enum dropped (202606141)
    spoc_name: Mapped[Optional[str]] = mapped_column(Text)
    spoc_email: Mapped[Optional[str]] = mapped_column(Text)
    spoc_phone: Mapped[Optional[str]] = mapped_column(Text)
    google_maps_pin: Mapped[Optional[str]] = mapped_column(Text)
    google_maps_url: Mapped[Optional[str]] = mapped_column(Text)
    expected_rent: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    rent_type: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="rent type: fixed | revshare | mg_revshare | staggered",
    )
    # Per rent_type, only a subset of these is meaningful:
    #   fixed       → expected_rent + expected_escalation_pct
    #   revshare    → expected_revshare_pct
    #   mg_revshare → expected_rent (MG floor) + expected_revshare_pct
    #   staggered   → expected_rent (base) + staggered_escalation (JSONB schedule)
    expected_escalation_pct: Mapped[Optional[float]] = mapped_column(Numeric(6, 2))
    # Cadence in years for the escalation (1 = yearly, 3 = every 3 yrs, 5 = every 5 yrs).
    expected_escalation_years: Mapped[Optional[int]] = mapped_column(Integer)
    expected_revshare_pct: Mapped[Optional[float]] = mapped_column(Numeric(6, 2))
    rent_set_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Pipeline-stage area (sqft). Captured at draft creation; flows to
    # site_details.carpet_area_sqft when the Add Details form is filled.
    area_sqft: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Staggered escalation schedule: JSONB array of {year: int, percent: float}.
    # Only used when rent_type == 'staggered'. Max 5 entries.
    staggered_escalation: Mapped[Optional[dict]] = mapped_column(JSONB)

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
    # Legal workflow timestamps
    legal_review_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    legal_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    legal_rejected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Cross-module status mirrors — BD reads these columns to render dashboard chips.
    # Legal module writes legal_dd_status + agreement_status.
    # Payment module writes licensing_status.
    legal_dd_status: Mapped[Optional[str]] = mapped_column(Text, server_default="pending")
    agreement_status: Mapped[Optional[str]] = mapped_column(Text, server_default="pending")
    licensing_status: Mapped[Optional[str]] = mapped_column(Text, server_default="pending")
    # Design module mirror — a PARALLEL track that opens once legal_dd_status='positive'
    # (DDR cleared). The design module owns this column; BD/dashboards read it.
    # Values: pending | allocated | in_progress | gfc_pending | approved | rejected
    design_status: Mapped[Optional[str]] = mapped_column(Text, server_default="pending")
    design_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Project (execution) module mirror — the live column already exists
    # (NOT NULL DEFAULT 'pending', CHECK over pending/allocated/budgeting/
    # in_progress/done) but was unmapped and unwritten, so every completed store
    # read 'pending' forever. project_service now mirrors each milestone here,
    # matching the legal/design/finance mirror contract BD/BI read. (#134)
    project_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    project_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Project Excellence module mirror — written by project_excellence_service.
    project_excellence_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    # Financial Closure (closure-phase budget) mirror — written post-launch.
    financial_closure_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")

    # Finance / CA code flow (managed from the Site Tracker Finance tab).
    # Once ca_code is set it replaces site.code as the display identifier.
    kyc_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    ca_code: Mapped[Optional[str]] = mapped_column(Text)
    finance_amount: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    # pending → awaiting_supervisor → awaiting_admin → approved
    finance_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")

    # Soft-delete / rejection metadata
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text)
    archive_note: Mapped[Optional[str]] = mapped_column(Text)
    # Snapshot of sites.status taken at archive time so Revive can restore exactly.
    archived_from_status: Mapped[Optional[str]] = mapped_column(Text)

    # Post-NSO launch flag — set by the Launch Approval workflow.
    is_launched: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    launched_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        Index("idx_sites_tenant_id_status", "tenant_id", "status"),
        Index("idx_sites_assigned_to", "assigned_to"),
        Index("idx_sites_supervisor_id", "supervisor_id"),
        Index("idx_sites_submitted_by", "submitted_by"),
        CheckConstraint("rent_type IN ('fixed','revshare','mg_revshare','staggered') OR rent_type IS NULL", name="chk_sites_rent_type"),
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
    # Extra field added for the Launch Approval flow (migration 202606094).
    escalation_date: Mapped[Optional[date]] = mapped_column(Date)
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
        # Composite covers the two common query shapes:
        #   WHERE site_id = X ORDER BY created_at DESC (LIMIT 1)
        #   WHERE site_id IN (...) ORDER BY created_at DESC
        # This replaces the old bare idx_approvals_site_id (subsumed) and
        # drops the duplicate idx_approvals_site / idx_approvals_approver.
        Index("idx_approvals_site_created", "site_id", "created_at"),
        Index("idx_approvals_approver_id", "approver_id"),
    )


# ── Files + Notifications ─────────────────────────────────────────────────

class SiteFile(Base):
    __tablename__ = "site_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id"), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    file_type: Mapped[str] = mapped_column(Text, nullable=False)  # chk_site_files_file_type: loi | photo | quality_audit
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


# ── Module-aware site delegation (legal / payment / bd) ────────────────────
# Mirrors ShortlistDelegation but carries an explicit `module` discriminator so
# the same row shape can serve any module. Legal is the first consumer.

class SiteDelegation(Base):
    __tablename__ = "site_delegations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    module: Mapped[str] = mapped_column(Text, nullable=False)
    delegate_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    granted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("module IN ('bd','legal','design','project','nso','project_excellence','financial_closure')", name="chk_site_delegations_module"),  # 'payment' retired (202606132); 'project_excellence' (202606134) + 'financial_closure' (202606147)
    )


# ── Legal workflow child tables ───────────────────────────────────────────────
# Three separate 1:1 tables owned by the Legal module.
# The parent `sites` row carries mirror status columns (legal_dd_status,
# agreement_status, licensing_status) that BD reads for dashboard chips.
# Never let BD read these child tables directly — that creates coupling.

class LegalDdChecklist(Base):
    """Due-diligence checklist. site_id is the PK (one row per site).

    Checklist items use a three-value text enum: 'pending' | 'yes' | 'no'.
    final_verdict is set by the legal supervisor: 'pending' | 'positive' | 'negative'.
    """
    __tablename__ = "legal_dd_checklist"

    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True,
    )

    # 7 standard checks + 2 overflow slots
    title_doc: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    sanctioned_plan: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    oc_cc: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    commercial_use: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    property_tax: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    electricity: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    fire_noc: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    other_1: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    other_2: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    # User-typed labels for the two free-form other slots. NULL means the slot
    # is unused. Added 2026-05-29 (migration add_dd_checklist_other_labels)
    # so the executive's custom check name survives Save Draft round-trips.
    other_1_label: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    other_2_label: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    final_verdict: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text)

    # Workflow stage gate (migration 202605272_checklist_stage).
    # Executives mutate rows while stage='draft'. Submitting for review flips to
    # 'pending_review' (read-only for executive). Supervisor finalize/licensing
    # save publishes the row → 'published' (BD-visible).
    # Default 'published' keeps pre-existing rows BD-visible.
    stage: Mapped[str] = mapped_column(Text, nullable=False, server_default="published")

    # Who worked on it
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))   # legal exec
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))   # legal supervisor

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "title_doc IN ('pending','yes','no') AND sanctioned_plan IN ('pending','yes','no') "
            "AND oc_cc IN ('pending','yes','no') AND commercial_use IN ('pending','yes','no') "
            "AND property_tax IN ('pending','yes','no') AND electricity IN ('pending','yes','no') "
            "AND fire_noc IN ('pending','yes','no') AND other_1 IN ('pending','yes','no') "
            "AND other_2 IN ('pending','yes','no')",
            name="chk_dd_checklist_values",
        ),
        CheckConstraint(
            "final_verdict IN ('pending','positive','negative')",
            name="chk_dd_final_verdict",
        ),
        CheckConstraint(
            "stage IN ('draft','pending_review','published')",
            name="chk_dd_checklist_stage",
        ),
        Index("idx_legal_dd_checklist_stage", "stage"),
    )


class SiteAgreement(Base):
    """Agreement record for a site. site_id is the PK (one row per site).

    Mirrors sites.agreement_status:
      signed=true   → 'signed'
      registered=true → 'registered'
    """
    __tablename__ = "site_agreement"

    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True,
    )

    signed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    registered: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    registered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    document_url: Mapped[Optional[str]] = mapped_column(Text)


class SiteLicensing(Base):
    """Licensing checklist. site_id is the PK (one row per site).

    Owned by the Payment module. Legal workflow creates the row; Payment fills it.
    Mirrors sites.licensing_status: all 'yes' → 'complete'.
    """
    __tablename__ = "site_licensing"

    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True,
    )

    fssai: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    health_trade: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    shops_estab_reg: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    fire_noc: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    storage_license: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")

    # Workflow stage gate (migration 202605272_checklist_stage). See LegalDdChecklist.stage.
    stage: Mapped[str] = mapped_column(Text, nullable=False, server_default="published")

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "fssai IN ('pending','yes','no') AND health_trade IN ('pending','yes','no') "
            "AND shops_estab_reg IN ('pending','yes','no') AND fire_noc IN ('pending','yes','no') "
            "AND storage_license IN ('pending','yes','no')",
            name="chk_licensing_values",
        ),
        CheckConstraint(
            "stage IN ('draft','pending_review','published')",
            name="chk_site_licensing_stage",
        ),
        Index("idx_site_licensing_stage", "stage"),
    )


# ── Cross-module change requests ─────────────────────────────────────────────
# BD opens a "please flip this No back to Yes" ticket against a specific
# legal field; the legal supervisor approves (overwrites underlying value
# immediately) or rejects (no change, reason recorded).

class LegalChangeRequest(Base):
    __tablename__ = "legal_change_requests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4(),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False,
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False,
    )

    target_table: Mapped[str] = mapped_column(Text, nullable=False)
    field_name:   Mapped[str] = mapped_column(Text, nullable=False)
    current_value:   Mapped[str] = mapped_column(Text, nullable=False)
    requested_value: Mapped[str] = mapped_column(Text, nullable=False)
    justification:   Mapped[Optional[str]] = mapped_column(Text)

    requested_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False,
    )

    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    reviewed_by:   Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    reviewer_note: Mapped[Optional[str]] = mapped_column(Text)

    created_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at:  Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "target_table IN ('legal_dd_checklist','site_agreement','site_licensing')",
            name="chk_lcr_target_table",
        ),
        CheckConstraint(
            "status IN ('pending','approved','rejected')",
            name="chk_lcr_status",
        ),
        Index("idx_lcr_tenant_status", "tenant_id", "status"),
        Index("idx_lcr_site", "site_id"),
        Index("idx_lcr_requested_by", "requested_by"),
    )


# ── Design workflow child tables ───────────────────────────────────────────────
# A PARALLEL track that opens once a site's legal_dd_status flips to 'positive'
# (DDR cleared). Mirrors the Legal pattern: child tables hold the granular detail;
# the parent `sites.design_status` column is what BD/dashboards read. The linear
# site state machine (state_machine.py) is deliberately NOT touched — design is an
# annotation track like the recently-added sites.finance_status.

class DesignReview(Base):
    """One row per site — the design "folder".

    Tracks which deliverable is active (`current_stage`) and the business_admin's
    GFC (Good-For-Construction) gate.

      current_stage: 'recce' | '2d' | '3d' | 'boq' | 'gfc' | 'done'
      gfc_status:    'pending' | 'approved' | 'rejected'  (business_admin owns it)

    gfc_comments are written by the admin and are visible to the design supervisor.
    """
    __tablename__ = "design_reviews"

    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False,
    )
    current_stage: Mapped[str] = mapped_column(Text, nullable=False, server_default="recce")
    gfc_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    gfc_comments: Mapped[Optional[str]] = mapped_column(Text)
    gfc_decided_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    gfc_decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))   # design exec
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))   # design supervisor
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "current_stage IN ('recce','2d','3d','boq','gfc','done')",
            name="chk_design_current_stage",
        ),
        CheckConstraint(
            "gfc_status IN ('pending','approved','rejected')",
            name="chk_design_gfc_status",
        ),
        Index("idx_design_reviews_tenant", "tenant_id"),
    )


class DesignDeliverable(Base):
    """One row per (site, kind). Each deliverable independently runs the
    executive-upload → supervisor-review loop.

      kind:   'recce' | '2d' | '3d' | 'boq'
      status: 'pending' | 'submitted' | 'approved' | 'rejected'

    `supervisor_comments` are visible to the executive (the reject → re-upload
    loop). `estimated_amount` is only meaningful for kind='boq'.
    """
    __tablename__ = "design_deliverables"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    file_url: Mapped[Optional[str]] = mapped_column(Text)
    file_name: Mapped[Optional[str]] = mapped_column(Text)
    estimated_amount: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    supervisor_comments: Mapped[Optional[str]] = mapped_column(Text)
    submitted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Second-tier business_admin approval — required for 2D and 3D (only) before
    # they advance. 'pending' for unreviewed; recce/boq never use it.
    admin_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    admin_comments: Mapped[Optional[str]] = mapped_column(Text)
    admin_reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    admin_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("site_id", "kind", name="uq_design_deliverable_site_kind"),
        CheckConstraint("kind IN ('recce','2d','3d','boq')", name="chk_design_deliverable_kind"),
        CheckConstraint("status IN ('pending','submitted','approved','rejected')", name="chk_design_deliverable_status"),
        CheckConstraint("admin_status IN ('pending','approved','rejected')", name="chk_design_deliverable_admin_status"),
        Index("idx_design_deliverables_site", "site_id"),
    )


# ── Project execution workflow ────────────────────────────────────────────────
# Opens after business_admin GFC approval marks sites.design_status='approved'.

class ProjectReview(Base):
    """One row per site for the Project Execution module."""
    __tablename__ = "project_reviews"
    # `updated_at` is a server-side onupdate (func.now()). Every write path
    # (budget save/submit, allocate, reviews, milestones) updates this row and
    # then reads it back via _build_response. Without eager_defaults the column
    # is left *expired* after the UPDATE flush, so reading review.updated_at
    # triggers a lazy refresh — a synchronous DB call inside the async session,
    # which raises MissingGreenlet and surfaces to the client as a CORS-masked
    # 500 ("Network Error"). eager_defaults fetches server defaults/onupdates
    # back via RETURNING during flush, so the attribute stays populated.
    __mapper_args__: ClassVar[dict] = {"eager_defaults": True}

    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False,
    )
    project_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    current_stage: Mapped[str] = mapped_column(Text, nullable=False, server_default="execution")
    allocated_to: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    initialization_date: Mapped[Optional[date]] = mapped_column(Date)
    initialization_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    initialization_comments: Mapped[Optional[str]] = mapped_column(Text)
    expected_completion_date: Mapped[Optional[date]] = mapped_column(Date)
    expected_completion_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    expected_completion_comments: Mapped[Optional[str]] = mapped_column(Text)
    # Supervisor-set after expected completion is approved; surfaced to the executive.
    mid_project_visit_date: Mapped[Optional[date]] = mapped_column(Date)
    inspection_date: Mapped[Optional[date]] = mapped_column(Date)
    quality_audit_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    quality_audit_comments: Mapped[Optional[str]] = mapped_column(Text)
    # Quality audit is a calendar date + two-tier sign-off (no document upload):
    # executive submits inspection_date -> supervisor approves -> business_admin confirms.
    quality_audit_supervisor_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    quality_audit_supervisor_approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    quality_audit_admin_confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    quality_audit_admin_confirmed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    quality_audit_admin_notes: Mapped[Optional[str]] = mapped_column(Text)
    final_completion_date: Mapped[Optional[date]] = mapped_column(Date)
    project_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # NSO handoff: set on quality-audit approval; the (parallel) NSO module
    # consumes sites where nso_status='pushed'.
    nso_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    pushed_to_nso_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "project_status IN ('pending','allocated','in_progress','done')",
            name="chk_project_status",
        ),
        CheckConstraint(
            "current_stage IN ('execution','done')",
            name="chk_project_current_stage",
        ),
        CheckConstraint(
            "initialization_status IN ('pending','proposed','submitted','approved','rejected')",
            name="chk_project_initialization_status",
        ),
        CheckConstraint(
            "nso_status IN ('pending','pushed')",
            name="chk_project_nso_status",
        ),
        CheckConstraint(
            "expected_completion_status IN ('pending','submitted','approved','rejected')",
            name="chk_project_expected_completion_status",
        ),
        CheckConstraint(
            "quality_audit_status IN ('pending','submitted','supervisor_approved','approved','rejected')",
            name="chk_project_quality_status",
        ),
        Index("idx_project_reviews_tenant_status", "tenant_id", "project_status"),
    )



# ── Shared site budget (gfc + closure phases) ─────────────────────────────────
# Module-agnostic budget owned by no single department. Project Excellence fills
# the 'gfc' phase (post-GFC, pre-project); Financial Closure fills the 'closure'
# phase (post-launch) with per-line variation vs gfc. Replaces the PE-private
# project_excellence_reviews / project_excellence_items tables.

class SiteBudget(Base):
    """One row per (site, phase). phase ∈ {gfc, closure}."""
    __tablename__ = "site_budgets"
    __mapper_args__: ClassVar[dict] = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    phase: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="draft")
    allocated_to: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    budget_total: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    total_indoor_area_sqft: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    total_area_sqft: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    covers: Mapped[Optional[int]] = mapped_column(Integer)
    supervisor_comments: Mapped[Optional[str]] = mapped_column(Text)
    admin_comments: Mapped[Optional[str]] = mapped_column(Text)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        CheckConstraint("phase IN ('gfc','closure')", name="chk_site_budget_phase"),
        CheckConstraint(
            "status IN ('draft','pending_supervisor','pending_admin','approved','rejected')",
            name="chk_site_budget_status",
        ),
        UniqueConstraint("site_id", "phase", name="uq_site_budget_site_phase"),
        Index("idx_site_budgets_tenant_phase_status", "tenant_id", "phase", "status"),
        Index("idx_site_budgets_site", "site_id"),
    )


class SiteBudgetItem(Base):
    """11 budget line items per (site, phase)."""
    __tablename__ = "site_budget_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    budget_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("site_budgets.id", ondelete="CASCADE"), nullable=False)
    phase: Mapped[str] = mapped_column(Text, nullable=False)
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[Optional[str]] = mapped_column(Text)
    amount: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        CheckConstraint("phase IN ('gfc','closure')", name="chk_site_budget_item_phase"),
        CheckConstraint("idx BETWEEN 1 AND 11", name="chk_site_budget_item_idx"),
        UniqueConstraint("budget_id", "idx", name="uq_site_budget_item_budget_idx"),
        Index("idx_site_budget_items_site_phase", "site_id", "phase"),
        Index("idx_site_budget_items_budget", "budget_id"),
    )


# ── NSO workflow ─────────────────────────────────────────────────────────────
# New Store Opening checks run after Finance / CA has produced an approved CA
# code, then continue as Project milestones unlock.

class NsoReview(Base):
    """One row per site for New Store Opening readiness."""
    __tablename__ = "nso_reviews"

    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False,
    )
    current_stage: Mapped[str] = mapped_column(Text, nullable=False, server_default="stage_one")
    nso_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")

    property_details: Mapped[Optional[str]] = mapped_column(Text)
    communication_floated: Mapped[Optional[bool]] = mapped_column(Boolean)

    fssai_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    health_trade_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    shops_estab_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    fire_noc_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    storage_license_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")

    dry_stock_order_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    online_delivery_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    handover_checklist_signed: Mapped[Optional[bool]] = mapped_column(Boolean)
    launch_date: Mapped[Optional[date]] = mapped_column(Date)
    launch_ready: Mapped[Optional[bool]] = mapped_column(Boolean)
    final_approval_signoff_1: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    final_approval_signoff_2: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    stage_one_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    stage_two_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    stage_three_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    final_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Set when the Project module's NSO-Handover tab pushes the site in — opens
    # the record directly at stage three (stages 1 & 2 satisfied upstream).
    handover_pushed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "current_stage IN ('stage_one','stage_two','stage_three','final','done')",
            name="chk_nso_current_stage",
        ),
        CheckConstraint(
            "nso_status IN ('pending','in_progress','complete')",
            name="chk_nso_status",
        ),
        CheckConstraint(
            "fssai_status IN ('pending','done')",
            name="chk_nso_fssai_status",
        ),
        CheckConstraint(
            "health_trade_status IN ('pending','done')",
            name="chk_nso_health_trade_status",
        ),
        CheckConstraint(
            "shops_estab_status IN ('pending','done')",
            name="chk_nso_shops_estab_status",
        ),
        CheckConstraint(
            "fire_noc_status IN ('pending','done')",
            name="chk_nso_fire_noc_status",
        ),
        CheckConstraint(
            "storage_license_status IN ('pending','done')",
            name="chk_nso_storage_license_status",
        ),
        CheckConstraint(
            "dry_stock_order_status IN ('pending','ordered','received')",
            name="chk_nso_dry_stock_status",
        ),
        CheckConstraint(
            "online_delivery_status IN ('pending','ready','active')",
            name="chk_nso_online_delivery_status",
        ),
        Index("idx_nso_reviews_tenant_status", "tenant_id", "nso_status"),
    )


# ── Post-NSO Launch Approval workflow ────────────────────────────────────────
# Opens when NSO final_approved_at is set. Drives the multi-step sign-off:
#   pending → admin_approved → bd_confirmed → supervisor_approved
#   → super_admin_approved → launched
# Mirrors an editable snapshot of commercial fields from site_details + sites.

class LaunchApproval(Base):
    """One row per site for the post-NSO launch approval chain."""
    __tablename__ = "launch_approvals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), unique=True, nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    # Editable commercial snapshot (pre-populated from site_details + sites)
    rent_type: Mapped[Optional[str]] = mapped_column(Text)
    fixed_rent_amt: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    expected_rent: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    rev_share_pct: Mapped[Optional[float]] = mapped_column(Numeric(6, 2))
    escalation_pct: Mapped[Optional[float]] = mapped_column(Numeric(6, 2))
    escalation_date: Mapped[Optional[date]] = mapped_column(Date)
    expected_escalation_years: Mapped[Optional[int]] = mapped_column(Integer)
    cam_charges: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    security_deposit: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    brokerage: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    lock_in_months: Mapped[Optional[int]] = mapped_column(Integer)
    tenure_months: Mapped[Optional[int]] = mapped_column(Integer)
    rent_free_days: Mapped[Optional[int]] = mapped_column(Integer)
    carpet_area_sqft: Mapped[Optional[float]] = mapped_column(Numeric(10, 2))
    estimated_monthly_sales: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    capex: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    score: Mapped[Optional[float]] = mapped_column(Numeric(6, 2))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    # Workflow status FSM — the admin → exec → supervisor → admin validation loop.
    #   pending_admin_review → under_exec_review → under_supervisor_review
    #   → pending_admin_final → ready_to_launch → launched
    # (migration 202606121 migrated the legacy pending/admin_approved/… set.)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending_admin_review")

    # ── Validation-loop verdicts / comments / actors (migration 202606121) ──────
    # Admin · first touch
    admin_review_comment: Mapped[Optional[str]] = mapped_column(Text)
    admin_sent_for_review_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    admin_sent_for_review_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    # Executive · review verdict (recorded, flows forward — never bounces back)
    exec_verdict: Mapped[Optional[str]] = mapped_column(Text)        # approved | rejected
    exec_comment: Mapped[Optional[str]] = mapped_column(Text)
    exec_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    exec_reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    # Supervisor · review verdict (+ may have edited rent terms)
    supervisor_verdict: Mapped[Optional[str]] = mapped_column(Text)  # approved | rejected
    supervisor_comment: Mapped[Optional[str]] = mapped_column(Text)
    supervisor_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    supervisor_reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    # Admin · final touch (the DB commit into site_details + sites happens here)
    admin_final_comment: Mapped[Optional[str]] = mapped_column(Text)
    admin_confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    admin_confirmed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    committed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Launch (terminal go-live)
    launched_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    launched_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    # ── Legacy approve-only ladder columns (pre-202606121) — kept nullable for
    # back-compat; the validation loop no longer writes them. ──────────────────
    admin_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    admin_approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    bd_confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    bd_confirmed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    supervisor_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    supervisor_approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    super_admin_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    super_admin_approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending_admin_review','under_exec_review',"
            "'under_supervisor_review','pending_admin_final',"
            "'ready_to_launch','launched')",
            name="chk_launch_approval_status",
        ),
        CheckConstraint(
            "exec_verdict IS NULL OR exec_verdict IN ('approved','rejected')",
            name="chk_launch_exec_verdict",
        ),
        CheckConstraint(
            "supervisor_verdict IS NULL OR supervisor_verdict IN ('approved','rejected')",
            name="chk_launch_supervisor_verdict",
        ),
        Index("idx_launch_approvals_tenant_status", "tenant_id", "status"),
    )


class LaunchReviewEvent(Base):
    """Append-only timeline for the launch validation loop.

    One row per action: the draft `baseline`, each rent `edited` (with a
    field-level diff in ``changes``), each `approved`/`rejected` verdict +
    comment, the final `confirmed`/`committed`, and the `launched` go-live.
    Powers the admin's "all rent changes from draft → end" view and the
    comment thread shared across admin / executive / supervisor.
    """
    __tablename__ = "launch_review_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    launch_approval_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("launch_approvals.id", ondelete="CASCADE"), nullable=False,
    )
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    actor_name: Mapped[Optional[str]] = mapped_column(Text)
    actor_role: Mapped[Optional[str]] = mapped_column(Text)  # business_admin | executive | supervisor | system

    stage: Mapped[str] = mapped_column(Text, nullable=False)   # admin_review | exec_review | supervisor_review | admin_final | system
    action: Mapped[str] = mapped_column(Text, nullable=False)  # baseline | edited | sent_for_review | approved | rejected | confirmed | committed | launched
    comment: Mapped[Optional[str]] = mapped_column(Text)
    changes: Mapped[Optional[list]] = mapped_column(JSONB)     # [{field,label,from,to}, …]

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_launch_review_events_approval", "launch_approval_id", "created_at"),
        Index("idx_launch_review_events_site", "site_id", "created_at"),
    )


# ---------------------------------------------------------------------------
# Async-safety for every mapped class: fetch server-side defaults / onupdate
# values (notably `updated_at = func.now()`) via RETURNING during flush.
#
# Without this, those columns are left *expired* after an INSERT/UPDATE; the
# first read — e.g. building a response object right after a write — triggers a
# lazy refresh, i.e. a synchronous DB call inside the async session, which
# raises sqlalchemy.exc.MissingGreenlet and reaches the client as a CORS-masked
# 500 ("Network Error"). This bit the Project budget save, and the identical
# trap exists in Design / Legal / BD write-then-read paths. Applying it to the
# whole registry immunises every module at once (ProjectReview also declares it
# explicitly above as the documented discovery site).
for _mapper in Base.registry.mappers:
    _mapper.eager_defaults = True

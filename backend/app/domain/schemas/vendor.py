"""Request bodies for the vendor platform routers (/vendor-admin, /vendor).

Responses are plain dicts built by the services. Validation that needs the
tenant's settings (durations, admission mode) happens in the services.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, EmailStr, Field


class VendorSettingsIn(BaseModel):
    """Everything a workspace can customise about its vendor platform."""

    admission_mode: Literal["owner_approves_staff", "admin_approves_all"]
    update_cutoff_local: str = "19:00"
    timezone: str = "Asia/Kolkata"
    mall_duration_days: int = 40
    non_mall_duration_days: int = 45
    portal_title: Optional[str] = Field(default=None, max_length=80)
    accent_color: Optional[str] = Field(default=None, max_length=7)
    welcome_text: Optional[str] = Field(default=None, max_length=500)
    support_contact: Optional[str] = Field(default=None, max_length=160)


class PhaseIn(BaseModel):
    """One plan phase."""

    phase_key: str = Field(min_length=1, max_length=24)
    name: str = Field(min_length=1, max_length=80)
    start_day: int
    end_day: int
    weight: int
    sort_order: int = 0


class PhasesIn(BaseModel):
    """A site type's whole plan."""

    site_type: Literal["mall", "non_mall"]
    phases: list[PhaseIn]


class ChecklistItemIn(BaseModel):
    """One mobilisation checklist item; id absent for a new item."""

    id: Optional[str] = None
    kind: Literal["mobilisation_vendor", "mobilisation_brand"]
    label: str = Field(min_length=1, max_length=200)
    active: bool = True
    sort_order: int = 0


class ChecklistIn(BaseModel):
    """The tenant's whole checklist."""

    items: list[ChecklistItemIn]


class VendorCreateIn(BaseModel):
    """A new vendor company."""

    name: str = Field(min_length=1, max_length=120)
    legal_name: Optional[str] = Field(default=None, max_length=160)
    gstin: Optional[str] = Field(default=None, max_length=20)
    owner_email: Optional[EmailStr] = None


class VendorUpdateIn(BaseModel):
    """Edit or suspend a vendor company."""

    name: Optional[str] = Field(default=None, max_length=120)
    legal_name: Optional[str] = Field(default=None, max_length=160)
    gstin: Optional[str] = Field(default=None, max_length=20)
    status: Optional[Literal["active", "suspended"]] = None


class OwnerInviteIn(BaseModel):
    """An owner account to create for a vendor."""

    email: EmailStr
    name: Optional[str] = Field(default=None, max_length=120)


class ProjectCreateIn(BaseModel):
    """A PO issued to a vendor company."""

    vendor_id: str
    site_id: Optional[str] = None
    ca_code: Optional[str] = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=160)
    city: str = Field(min_length=1, max_length=80)
    brand: Optional[str] = Field(default=None, max_length=80)
    site_type: Literal["mall", "non_mall"] = "non_mall"
    po_number: str = Field(min_length=1, max_length=60)
    po_value: float = Field(gt=0)
    po_date: str
    start_date: str


class AcceptPoIn(BaseModel):
    """Vendor's confirmed start date."""

    start_date: str


class InitiationIn(BaseModel):
    """Vendor initiation details and their half of the checklist."""

    supervisor_name: Optional[str] = Field(default=None, max_length=120)
    supervisor_phone: Optional[str] = Field(default=None, max_length=40)
    crew_size: Optional[int] = None
    delivery_plan: Optional[str] = Field(default=None, max_length=4000)
    checks: dict[str, bool] = Field(default_factory=dict)


class DailyUpdateIn(BaseModel):
    """Today's update: cumulative % per phase plus site facts."""

    progress: dict[str, Any] = Field(default_factory=dict)
    manpower: Optional[int] = 0
    supervisor_on_site: bool = True
    ppe_ok: bool = True
    material: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Field(default=None, max_length=1000)
    hindrance_text: Optional[str] = Field(default=None, max_length=1000)

"""Schemas for the NSO (New Store Opening) module."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


DoneStatus = Literal["pending", "done"]
DryStockStatus = Literal["pending", "ordered", "received"]
OnlineDeliveryStatus = Literal["pending", "ready", "active"]


class NsoTriggerState(BaseModel):
    key: str
    label: str
    unlocked: bool
    complete: bool
    reason: Optional[str] = None


class NsoQueueItem(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    finance_status: str
    ca_code: Optional[str] = None
    project_status: str = "pending"
    project_current_stage: str = "budget"
    nso_status: str = "pending"
    current_stage: str = "stage_one"
    next_action: str
    updated_at: Optional[datetime] = None


class NsoQueueResponse(BaseModel):
    items: list[NsoQueueItem]
    total: int


class NsoHistoryResponse(NsoQueueResponse):
    pass


class NsoStateResponse(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    tenant_id: str
    submitted_by_name: Optional[str] = None
    site_status: str
    finance_status: str
    ca_code: Optional[str] = None
    project_status: str = "pending"
    project_current_stage: str = "budget"
    project_initialization_date: Optional[date] = None
    project_initialization_status: str = "pending"
    project_final_completion_date: Optional[date] = None
    project_completed_at: Optional[datetime] = None

    nso_status: str
    current_stage: str
    triggers: list[NsoTriggerState] = Field(default_factory=list)

    property_details: Optional[str] = None
    communication_floated: Optional[bool] = None

    fssai_status: DoneStatus = "pending"
    health_trade_status: DoneStatus = "pending"
    shops_estab_status: DoneStatus = "pending"
    fire_noc_status: DoneStatus = "pending"
    storage_license_status: DoneStatus = "pending"

    dry_stock_order_status: DryStockStatus = "pending"
    online_delivery_status: OnlineDeliveryStatus = "pending"
    handover_checklist_signed: Optional[bool] = None
    launch_date: Optional[date] = None
    launch_ready: Optional[bool] = None
    final_approval_signoff_1: bool = False
    final_approval_signoff_2: bool = False

    stage_one_completed_at: Optional[datetime] = None
    stage_two_completed_at: Optional[datetime] = None
    stage_three_completed_at: Optional[datetime] = None
    final_approved_at: Optional[datetime] = None
    updated_at: datetime


class NsoStageOneRequest(BaseModel):
    property_details: str = Field(min_length=1, max_length=2000)
    communication_floated: bool


class NsoStageTwoRequest(BaseModel):
    fssai_status: DoneStatus = "pending"
    health_trade_status: DoneStatus = "pending"
    shops_estab_status: DoneStatus = "pending"
    fire_noc_status: DoneStatus = "pending"
    storage_license_status: DoneStatus = "pending"


class NsoStageThreeRequest(BaseModel):
    dry_stock_order_status: DryStockStatus = "pending"
    online_delivery_status: OnlineDeliveryStatus = "pending"
    handover_checklist_signed: bool | None = None
    launch_date: date | None = None
    launch_ready: bool | None = None
    final_approval_signoff_1: bool = False
    final_approval_signoff_2: bool = False

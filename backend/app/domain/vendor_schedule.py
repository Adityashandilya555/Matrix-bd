"""Fit-out schedule maths for the vendor platform — pure functions, no I/O.

Ported from the Fit-Out Site Tracker demo, with its delay defect fixed: in the
demo the delay stopped growing once a site passed its target date (55 days late
still read "4 days behind"), and a site with every slider at 100% but no
handover read "On track" forever. Here the delay is the larger of the schedule
slip and the days past the target, so it keeps growing until handover.

Phases come from the tenant's plan template (vendor_plan_phases): each has a
start day, end day and weight; weights total 100.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Mapping, Optional, Sequence


@dataclass(frozen=True)
class Phase:
    """One template phase: active from start_day to end_day, worth weight %."""

    key: str
    name: str
    start_day: int
    end_day: int
    weight: int


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def scale_phases(base: Sequence[Phase], from_days: int, to_days: int) -> list[Phase]:
    """Stretch or shrink a plan to another duration, exactly as the demo did
    for mall sites (round half to even differs from JS Math.round only on exact
    .5, which these day counts never produce)."""
    if from_days == to_days:
        return list(base)
    out = []
    for p in base:
        start = max(1, _js_round((p.start_day - 1) * to_days / from_days) + 1)
        end = max(start, _js_round(p.end_day * to_days / from_days))
        out.append(Phase(p.key, p.name, start, end, p.weight))
    return out


def _js_round(x: float) -> int:
    """JavaScript Math.round: halves round up."""
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def planned_fraction(p: Phase, day: float) -> float:
    """Share of phase `p` planned to be done by `day` (0..1)."""
    return _clamp((day - p.start_day + 1) / (p.end_day - p.start_day + 1), 0.0, 1.0)


def planned_pct(phases: Sequence[Phase], day: float) -> float:
    """Planned overall % complete by `day`."""
    return sum(p.weight * planned_fraction(p, day) for p in phases)


def overall_pct(phases: Sequence[Phase], progress: Mapping[str, float]) -> float:
    """Overall % complete from per-phase cumulative progress."""
    return sum(p.weight * float(progress.get(p.key, 0) or 0) / 100 for p in phases)


def earned_day(phases: Sequence[Phase], actual: float, duration: int) -> float:
    """First day on the planned curve that reaches `actual` (binary search)."""
    lo, hi = 0.0, float(duration)
    for _ in range(40):
        mid = (lo + hi) / 2
        if planned_pct(phases, mid) >= actual - 1e-6:
            hi = mid
        else:
            lo = mid
    return hi


def is_past_cutoff(now_local: datetime, cutoff: time) -> bool:
    """Whether the local wall-clock time is at or after today's update cutoff."""
    return (now_local.hour, now_local.minute) >= (cutoff.hour, cutoff.minute)


@dataclass(frozen=True)
class ScheduleResult:
    """Everything the portal and the Project page show about one site."""

    day: int
    duration: int
    actual_pct: float
    planned_pct: float
    target_date: date
    forecast_date: Optional[date]
    schedule_status: str
    slip_days: int
    days_past_target: int
    missed_in_row: int
    updated_today: bool
    ref_day: int


def _missed_in_row(*, today: date, start_date: date, update_dates: set[date], updated_today: bool,
                   past_cutoff: bool) -> int:
    """Consecutive days with no update, counting back from yesterday (or from
    today once the cutoff has passed without today's update)."""
    missed = 0
    d = today if (past_cutoff and not updated_today) else today - timedelta(days=1)
    while d >= start_date and d not in update_dates and missed < 60:
        missed += 1
        d -= timedelta(days=1)
    return missed


def _status(*, handed: bool, cancelled: bool, accepted: bool, day: int, missed: int, projected: int) -> str:
    """Status, in priority order; see compute()."""
    if handed:
        return "handed"
    if cancelled:
        return "cancelled"
    if not accepted:
        return "po"
    if day < 1:
        return "mobilising"
    if missed >= 2 or projected > 3:
        return "late"
    return "risk" if projected >= 1 else "ontrack"


def _forecast(*, handed_over_on: Optional[date], cancelled: bool, target: date, projected: int,
              today: date) -> Optional[date]:
    """Handover date if done; otherwise never earlier than tomorrow."""
    if handed_over_on is not None:
        return handed_over_on
    if cancelled:
        return None
    return max(target + timedelta(days=projected), today + timedelta(days=1))


def compute(
    *,
    phases: Sequence[Phase],
    duration: int,
    start_date: date,
    today: date,
    accepted: bool,
    handed_over_on: Optional[date],
    cancelled: bool,
    latest_progress: Mapping[str, float],
    update_dates: set[date],
    past_cutoff: bool,
) -> ScheduleResult:
    """Status, progress, slip and forecast for one site on `today`.

    Status order: handed over, cancelled, PO not accepted, not started, then
    late (2+ updates missed in a row, or more than 3 days behind), at risk
    (1-3 days behind), on track.
    """
    day = (today - start_date).days + 1
    actual = overall_pct(phases, latest_progress)
    updated_today = today in update_dates
    ref_day = int(_clamp(day if updated_today else day - 1, 0, duration))
    target = start_date + timedelta(days=duration - 1)
    earned = earned_day(phases, actual, duration)
    slip = 0 if actual >= 99.9 else max(0, _js_round(ref_day - earned))
    ahead = max(0, _js_round(earned - ref_day))
    handed = handed_over_on is not None
    closed = handed or cancelled
    days_past = 0 if closed else max(0, (today - target).days)
    projected = max(slip, days_past)
    missed = 0 if closed or day <= 1 else _missed_in_row(
        today=today, start_date=start_date, update_dates=update_dates,
        updated_today=updated_today, past_cutoff=past_cutoff,
    )
    status = _status(handed=handed, cancelled=cancelled, accepted=accepted, day=day, missed=missed, projected=projected)
    quiet = status in ("handed", "po", "mobilising", "cancelled")
    return ScheduleResult(
        day=day, duration=duration, actual_pct=round(actual, 2),
        planned_pct=round(planned_pct(phases, ref_day), 2), target_date=target,
        forecast_date=_forecast(handed_over_on=handed_over_on, cancelled=cancelled, target=target,
                                projected=projected, today=today),
        schedule_status=status, slip_days=0 if quiet else (projected if projected > 0 else -ahead),
        days_past_target=days_past, missed_in_row=missed, updated_today=updated_today,
        ref_day=ref_day,
    )


# Seed values for a tenant's first read of its templates (the demo's plan).
DEFAULT_NON_MALL_PHASES: tuple[Phase, ...] = (
    Phase("mob", "Mobilisation & marking", 1, 3, 5),
    Phase("civ", "Civil & MEP first fix", 4, 15, 25),
    Phase("flr", "Ceiling & flooring", 14, 25, 20),
    Phase("car", "Carpentry & finishes", 22, 37, 30),
    Phase("mep", "MEP final & equipment", 35, 41, 12),
    Phase("hnd", "Snags & handover", 42, 45, 8),
)
DEFAULT_CHECKLIST: tuple[tuple[str, str], ...] = (
    ("mobilisation_vendor", "Approved design, BOQ and spec sheets received"),
    ("mobilisation_vendor", "Samples from the approved make list submitted"),
    ("mobilisation_vendor", "PPE kits ready for full crew"),
    ("mobilisation_vendor", "Floor and edge protection material arranged"),
    ("mobilisation_vendor", "Carpentry pre-fabrication booked in workshop"),
    ("mobilisation_brand", "Approved design, BOQ and spec sheets issued with PO"),
    ("mobilisation_brand", "Site handed over with landlord permissions in place"),
    ("mobilisation_brand", "Named project manager assigned"),
)


def validate_phases(phases: Sequence[Phase], duration: int) -> Optional[str]:
    """Return a plain-language problem with a plan, or None if it is valid."""
    if not phases:
        return "A plan needs at least one phase."
    keys = [p.key for p in phases]
    if len(set(keys)) != len(keys):
        return "Each phase needs its own key."
    total = sum(p.weight for p in phases)
    if total != 100:
        return f"Phase weights must add up to 100 (they add up to {total})."
    for p in phases:
        if not p.name.strip():
            return "Every phase needs a name."
        if not (1 <= p.start_day <= p.end_day <= duration):
            return f'"{p.name}" must run between day 1 and day {duration}, and end on or after it starts.'
        if not (0 <= p.weight <= 100):
            return f'"{p.name}" needs a weight between 0 and 100.'
    return None

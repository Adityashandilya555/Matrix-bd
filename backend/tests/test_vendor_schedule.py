"""Vendor platform schedule maths (app/domain/vendor_schedule.py).

The headline regression: in the demo the delay stopped growing once a site
passed its target, and a site with every slider at 100% but no handover read
"On track" forever. These pin the fixed behaviour on the same test site the
spec uses: a 45-day plan.
"""
from __future__ import annotations

from datetime import date, time, timedelta, datetime

from app.domain.vendor_schedule import (
    DEFAULT_NON_MALL_PHASES as P45, Phase, compute, is_past_cutoff, overall_pct, planned_pct,
    scale_phases, validate_phases,
)

START = date(2026, 1, 1)
ALL_BUT_HANDOVER = {"mob": 100, "civ": 100, "flr": 100, "car": 100, "mep": 100, "hnd": 0}   # 92%
EVERYTHING = {k: 100 for k in ALL_BUT_HANDOVER}


def _on(day: int, progress, *, updated_yesterday: bool = True, accepted: bool = True, handed=None):
    today = START + timedelta(days=day - 1)
    dates = {today - timedelta(days=1)} if updated_yesterday else set()
    return compute(
        phases=P45, duration=45, start_date=START, today=today, accepted=accepted,
        handed_over_on=handed, cancelled=False, latest_progress=progress,
        update_dates=dates, past_cutoff=False,
    )


def test_weights_total_100_and_planned_curve_ends_at_100():
    assert sum(p.weight for p in P45) == 100
    assert planned_pct(P45, 45) == 100
    assert planned_pct(P45, 0) == 0
    assert overall_pct(P45, ALL_BUT_HANDOVER) == 92


def test_mall_scaling_matches_the_demo():
    mall = {p.key: (p.start_day, p.end_day) for p in scale_phases(P45, 45, 40)}
    assert mall == {"mob": (1, 3), "civ": (4, 13), "flr": (13, 22), "car": (20, 33), "mep": (31, 36), "hnd": (37, 40)}


def test_delay_keeps_growing_past_the_target():
    # Stuck at 92%: the demo showed "4 days behind" on day 46, 60 AND 100.
    assert _on(46, ALL_BUT_HANDOVER).slip_days == 4
    r60 = _on(60, ALL_BUT_HANDOVER)
    assert (r60.slip_days, r60.days_past_target, r60.schedule_status) == (15, 15, "late")
    assert _on(100, ALL_BUT_HANDOVER).slip_days == 55


def test_all_sliders_at_100_without_handover_is_late_not_on_track():
    r = _on(100, EVERYTHING)
    assert r.schedule_status == "late"
    assert r.days_past_target == 55


def test_forecast_is_never_in_the_past_while_open():
    r = _on(60, ALL_BUT_HANDOVER)
    assert r.forecast_date >= START + timedelta(days=60)


def test_status_order_and_missed_updates():
    assert _on(10, {}, accepted=False).schedule_status == "po"
    assert _on(0, {}).schedule_status == "mobilising"
    on_plan = {"mob": 100, "civ": 50}
    assert _on(10, on_plan).schedule_status in ("ontrack", "risk")
    # Two consecutive days with no update → late, whatever the progress.
    gap = compute(phases=P45, duration=45, start_date=START, today=START + timedelta(days=9), accepted=True,
                  handed_over_on=None, cancelled=False, latest_progress=on_plan,
                  update_dates={START + timedelta(days=6)}, past_cutoff=False)
    assert gap.missed_in_row == 2 and gap.schedule_status == "late"


def test_handed_over_site():
    r = _on(70, EVERYTHING, handed=START + timedelta(days=44))
    assert (r.schedule_status, r.forecast_date, r.days_past_target, r.slip_days) == ("handed", START + timedelta(days=44), 0, 0)


def test_cutoff_is_wall_clock_local():
    assert is_past_cutoff(datetime(2026, 1, 1, 19, 0), time(19, 0)) is True
    assert is_past_cutoff(datetime(2026, 1, 1, 18, 59), time(19, 0)) is False


def test_validate_phases_messages():
    assert validate_phases(list(P45), 45) is None
    assert "add up to 100" in validate_phases([Phase("a", "A", 1, 5, 60)], 45)
    assert "between day 1 and day 45" in validate_phases([Phase("a", "A", 1, 46, 100)], 45)
    assert "own key" in validate_phases([Phase("a", "A", 1, 2, 50), Phase("a", "B", 3, 4, 50)], 45)
    assert validate_phases([], 45) == "A plan needs at least one phase."

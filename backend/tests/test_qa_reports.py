"""Quality-audit report unread logic (before/after PDF reports).

Locks the rule the feature hinges on: the Project NSO-Handover "View" button is
unread (yellow) whenever a report was pushed more recently than Project last
opened them — so pushing the 'after' (secondary) report re-flags a site that
Project had already viewed. No live DB (pure function).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.project_service import _qa_reports_unread

T0 = datetime(2026, 7, 20, 9, 0, tzinfo=timezone.utc)


class _Report:
    """Stand-in for a QualityAuditReport row — only pushed_at matters here."""
    def __init__(self, pushed_at):
        self.pushed_at = pushed_at


def test_unread_false_when_nothing_pushed():
    assert _qa_reports_unread(_Report(None), _Report(None), None) is False
    assert _qa_reports_unread(None, None, T0) is False


def test_unread_true_when_pushed_but_never_viewed():
    assert _qa_reports_unread(_Report(T0), None, None) is True


def test_unread_false_once_viewed_after_the_push():
    assert _qa_reports_unread(_Report(T0), None, T0 + timedelta(hours=1)) is False


def test_unread_retriggers_when_after_pushed_post_view():
    # 'before' pushed + viewed, then 'after' pushed later → unread again.
    before = _Report(T0)
    viewed = T0 + timedelta(hours=1)
    after = _Report(T0 + timedelta(hours=2))
    assert _qa_reports_unread(before, after, viewed) is True


def test_unread_uses_latest_push_vs_view():
    # Latest push (after at +2h) is older than the view (+3h) → read.
    before = _Report(T0)
    after = _Report(T0 + timedelta(hours=2))
    assert _qa_reports_unread(before, after, T0 + timedelta(hours=3)) is False

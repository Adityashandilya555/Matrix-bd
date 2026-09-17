"""The Financial Closure queue buckets Pending/Closed in SQL (#498).

The queue orders by ``launched_at DESC``, which has no correlation with closure
state, so the first page can legitimately be entirely one bucket. Both closure
summary surfaces used to split the loaded page client-side, which meant that with
more than one page in closure the Closed tab rendered "No sites have completed
closure yet" while closed sites sat on page 2 — a factual claim about the
business, made on a financial screen, from rows that had never been fetched.

So the split moved here. Two things have to hold and neither is visible from the
rendered page:

* ``total`` must count the REQUESTED bucket, so each tab pages independently and
  "loaded 50 of N" agrees with the rows on screen;
* ``pending_total`` / ``closed_total`` must count BOTH buckets regardless of
  which one was asked for, because the tabs show a count on the one that is not
  being paged.

The counts are therefore taken before the bucket predicate is applied. A refactor
that folds them into the filtered statement would make the inactive tab's badge
mirror the active one, which reads as plausible and is wrong.
"""
from __future__ import annotations

import asyncio
import uuid

from app.services.financial_closure_service import svc_fc_queue


def _queue(session, **kw):
    """Run the queue against a session that yields no rows, so it returns right
    after the page query — the three statements under test are the two counts
    and the page itself."""
    return asyncio.run(svc_fc_queue(session, tenant_id=uuid.uuid4(), **kw))


def _counted(make_session, fake_result):
    return make_session(
        # One aggregate pass returns both buckets as (closed, pending).
        fake_result(all_rows=[(40, 60)]),
        fake_result(all_rows=[]),    # the page itself
    )


def test_closed_true_totals_the_closed_bucket(make_session, fake_result):
    resp = _queue(_counted(make_session, fake_result), closed=True)

    assert resp.total == 40          # what the Closed tab pages through
    assert resp.closed_total == 40
    assert resp.pending_total == 60  # the OTHER tab's badge, still correct


def test_closed_false_totals_the_pending_bucket(make_session, fake_result):
    resp = _queue(_counted(make_session, fake_result), closed=False)

    assert resp.total == 60
    assert resp.pending_total == 60
    assert resp.closed_total == 40   # the OTHER tab's badge, still correct


def test_unfiltered_totals_the_whole_queue(make_session, fake_result):
    # No `closed` at all is the pre-existing contract, and every caller that
    # never learns about the parameter has to keep seeing the full queue.
    resp = _queue(_counted(make_session, fake_result))

    assert resp.total == 100
    assert resp.pending_total == 60
    assert resp.closed_total == 40


def _page_sql(session) -> str:
    """The second statement: the combined count runs first, then the page."""
    return session.executed[1]


def test_both_buckets_are_counted_in_a_single_query(make_session, fake_result):
    # Two separate count_rows calls meant two scans of the joined queue per
    # request. COUNT(*) FILTER gets both buckets in one pass, so a paginated
    # read costs the same one count it did before the split was added.
    session = _counted(make_session, fake_result)
    _queue(session, closed=True)

    assert len(session.executed) == 2   # the count, then the page


# The base predicate (financial_closure_status != 'pending') binds ..._1, so the
# bucket predicate is the second binding. Matching on the param rather than
# counting the column name, which also appears in the SELECT list.
_BUCKET = ":financial_closure_status_2"


def test_the_closed_bucket_predicate_reaches_the_page_query(make_session, fake_result):
    # Filtered in SQL, not over the rows after they come back — that is the whole
    # point, since the page is a window onto an ordering unrelated to the bucket.
    session = _counted(make_session, fake_result)
    _queue(session, closed=True)

    assert f"financial_closure_status = {_BUCKET}" in _page_sql(session)


def test_the_pending_bucket_predicate_reaches_the_page_query(make_session, fake_result):
    session = _counted(make_session, fake_result)
    _queue(session, closed=False)

    assert f"financial_closure_status != {_BUCKET}" in _page_sql(session)


def test_an_unfiltered_page_carries_no_extra_predicate(make_session, fake_result):
    session = _counted(make_session, fake_result)
    _queue(session)

    assert _BUCKET not in _page_sql(session)


def test_the_page_is_still_ordered_newest_launched_first(make_session, fake_result):
    # Bucketing must not disturb the ordering the surfaces rely on.
    session = _counted(make_session, fake_result)
    _queue(session, closed=False)

    assert "launched_at DESC" in _page_sql(session)


def test_an_executive_scoped_to_nothing_short_circuits(make_session, fake_result):
    # Pre-existing behaviour: an executive delegated to no site issues no query
    # at all. Kept explicit because the counts now run before the page query and
    # would otherwise be the first thing to fire.
    session = make_session()

    resp = _queue(session, restrict_to_site_ids=[])

    assert resp.items == []
    assert resp.total == 0
    assert session.executed == []

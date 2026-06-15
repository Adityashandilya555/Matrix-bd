"""Business-admin 'remove user' = deactivate (revoke access), not delete.

Deactivating flips users.is_active=false, which the per-request recheck (#103)
treats as an immediate kill switch. Removal is idempotent so a double-click
can't error or re-fire.
"""
from __future__ import annotations

import uuid

TENANT_ID = str(uuid.uuid4())
USER_ID = str(uuid.uuid4())
ACTOR = {"sub": str(uuid.uuid4()), "name": "Biz Admin"}


async def test_deactivate_org_user_sets_inactive(make_session, fake_result):
    from app.services.business_admin_service import deactivate_org_user

    sess = make_session(fake_result(mappings_rows=[{"is_active": True}]))
    await deactivate_org_user(sess, TENANT_ID, USER_ID, ACTOR)

    assert any("UPDATE users" in s and "is_active = false" in s for s in sess.executed)


async def test_deactivate_org_user_idempotent_when_already_inactive(make_session, fake_result):
    from app.services.business_admin_service import deactivate_org_user

    sess = make_session(fake_result(mappings_rows=[{"is_active": False}]))
    await deactivate_org_user(sess, TENANT_ID, USER_ID, ACTOR)

    # Already inactive → no write.
    assert not any("UPDATE users" in s for s in sess.executed)


async def test_deactivate_org_user_noop_when_unknown(make_session, fake_result):
    from app.services.business_admin_service import deactivate_org_user

    sess = make_session(fake_result(mappings_rows=[]))  # no such user in tenant
    await deactivate_org_user(sess, TENANT_ID, USER_ID, ACTOR)

    assert not any("UPDATE users" in s for s in sess.executed)

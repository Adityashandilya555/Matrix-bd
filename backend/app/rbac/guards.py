"""Role and scope guards for FastAPI routes."""
from typing import Callable
from fastapi import Depends, HTTPException, status
from app.core.deps import get_current_user
from app.rbac.roles import READ_ALL_ROLES, Role


def require_role(*roles: Role) -> Callable:
    """Dependency factory: raises 403 if the current user's role is not in *roles*.

    Usage::

        @router.post("/bd/drafts")
        async def create_draft(
            _: Annotated[None, Depends(require_role(Role.EXECUTIVE))],
            ...
        ):
            ...
    """
    async def guard(current_user: dict = Depends(get_current_user)) -> dict:
        user_role = current_user.get("role")
        # READ_ALL_ROLES (business_admin, observer) see the whole workspace and
        # satisfy every route guard. For observer this is what makes the role
        # usable at all — 85 GET routes carry a role or module dependency, so
        # without the bypass it could read almost nothing. It is safe only
        # because get_current_user refuses every non-GET request from an
        # observer; the two must be read together.
        if user_role not in [r.value for r in roles] and user_role not in READ_ALL_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user_role}' not allowed. Required: {[r.value for r in roles]}",
            )
        return current_user

    return guard


def require_module(module_name: str) -> Callable:
    """Dependency factory: raises 403 if the caller's JWT module claim does not
    match *module_name*.

    The `module` claim is written into app_metadata at login time from
    user_module_memberships.module and surfaced by decode_token / /auth/whoami.

    Usage::

        LegalUser = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
        LegalModule = Annotated[dict, Depends(require_module('legal'))]

        @router.get('/legal/queue')
        async def queue(user: LegalUser, _module: LegalModule):
            ...
    """
    async def guard(current_user: dict = Depends(get_current_user)) -> dict:
        user_role = current_user.get("role")
        user_module = current_user.get("module")
        # Same workspace-wide bypass as require_role — neither role holds a
        # module membership, so a module comparison is meaningless for them.
        if user_module != module_name and user_role not in READ_ALL_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Module '{user_module}' not allowed on this route. Required: '{module_name}'",
            )
        return current_user

    return guard

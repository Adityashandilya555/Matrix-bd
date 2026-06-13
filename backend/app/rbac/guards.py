"""Role and scope guards for FastAPI routes."""
from typing import Callable
from fastapi import Depends, HTTPException, status
from app.core.deps import get_current_user
from app.rbac.roles import Role


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
        if user_role not in [r.value for r in roles]:
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
        user_module = current_user.get("module")
        if user_module != module_name:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Module '{user_module}' not allowed on this route. Required: '{module_name}'",
            )
        return current_user

    return guard


def require_scope(kind: str) -> Callable:
    """Dependency factory: validates scope access."""
    raise NotImplementedError(
        f"require_scope('{kind}') is not implemented — "
        "do not use in production endpoints until JWT scope claims are wired"
    )

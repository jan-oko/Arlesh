"""The routes, one module per kind of node. Each route is one binding call."""

from __future__ import annotations

from fastapi import APIRouter

from arlesh_api.errors import ERROR_RESPONSES


def make_router(prefix: str, tag: str) -> APIRouter:
    """A router whose routes all declare the error responses."""
    return APIRouter(prefix=prefix, tags=[tag], responses=ERROR_RESPONSES)

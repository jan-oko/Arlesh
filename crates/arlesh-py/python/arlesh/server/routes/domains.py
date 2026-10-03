"""Aspects, Domains, Projects and Tags: the ``domains`` table."""

from __future__ import annotations

from arlesh.models import CreateDomainRequest, Domain, DomainSubtype, UpdateDomainRequest

from arlesh_api.dependencies import Reader, Writer
from arlesh_api.routes import make_router

router = make_router("/domains", "domains")


@router.get("")
async def list_domains(db: Reader, subtype: DomainSubtype | None = None) -> list[Domain]:
    """Every Aspect, Domain, Project and Tag, or those of one subtype."""
    return await db.list_domains(subtype)


@router.get("/{id}")
async def get_domain(db: Reader, id: int) -> Domain:
    """One Aspect, Domain, Project or Tag."""
    return await db.get_domain(id)


@router.post("", status_code=201)
async def create_domain(db: Writer, request: CreateDomainRequest) -> Domain:
    """Creates a Domain, Project or Tag."""
    return await db.create_domain(request)


@router.patch("/{id}")
async def update_domain(db: Writer, id: int, request: UpdateDomainRequest) -> Domain:
    """Updates a Domain, Project or Tag; naming a parent moves it."""
    return await db.update_domain(id, request)


@router.delete("/{id}", status_code=204)
async def delete_domain(db: Writer, id: int) -> None:
    """Deletes a Domain, Project or Tag."""
    await db.delete_domain(id)


@router.post("/{id}/duplicate", status_code=201)
async def duplicate_domain(db: Writer, id: int, target_id: int, position: int) -> Domain:
    """Copies a Domain or Project and its subtree under a new parent."""
    return await db.duplicate_domain(id, target_id, position)

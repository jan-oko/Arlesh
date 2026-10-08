"""Aspects, Domains, Projects and Tags: the ``domains`` table."""

from __future__ import annotations

from arlesh.models import (
    CreateDomainRequest,
    Domain,
    DomainSubtype,
    DuplicatedDomain,
    UpdateDomainRequest,
)
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class DomainsRouter(BoardRouter):
    """``/domains``."""

    def _register_routes(self) -> None:
        self.get("")(self._list)
        self.get("/{id}")(self._get)
        self.post("", status_code=201)(self._create)
        self.patch("/{id}")(self._update)
        self.delete("/{id}", status_code=204)(self._delete)
        self.post("/{id}/duplicate", status_code=201)(self._duplicate)

    async def _list(self, subtype: DomainSubtype | None = None) -> list[Domain]:
        """Every Aspect, Domain, Project and Tag, or those of one subtype."""
        return await self._reader.list_domains(subtype)

    async def _get(self, id: int) -> Domain:
        """One Aspect, Domain, Project or Tag."""
        return await self._reader.get_domain(id)

    async def _create(self, request: CreateDomainRequest) -> Domain:
        """Creates a Domain, Project or Tag."""
        return await (await self._writer()).create_domain(request)

    async def _update(self, id: int, request: UpdateDomainRequest) -> Domain:
        """Updates a Domain, Project or Tag; naming a parent moves it."""
        return await (await self._writer()).update_domain(id, request)

    async def _delete(self, id: int) -> None:
        """Deletes a Domain, Project or Tag."""
        await (await self._writer()).delete_domain(id)

    async def _duplicate(self, id: int, target_id: int, position: int) -> DuplicatedDomain:
        """Copies a Domain or Project and its subtree under a new parent."""
        return await (await self._writer()).duplicate_domain(id, target_id, position)

"""Infos: one Info and its writes."""

from __future__ import annotations

from arlesh.models import CreateInfoRequest, Info, UpdateInfoRequest
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class InfosRouter(BoardRouter):
    """``/infos``."""

    def _register_routes(self) -> None:
        self.get("/{id}")(self._get)
        self.post("", status_code=201)(self._create)
        self.patch("/{id}")(self._update)
        self.delete("/{id}", status_code=204)(self._delete)
        self.post("/{id}/duplicate", status_code=201)(self._duplicate)

    async def _get(self, id: int) -> Info:
        """One Info."""
        return await self._reader.get_info(id)

    async def _create(self, request: CreateInfoRequest) -> Info:
        """Creates an Info."""
        return await (await self._writer()).create_info(request)

    async def _update(self, id: int, request: UpdateInfoRequest) -> Info:
        """Updates an Info; naming a parent moves it."""
        return await (await self._writer()).update_info(id, request)

    async def _delete(self, id: int) -> None:
        """Deletes an Info."""
        await (await self._writer()).delete_info(id)

    async def _duplicate(self, id: int, target_type: str, target_id: int, position: int) -> Info:
        """Copies an Info and its subtree under a new parent."""
        return await (await self._writer()).duplicate_info(id, target_type, target_id, position)

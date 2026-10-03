"""Every ``WireError`` kind arrives as its own exception, with the kind intact."""

from __future__ import annotations

import fcntl
import json
from pathlib import Path

import arlesh
import pytest
from arlesh import _native
from arlesh.errors import ArleshError, from_native
from arlesh.models import (
    CreateCommitmentRequest,
    CreateGoalRequest,
    CreateTaskRequest,
    DependencyTask,
    ScopeKeyWeek,
    TaskArchival,
    TimeScope,
    UpdateTaskRequest,
    WireErrorKind,
)

EXCEPTIONS = {
    "not_found": arlesh.NotFound,
    "containment_violated": arlesh.ContainmentViolated,
    "invalid_request": arlesh.InvalidRequest,
    "needs_confirmation": arlesh.NeedsConfirmation,
    "needs_time_scope": arlesh.NeedsTimeScope,
    "not_permitted": arlesh.NotPermitted,
    "ambiguous_id": arlesh.AmbiguousId,
    "status_changed": arlesh.StatusChanged,
    "database": arlesh.DatabaseError,
    "internal": arlesh.InternalError,
}


def week(day: str) -> TimeScope:
    key = ScopeKeyWeek(kind="week", date=day)
    return TimeScope(start_id=key, end_id=key)


def test_every_kind_the_core_has_has_an_exception() -> None:
    assert {kind.value for kind in WireErrorKind} == set(EXCEPTIONS)


@pytest.mark.parametrize(("kind", "exception"), EXCEPTIONS.items())
def test_a_native_failure_becomes_the_exception_for_its_kind(
    kind: str, exception: type[ArleshError]
) -> None:
    native = _native.NativeError(json.dumps({"kind": kind, "message": "why", "details": {"x": 1}}))
    error = from_native(native)
    assert type(error) is exception
    assert (error.kind, error.message, error.details) == (kind, "why", {"x": 1})
    assert isinstance(error, ArleshError)


def test_a_kind_this_package_does_not_know_keeps_its_kind() -> None:
    error = from_native(_native.NativeError(json.dumps({"kind": "brand_new", "message": "m"})))
    assert type(error) is ArleshError
    assert error.kind == "brand_new"
    assert error.details is None


async def test_a_missing_node_is_not_found(db: arlesh.Database) -> None:
    with pytest.raises(arlesh.NotFound) as raised:
        await db.get_goal(424242)
    assert raised.value.kind == "not_found"


async def test_a_child_window_outside_its_parent_is_a_containment_violation(
    db: arlesh.Database, domain_id: int
) -> None:
    goal = await db.create_goal(
        CreateGoalRequest(
            title="This week",
            parent_type="domain",
            parent_id=domain_id,
            time_scope=week("2026-09-20"),
        )
    )
    with pytest.raises(arlesh.ContainmentViolated) as raised:
        await db.create_task(
            CreateTaskRequest(
                title="Next week",
                parent_type="goal",
                parent_id=goal.id,
                time_scope=week("2026-09-27"),
            )
        )
    assert raised.value.kind == "containment_violated"


async def test_a_dependency_cycle_is_an_invalid_request(
    db: arlesh.Database, domain_id: int
) -> None:
    first = await db.create_task(
        CreateTaskRequest(title="First", parent_type="domain", parent_id=domain_id)
    )
    second = await db.create_task(
        CreateTaskRequest(title="Second", parent_type="domain", parent_id=domain_id)
    )
    await db.add_task_dependency(second.id, DependencyTask(type="task", id=first.id))
    with pytest.raises(arlesh.InvalidRequest):
        await db.add_task_dependency(first.id, DependencyTask(type="task", id=second.id))


async def test_backlogging_a_planned_task_needs_confirmation(
    db: arlesh.Database, domain_id: int
) -> None:
    task = await db.create_task(
        CreateTaskRequest(
            title="Planned",
            parent_type="domain",
            parent_id=domain_id,
            time_scope=week("2026-09-20"),
            plan=week("2026-09-20"),
        )
    )
    with pytest.raises(arlesh.NeedsConfirmation) as raised:
        await db.update_task(task.id, UpdateTaskRequest(archival=TaskArchival.backlog))
    assert raised.value.kind == "needs_confirmation"


async def test_a_commitment_with_no_window_needs_a_time_scope(
    db: arlesh.Database, domain_id: int
) -> None:
    with pytest.raises(arlesh.NeedsTimeScope) as raised:
        await db.create_commitment(
            CreateCommitmentRequest(title="Unbounded", parent_type="domain", parent_id=domain_id)
        )
    assert raised.value.kind == "needs_time_scope"


async def test_a_write_open_on_a_held_database_is_not_permitted(
    db: arlesh.Database, database_path: Path
) -> None:
    with database_path.with_name(database_path.name + ".lock").open("w") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        with pytest.raises(arlesh.NotPermitted) as raised:
            await arlesh.open(database_path, client="other")
    assert raised.value.kind == "not_permitted"

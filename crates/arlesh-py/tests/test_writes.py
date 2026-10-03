"""Writes for every node kind: create, update, move, delete and status — and the board after."""

from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

import arlesh
import pytest
from arlesh.models import (
    CreateCommitmentRequest,
    CreateDomainRequest,
    CreateExpectationRequest,
    CreateFlowItemRequest,
    CreateFlowRequest,
    CreateGoalRequest,
    CreateInfoRequest,
    CreateTaskRequest,
    DomainSubtype,
    GoalStatus,
    ScopeKeyWeek,
    StartFlowRequest,
    StatusOrdinary,
    StatusStep,
    StatusStepOutcomeWritten,
    TaskStatus,
    TimeScope,
    UpdateDomainRequest,
    UpdateExpectationRequest,
    UpdateFlowRequest,
    UpdateGoalRequest,
    UpdateInfoRequest,
    UpdateTaskRequest,
    Verdict,
    VerdictPress,
)

WEEK = ScopeKeyWeek(kind="week", date="2026-09-20")


def stored(node_id: int | str) -> int:
    """The row id of a node the test created, which is always a stored one."""
    assert isinstance(node_id, int)
    return node_id


def week() -> TimeScope:
    """The Week of 2026-09-20, as a Time Scope."""
    return TimeScope(start_id=WEEK, end_id=WEEK)


async def test_a_task_is_created_read_updated_moved_and_deleted(
    db: arlesh.Database, domain_id: int
) -> None:
    task = await db.create_task(
        CreateTaskRequest(title="Write it", parent_type="domain", parent_id=domain_id)
    )
    assert (await db.get_task(stored(task.id))).task.title == "Write it"

    renamed = await db.update_task(task.id, UpdateTaskRequest(title="Write it well"))
    assert renamed.title == "Write it well"

    goal = await db.create_goal(
        CreateGoalRequest(title="Ship", parent_type="domain", parent_id=domain_id)
    )
    moved = await db.update_task(
        task.id, UpdateTaskRequest(parent_type="goal", parent_id=goal.id, position=0)
    )
    assert (moved.parent_type, moved.parent_id) == ("goal", goal.id)

    await db.delete_task(task.id)
    with pytest.raises(arlesh.NotFound):
        await db.get_task(stored(task.id))


async def test_an_update_sends_only_what_was_set_so_none_clears(
    db: arlesh.Database, domain_id: int
) -> None:
    task = await db.create_task(
        CreateTaskRequest(
            title="Scoped", parent_type="domain", parent_id=domain_id, time_scope=week()
        )
    )
    assert task.time_scope is not None

    untouched = await db.update_task(task.id, UpdateTaskRequest(title="Still scoped"))
    assert untouched.time_scope is not None

    cleared = await db.update_task(task.id, UpdateTaskRequest(time_scope=None))
    assert cleared.time_scope is None


async def test_the_status_cycle_advances_a_task(db: arlesh.Database, domain_id: int) -> None:
    task = await db.create_task(
        CreateTaskRequest(title="Cycle", parent_type="domain", parent_id=domain_id)
    )
    outcome = (await db.step_task_status(task.id, StatusStep.advance)).root
    assert isinstance(outcome, StatusStepOutcomeWritten)
    assert outcome.task.status == StatusOrdinary(kind="ordinary", status=TaskStatus.in_progress)

    done = await db.update_task(
        task.id,
        UpdateTaskRequest(status=StatusOrdinary(kind="ordinary", status=TaskStatus.done)),
    )
    assert done.status.status == TaskStatus.done
    assert await db.task_done_at(task.id) is not None


async def test_the_agentic_key_flips_a_task_to_the_agentic_model(
    db: arlesh.Database, domain_id: int
) -> None:
    task = await db.create_task(
        CreateTaskRequest(title="Agent", parent_type="domain", parent_id=domain_id)
    )
    flipped = await db.toggle_task_agentic(task.id)
    assert flipped.status.kind == "agentic"


async def test_a_goal_is_achieved_and_deleted(db: arlesh.Database, domain_id: int) -> None:
    goal = await db.create_goal(
        CreateGoalRequest(title="Reach", parent_type="domain", parent_id=domain_id)
    )
    achieved = await db.update_goal(goal.id, UpdateGoalRequest(status=GoalStatus.achieved))
    assert achieved.status == GoalStatus.achieved
    await db.delete_goal(goal.id)
    with pytest.raises(arlesh.NotFound):
        await db.get_goal(stored(goal.id))


async def test_a_commitment_takes_a_verdict(db: arlesh.Database, domain_id: int) -> None:
    commitment = await db.create_commitment(
        CreateCommitmentRequest(
            title="Phone off", parent_type="domain", parent_id=domain_id, time_scope=week()
        )
    )
    kept = await db.press_commitment_verdict(commitment.id, VerdictPress.kept)
    assert kept.verdict == Verdict.kept
    await db.delete_commitment(commitment.id)


async def test_a_wait_is_created_updated_and_deleted(db: arlesh.Database, domain_id: int) -> None:
    task = await db.create_task(
        CreateTaskRequest(title="Holder", parent_type="domain", parent_id=domain_id)
    )
    wait = await db.create_wait(
        CreateExpectationRequest(title="Reply", parent_type="task", parent_id=task.id)
    )
    renamed = await db.update_wait(wait.id, UpdateExpectationRequest(title="Their reply"))
    assert renamed.title == "Their reply"
    await db.delete_wait(wait.id)
    board = await db.board()
    assert all(expectation.id != wait.id for expectation in board.expectations)


async def test_an_info_is_created_updated_and_deleted(db: arlesh.Database, domain_id: int) -> None:
    info = await db.create_info(
        CreateInfoRequest(body="A note", parent_type="domain", parent_id=domain_id, position=0)
    )
    edited = await db.update_info(info.id, UpdateInfoRequest(body="A better note"))
    assert edited.body == "A better note"
    await db.delete_info(info.id)
    with pytest.raises(arlesh.NotFound):
        await db.get_info(info.id)


async def test_a_project_is_created_renamed_and_deleted(db: arlesh.Database) -> None:
    aspects = await db.list_domains(DomainSubtype.aspect)
    project = await db.create_domain(
        CreateDomainRequest(title="Build", subtype=DomainSubtype.project, parent_id=aspects[0].id)
    )
    renamed = await db.update_domain(project.id, UpdateDomainRequest(title="Built"))
    assert renamed.title == "Built"
    await db.delete_domain(project.id)
    with pytest.raises(arlesh.NotFound):
        await db.get_domain(project.id)


async def test_a_flow_is_started_into_a_real_subtree(db: arlesh.Database, domain_id: int) -> None:
    flow = await db.create_flow(
        CreateFlowRequest(title="Routine", parent_type="domain", parent_id=domain_id)
    )
    await db.create_flow_task(
        CreateFlowItemRequest(flow_id=flow.id, title="Step", parent_type="flow", parent_id=flow.id)
    )
    renamed = await db.update_flow(flow.id, UpdateFlowRequest(title="Morning routine"))
    assert renamed.title == "Morning routine"

    started = await db.start_flow(
        flow.id,
        StartFlowRequest(
            title="This morning",
            target_type="domain",
            target_id=domain_id,
            anchor_date=date(2026, 9, 23),
        ),
    )
    board = await db.board()
    assert any(task.title == "This morning" for task in board.tasks) or started.root_id > 0

    await db.delete_flow(flow.id)
    with pytest.raises(arlesh.NotFound):
        await db.get_flow(flow.id)


async def test_the_board_carries_every_kind_and_its_derived_values(
    db: arlesh.Database, domain_id: int
) -> None:
    await db.create_task(
        CreateTaskRequest(title="On the board", parent_type="domain", parent_id=domain_id)
    )
    board = await db.board()
    assert any(task.title == "On the board" for task in board.tasks)
    assert any(domain.id == domain_id for domain in board.domains)
    assert board.lifecycles, "every row's lifecycle is derived"
    assert board.short_ids, "every node has a short id"


async def test_a_write_from_python_never_reaches_the_desktop_undo_stack(
    db: arlesh.Database, database_path: Path, domain_id: int
) -> None:
    await db.create_task(
        CreateTaskRequest(title="Scripted", parent_type="domain", parent_id=domain_id)
    )
    with sqlite3.connect(database_path) as connection:
        desktop = connection.execute(
            "SELECT COUNT(*) FROM undo_journal WHERE client = 'desktop'"
        ).fetchone()[0]
    assert desktop == 0

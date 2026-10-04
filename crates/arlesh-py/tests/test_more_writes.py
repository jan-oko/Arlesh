"""The rest of the writes: copies, tags, block reasons, wait checks, Flow items and Habits."""

from __future__ import annotations

from datetime import datetime

import arlesh
import pytest
from arlesh.models import (
    ClockKind,
    CommitmentArchival,
    CreateCommitmentRequest,
    CreateDomainRequest,
    CreateExpectationRequest,
    CreateFlowItemRequest,
    CreateFlowRequest,
    CreateGoalRequest,
    CreateInfoRequest,
    CreateTaskRequest,
    DependencyTask,
    DescendantPlans,
    DomainSubtype,
    DurationSpec,
    FlowItemType,
    ScopeKeyDay,
    ScopeKeyWeek,
    SetRecurrenceRequest,
    StatusOrdinary,
    TaskArchival,
    TaskStatus,
    TimeScope,
    UpdateFlowItemRequest,
    UpdateTaskRequest,
)


def stored(node_id: int | str) -> int:
    """The row id of a node the test created, which is always a stored one."""
    assert isinstance(node_id, int)
    return node_id


async def test_copies_land_under_their_new_parent(db: arlesh.Database, domain_id: int) -> None:
    goal = await db.create_goal(
        CreateGoalRequest(title="Target", parent_type="domain", parent_id=domain_id)
    )
    task = await db.create_task(
        CreateTaskRequest(title="Copy me", parent_type="domain", parent_id=domain_id)
    )
    info = await db.create_info(
        CreateInfoRequest(body="Note", parent_type="domain", parent_id=domain_id, position=0)
    )
    task_copy = await db.duplicate_task(stored(task.id), "goal", stored(goal.id), 0)
    goal_copy = await db.duplicate_goal(stored(goal.id), "domain", domain_id, 0)
    info_copy = await db.duplicate_info(info.id, "goal", stored(goal.id), 0)
    domain_copy = await db.duplicate_domain(
        domain_id, (await db.get_domain(domain_id)).parent_id or 1, 0
    )
    assert (task_copy.copy_.title, task_copy.copy_.parent_id) == ("Copy me", goal.id)
    assert goal_copy.copy_.title == "Target"
    assert info_copy.copy_.body == "Note"
    assert domain_copy.copy_.title == "Tests"
    assert task_copy.left_behind == []


async def test_tags_block_reasons_and_dependencies_are_written(
    db: arlesh.Database, domain_id: int
) -> None:
    aspects = await db.list_domains(DomainSubtype.aspect)
    tag = await db.create_domain(
        CreateDomainRequest(title="urgent", subtype=DomainSubtype.tag, parent_id=aspects[0].id)
    )
    first = await db.create_task(
        CreateTaskRequest(title="First", parent_type="domain", parent_id=domain_id)
    )
    second = await db.create_task(
        CreateTaskRequest(title="Second", parent_type="domain", parent_id=domain_id)
    )
    await db.set_tag("task", first.id, tag.id, True)
    assert tag.id in (await db.get_task(stored(first.id))).task.tag_ids
    await db.set_tag("task", first.id, tag.id, False)

    await db.set_block_reasons("task", first.id, ["Waiting for the landlord"])
    assert (await db.get_task(stored(first.id))).block_reasons

    dependency = DependencyTask(type="task", id=first.id)
    await db.add_task_dependency(second.id, dependency)
    assert len(await db.task_dependencies(second.id)) == 1
    await db.remove_task_dependency(second.id, dependency)
    assert await db.task_dependencies(second.id) == []

    await db.update_task(
        first.id, UpdateTaskRequest(status=StatusOrdinary(kind="ordinary", status=TaskStatus.done))
    )
    await db.set_task_done_at(first.id, datetime(2026, 9, 1, 9, 0))
    assert await db.task_done_at(first.id) == datetime(2026, 9, 1, 9, 0)


async def test_a_checked_wait_is_completed_and_reopened(
    db: arlesh.Database, domain_id: int
) -> None:
    task = await db.create_task(
        CreateTaskRequest(title="Holder", parent_type="domain", parent_id=domain_id)
    )
    wait = await db.create_wait(
        CreateExpectationRequest(
            title="Check the post",
            parent_type="task",
            parent_id=task.id,
            check_every=DurationSpec(n=1, kind="day"),
            check_starting=datetime(2026, 9, 1, 9, 0),
        )
    )
    checked = await db.complete_wait_check(stored(wait.id))
    reopened = await db.reopen_wait_check(stored(wait.id), datetime(2026, 9, 1, 9, 0))
    assert checked.id == reopened.id == wait.id


async def test_a_flow_with_items_becomes_a_habit_and_back(
    db: arlesh.Database, domain_id: int
) -> None:
    flow = await db.create_flow(
        CreateFlowRequest(title="Weekly", parent_type="domain", parent_id=domain_id)
    )
    first = await db.create_flow_task(
        CreateFlowItemRequest(flow_id=flow.id, title="One", parent_type="flow", parent_id=flow.id)
    )
    second = await db.create_flow_task(
        CreateFlowItemRequest(flow_id=flow.id, title="Two", parent_type="flow", parent_id=flow.id)
    )
    goal = await db.create_flow_goal(
        CreateFlowItemRequest(flow_id=flow.id, title="Aim", parent_type="flow", parent_id=flow.id)
    )
    assert (await db.update_flow_task(first.id, UpdateFlowItemRequest(title="Uno"))).title == "Uno"
    assert (await db.update_flow_goal(goal.id, UpdateFlowItemRequest(title="Aim high"))).title == (
        "Aim high"
    )
    await db.add_flow_dependency(
        flow.id, FlowItemType.flow_task, second.id, FlowItemType.flow_task, first.id
    )
    await db.remove_flow_dependency(
        FlowItemType.flow_task, second.id, FlowItemType.flow_task, first.id
    )
    assert await db.set_flow_item_cycles(flow.id, FlowItemType.flow_task, first.id, []) is None
    copy_id = await db.duplicate_flow_item(FlowItemType.flow_task, first.id, "flow", flow.id, 0)
    await db.delete_flow_item(FlowItemType.flow_task, copy_id)

    week = ScopeKeyWeek(kind="week", date="2026-09-20")
    recurrence = await db.set_flow_recurrence(
        flow.id,
        SetRecurrenceRequest(clock=ClockKind.interval, start_scope_id=week),
    )
    assert recurrence.flow_id == flow.id
    await db.clear_habit_modifications(flow.id)
    forked = await db.fork_flow(flow.id, now=datetime(2026, 9, 23, 12, 0))
    assert forked.id != flow.id
    await db.delete_flow_recurrence(forked.id)

    copy = await db.duplicate_flow(forked.id, "domain", domain_id, 0)
    assert copy.title == forked.title


async def test_a_subtree_becomes_a_flow(db: arlesh.Database, domain_id: int) -> None:
    goal = await db.create_goal(
        CreateGoalRequest(title="Template me", parent_type="domain", parent_id=domain_id)
    )
    await db.create_task(CreateTaskRequest(title="Step", parent_type="goal", parent_id=goal.id))
    flow = await db.convert_to_flow(
        "goal", stored(goal.id), keep_dependencies=True, map_scopes=False
    )
    assert flow.title == "Template me"


async def test_a_derived_wait_cannot_be_deleted(db: arlesh.Database) -> None:
    with pytest.raises(arlesh.ArleshError):
        await db.delete_wait("00000000-0000-5000-8000-000000000000")


async def test_a_task_and_a_commitment_are_archived_by_hand_and_put_back(
    db: arlesh.Database, domain_id: int
) -> None:
    task = await db.create_task(
        CreateTaskRequest(title="Put away", parent_type="domain", parent_id=domain_id)
    )
    archived = await db.set_task_archived(task.id, True)
    assert archived.archival == TaskArchival.archived
    assert (await db.set_task_archived(task.id, False)).archival == TaskArchival.live

    week = ScopeKeyWeek(kind="week", date="2026-09-20")
    commitment = await db.create_commitment(
        CreateCommitmentRequest(
            title="Rule",
            parent_type="domain",
            parent_id=domain_id,
            time_scope=TimeScope(start_id=week, end_id=week),
        )
    )
    put_away = await db.set_commitment_archived(commitment.id, True)
    assert put_away.archival == CommitmentArchival.archived
    assert (await db.set_commitment_archived(commitment.id, False)).archival == (
        CommitmentArchival.live
    )


async def test_a_narrowed_plan_asks_about_the_plans_below_then_clamps_them(
    db: arlesh.Database, domain_id: int
) -> None:
    def days(first: str, last: str) -> TimeScope:
        return TimeScope(
            start_id=ScopeKeyDay(kind="day", date=first),
            end_id=ScopeKeyDay(kind="day", date=last),
        )

    parent = await db.create_task(
        CreateTaskRequest(
            title="Week",
            parent_type="domain",
            parent_id=domain_id,
            plan=days("2026-09-20", "2026-09-26"),
        )
    )
    child = await db.create_task(
        CreateTaskRequest(
            title="Friday",
            parent_type="task",
            parent_id=parent.id,
            plan=days("2026-09-25", "2026-09-25"),
        )
    )
    narrower = days("2026-09-21", "2026-09-22")
    conflicts = await db.plan_containment_conflicts(parent.id, narrower)
    assert [target.id for target in conflicts] == [child.id]

    with pytest.raises(arlesh.ArleshError):
        await db.update_task(parent.id, UpdateTaskRequest(plan=narrower))
    await db.update_task(
        parent.id, UpdateTaskRequest(plan=narrower), descendant_plans=DescendantPlans.clear
    )
    assert (await db.get_task(stored(child.id))).task.plan is None

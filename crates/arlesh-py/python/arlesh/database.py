"""An open Arlesh database, and every operation on it: the :class:`Database` port and its
implementation, :class:`SqliteDatabase`.

Every method is a coroutine: ``await db.board()``. Each runs one operation of the core in one
transaction — the same operation the desktop app's command runs — so atomicity, the rules a write
enforces and the refusals it raises are the app's own.

Requests and answers are the pydantic models in :mod:`arlesh.models`, generated from the Rust
types. An update request distinguishes a field left out (unchanged) from a field set to ``None``
(cleared), exactly as the core does: only the fields you set are sent.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from datetime import date, datetime
from types import TracebackType
from typing import Any, Self, TypeVar

from pydantic import BaseModel, TypeAdapter
from pydantic_core import to_json

from arlesh import _native
from arlesh.errors import from_native
from arlesh.models import (
    BlockReason,
    CapacityState,
    Commitment,
    CommitmentArchival,
    CreateCommitmentRequest,
    CreateDomainRequest,
    CreateExpectationRequest,
    CreateFlowItemRequest,
    CreateFlowRequest,
    CreateGoalRequest,
    CreateInfoRequest,
    CreateTaskRequest,
    Dependency,
    DependencyExpectation,
    DependencyGoal,
    DependencyTask,
    DescendantPlans,
    Domain,
    DomainSubtype,
    DuplicatedDomain,
    DuplicatedGoal,
    DuplicatedInfo,
    DuplicatedTask,
    EffectiveAccess,
    Expectation,
    Flow,
    FlowCommitment,
    FlowCycleInput,
    FlowDependency,
    FlowExpectation,
    FlowGoal,
    FlowItemCycle,
    FlowItemType,
    FlowOrigin,
    FlowRecurrence,
    FlowTask,
    ForkedTemplate,
    GestureName,
    GestureNode,
    GestureSummary,
    Goal,
    Info,
    ItemLifecycle,
    MaterializedFlow,
    McpAccessCatalogue,
    MindmapLoad,
    NodeTable,
    PlanClampTarget,
    Reconcile,
    ReparentConflicts,
    SetRecurrenceRequest,
    SpawnedWait,
    StartFlowRequest,
    StatusStep,
    StatusStepOutcome,
    StepEntry,
    TargetRef,
    Task,
    TaskArchival,
    TaskDependencyEdge,
    TaskWithBlockers,
    TimeScope,
    UndoStatus,
    UpdateCommitmentRequest,
    UpdateDomainRequest,
    UpdateExpectationRequest,
    UpdateFlowItemRequest,
    UpdateFlowRequest,
    UpdateGoalRequest,
    UpdateInfoRequest,
    UpdateSpawnedWaitRequest,
    UpdateTaskRequest,
    VerdictPress,
    ViolatingDescendant,
)

NodeId = int | str
"""A node's id: a stored row's integer id, or a derived node's (a Habit occurrence's) UUID."""

AnyDependency = Dependency | DependencyTask | DependencyGoal | DependencyExpectation
"""What a Task can come after: a Task, a Goal or a wait — one variant, or the union model."""

T = TypeVar("T")

_NOTHING: TypeAdapter[None] = TypeAdapter(type(None))


def _wire(value: Any) -> Any:
    """``value`` as the JSON-ready shape the core reads.

    A model sends only the fields that were set, so an update's "leave it" and "clear it" stay
    apart.
    """
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", exclude_unset=True, by_alias=True)
    if isinstance(value, list):
        return [_wire(item) for item in value]
    return value


async def open(
    path: str | os.PathLike[str],
    *,
    client: str | None = None,
    force: bool = False,
) -> Database:
    """Opens the Arlesh database at ``path``.

    Without a ``client`` it opens **read-only**: always allowed, never migrates, and refused only
    when the schema is not the one this build reads. With a ``client`` — a name of letters,
    digits, ``.``, ``_`` and ``-``, recorded on every write in the undo journal — it opens **for
    writing**, migrating it if needed. A write-open is refused with :class:`NotPermitted` while
    the desktop app has the database open, unless ``force=True``.
    """
    try:
        native = await _native.open(path, client, force)
    except _native.NativeError as error:
        raise from_native(error) from None
    return SqliteDatabase(native)


class Database(ABC):
    """An open Arlesh database: the port every operation on the board goes through.

    :class:`SqliteDatabase` is its implementation, the one :func:`open` returns: the Rust core
    over the SQLite file. A program that builds on the operations — the HTTP server, a test
    with a fake — depends on this class and is handed an implementation. Use one as an async
    context manager, or ``await close()`` it.
    """

    @property
    @abstractmethod
    def client(self) -> str | None:
        """The client this database writes as, or ``None`` when it was opened read-only."""

    @abstractmethod
    async def close(self) -> None:
        """Stops the MCP endpoint if this database serves one, then closes every connection once
        calls still running have finished."""

    @abstractmethod
    async def serve_mcp(self, *, host: str = "127.0.0.1", port: int = 0) -> int:
        """Serves Arlesh's MCP endpoint (at ``/mcp``) over this database, and answers the port it
        bound — ``port=0`` picks a free one.

        For a server that puts its own authentication in front: it binds a **loopback** address
        only (anything else raises :class:`InvalidRequest`), and only a database opened for
        writing serves it, since an agent's writes are journaled under this database's client.
        It runs until :meth:`stop_mcp` or :meth:`close`.
        """

    @abstractmethod
    async def stop_mcp(self) -> None:
        """Stops serving the MCP endpoint. Does nothing when none is served."""

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.close()

    # ---- Reads --------------------------------------------------------------------------------

    @abstractmethod
    async def board(
        self, *, now: datetime | None = None, at_capacity: bool | None = None
    ) -> MindmapLoad:
        """The whole board as the app draws it: every node of every kind, with its derived
        lifecycle, short id and facts (blocks, inherited values, open question).

        ``now`` defaults to the local clock, ``at_capacity`` to the agent capacity lock beside the
        database.
        """

    @abstractmethod
    async def get_task(self, id: int) -> TaskWithBlockers:
        """One stored Task, with what blocks it."""

    @abstractmethod
    async def get_goal(self, id: int) -> Goal:
        """One stored Goal."""

    @abstractmethod
    async def get_commitment(self, id: int) -> Commitment:
        """One stored Commitment."""

    @abstractmethod
    async def get_domain(self, id: int) -> Domain:
        """One Aspect, Domain, Project or Tag."""

    @abstractmethod
    async def get_info(self, id: int) -> Info:
        """One Info."""

    @abstractmethod
    async def get_flow(self, id: int) -> Flow:
        """One Flow or Habit template."""

    @abstractmethod
    async def list_domains(self, subtype: DomainSubtype | None = None) -> list[Domain]:
        """Every Aspect, Domain, Project and Tag, or those of one subtype."""

    @abstractmethod
    async def task_dependencies(self, id: NodeId) -> list[Dependency]:
        """What a Task depends on."""

    @abstractmethod
    async def task_done_at(self, id: NodeId) -> datetime | None:
        """When a Task was done, or ``None`` if it is not."""

    # ---- Tasks --------------------------------------------------------------------------------

    @abstractmethod
    async def create_task(self, request: CreateTaskRequest) -> Task:
        """Creates a Task."""

    @abstractmethod
    async def update_task(
        self,
        id: NodeId,
        request: UpdateTaskRequest,
        *,
        confirmed: bool = False,
        descendant_plans: DescendantPlans | None = None,
    ) -> Task:
        """Updates a Task, stored or a Habit occurrence; naming a parent moves it.

        Completing an occurrence that holds unfinished children raises
        :class:`NeedsConfirmation` unless ``confirmed``. A new Plan that would leave a Task below
        outside the Plan it inherits is refused unless ``descendant_plans`` says what becomes of
        them — ``clamp`` into the new Plan, or ``clear`` to inherit it (see
        :meth:`plan_containment_conflicts`).
        """

    @abstractmethod
    async def plan_containment_conflicts(
        self, id: NodeId, plan: TimeScope | None
    ) -> list[PlanClampTarget]:
        """The Tasks below the Task ``id`` whose own Plan ``plan`` would leave outside the Plan
        they inherit, each with what clamping would give it. Nearest first."""

    @abstractmethod
    async def delete_task(self, id: NodeId) -> None:
        """Deletes a Task and its subtree."""

    @abstractmethod
    async def step_task_status(
        self, id: NodeId, step: StatusStep, *, confirmed: bool = False
    ) -> StatusStepOutcome:
        """One step of the status cycle (``cycle``), or ``Alt+Enter`` (``alt``)."""

    @abstractmethod
    async def toggle_task_agentic(self, id: NodeId) -> Task:
        """Flips a Task between Agentic and not."""

    @abstractmethod
    async def set_task_archived(self, id: NodeId, archived: bool) -> Task:
        """Archives a stored Task by hand, with everything beneath it, or puts it back in play.

        The same write as ``update_task`` with ``archival`` — one row; its subtree reads as
        archived through inheritance on every board load.
        """

    @abstractmethod
    async def add_task_dependency(self, task_id: NodeId, dependency: AnyDependency) -> None:
        """Makes a Task come after a Task, Goal or wait. A cycle is refused."""

    @abstractmethod
    async def remove_task_dependency(self, task_id: NodeId, dependency: AnyDependency) -> None:
        """Removes one of a Task's dependencies."""

    @abstractmethod
    async def set_task_done_at(self, id: NodeId, at: datetime) -> None:
        """Corrects when a done Task was done."""

    @abstractmethod
    async def duplicate_task(
        self, id: int, target_type: str, target_id: int, position: int
    ) -> DuplicatedTask:
        """Copies a Task and its subtree under a new parent.
        ``left_behind`` names the rows hung on Habit occurrences the copy could not carry.
        """

    # ---- Goals --------------------------------------------------------------------------------

    @abstractmethod
    async def create_goal(self, request: CreateGoalRequest) -> Goal:
        """Creates a Goal."""

    @abstractmethod
    async def update_goal(
        self, id: NodeId, request: UpdateGoalRequest, *, confirmed: bool = False
    ) -> Goal:
        """Updates a Goal; naming a parent moves it. Achieving one over unfinished children
        raises :class:`NeedsConfirmation` unless ``confirmed``."""

    @abstractmethod
    async def delete_goal(self, id: NodeId) -> None:
        """Deletes a Goal and its subtree."""

    @abstractmethod
    async def duplicate_goal(
        self, id: int, target_type: str, target_id: int, position: int
    ) -> DuplicatedGoal:
        """Copies a Goal and its subtree under a new parent.
        ``left_behind`` names the rows hung on Habit occurrences the copy could not carry.
        """

    # ---- Commitments --------------------------------------------------------------------------

    @abstractmethod
    async def create_commitment(self, request: CreateCommitmentRequest) -> Commitment:
        """Creates a Commitment. One with no window of its own or above it raises
        :class:`NeedsTimeScope`."""

    @abstractmethod
    async def update_commitment(self, id: NodeId, request: UpdateCommitmentRequest) -> Commitment:
        """Updates a Commitment; naming a parent moves it."""

    @abstractmethod
    async def delete_commitment(self, id: NodeId) -> None:
        """Deletes a Commitment."""

    @abstractmethod
    async def set_commitment_archived(self, id: NodeId, archived: bool) -> Commitment:
        """Archives a Commitment by hand, with everything beneath it, or puts it back in play."""

    @abstractmethod
    async def press_commitment_verdict(self, id: NodeId, press: VerdictPress) -> Commitment:
        """A press of a verdict control: the cycle, Kept or Broken."""

    # ---- Waits --------------------------------------------------------------------------------

    @abstractmethod
    async def create_wait(self, request: CreateExpectationRequest) -> Expectation:
        """Creates a wait."""

    @abstractmethod
    async def update_wait(self, id: NodeId, request: UpdateExpectationRequest) -> Expectation:
        """Updates a wait, stored or derived; naming a parent moves it."""

    @abstractmethod
    async def delete_wait(self, id: NodeId) -> None:
        """Deletes a stored wait. A derived one is refused: it goes with its Task."""

    @abstractmethod
    async def complete_wait_check(self, id: int) -> Expectation:
        """Marks a stored wait's check done."""

    @abstractmethod
    async def reopen_wait_check(self, id: int, due_at: datetime) -> Expectation:
        """Reopens a stored wait's check, due again at ``due_at``."""

    @abstractmethod
    async def update_spawned_wait(
        self, task_id: int, request: UpdateSpawnedWaitRequest
    ) -> SpawnedWait:
        """Updates the wait an Asynchronous Task spawned."""

    @abstractmethod
    async def complete_spawned_wait_check(self, task_id: int) -> None:
        """Marks a spawned wait's check done."""

    @abstractmethod
    async def reopen_spawned_wait_check(self, task_id: int, due_at: datetime) -> None:
        """Reopens a spawned wait's check, due again at ``due_at``."""

    # ---- Tags and block reasons ---------------------------------------------------------------

    @abstractmethod
    async def set_tag(self, kind: str, id: NodeId, tag_id: int, present: bool) -> None:
        """Puts a Tag on a ``task``, ``goal``, ``commitment`` or ``expectation`` — or, with
        ``present=False``, takes it off."""

    @abstractmethod
    async def set_block_reasons(
        self, owner_type: str, owner_id: NodeId, reasons: list[str]
    ) -> None:
        """Replaces a Task's or Goal's explicit block reasons."""

    # ---- Infos --------------------------------------------------------------------------------

    @abstractmethod
    async def create_info(self, request: CreateInfoRequest) -> Info:
        """Creates an Info."""

    @abstractmethod
    async def update_info(self, id: int, request: UpdateInfoRequest) -> Info:
        """Updates an Info; naming a parent moves it."""

    @abstractmethod
    async def delete_info(self, id: int) -> None:
        """Deletes an Info."""

    @abstractmethod
    async def duplicate_info(
        self, id: int, target_type: str, target_id: int, position: int
    ) -> DuplicatedInfo:
        """Copies an Info and its subtree under a new parent.
        ``left_behind`` names the rows hung on Habit occurrences the copy could not carry.
        """

    # ---- Domains and Projects -----------------------------------------------------------------

    @abstractmethod
    async def create_domain(self, request: CreateDomainRequest) -> Domain:
        """Creates a Domain, Project or Tag."""

    @abstractmethod
    async def update_domain(self, id: int, request: UpdateDomainRequest) -> Domain:
        """Updates a Domain, Project or Tag; naming a parent moves it."""

    @abstractmethod
    async def delete_domain(self, id: int) -> None:
        """Deletes a Domain, Project or Tag."""

    @abstractmethod
    async def duplicate_domain(self, id: int, target_id: int, position: int) -> DuplicatedDomain:
        """Copies a Domain or Project and its subtree under a new parent.
        ``left_behind`` names the rows hung on Habit occurrences the copy could not carry.
        """

    # ---- Flows and Habits ---------------------------------------------------------------------

    @abstractmethod
    async def create_flow(self, request: CreateFlowRequest) -> Flow:
        """Creates a Flow."""

    @abstractmethod
    async def update_flow(self, id: int, request: UpdateFlowRequest) -> Flow:
        """Updates a Flow; naming a parent moves it."""

    @abstractmethod
    async def delete_flow(self, id: int) -> None:
        """Deletes a Flow and its items."""

    @abstractmethod
    async def create_flow_goal(self, request: CreateFlowItemRequest) -> FlowGoal:
        """Creates a Goal item in a Flow."""

    @abstractmethod
    async def create_flow_task(self, request: CreateFlowItemRequest) -> FlowTask:
        """Creates a Task item in a Flow."""

    @abstractmethod
    async def create_flow_commitment(self, request: CreateFlowItemRequest) -> FlowCommitment:
        """Creates a Commitment item in a Flow."""

    @abstractmethod
    async def create_flow_wait(self, request: CreateFlowItemRequest) -> FlowExpectation:
        """Creates a wait item in a Flow."""

    @abstractmethod
    async def update_flow_commitment(
        self, id: int, request: UpdateFlowItemRequest
    ) -> FlowCommitment:
        """Updates a Flow's Commitment item."""

    @abstractmethod
    async def update_flow_wait(self, id: int, request: UpdateFlowItemRequest) -> FlowExpectation:
        """Updates a Flow's wait item."""

    @abstractmethod
    async def update_flow_goal(self, id: int, request: UpdateFlowItemRequest) -> FlowGoal:
        """Updates a Flow's Goal item."""

    @abstractmethod
    async def update_flow_task(self, id: int, request: UpdateFlowItemRequest) -> FlowTask:
        """Updates a Flow's Task item."""

    @abstractmethod
    async def delete_flow_item(self, item_type: FlowItemType, id: int) -> None:
        """Deletes a Flow item."""

    @abstractmethod
    async def set_flow_item_cycles(
        self,
        flow_id: int,
        item_type: FlowItemType,
        item_id: int,
        cycles: list[FlowCycleInput],
        *,
        reconcile: Reconcile | None = None,
        now: datetime | None = None,
    ) -> ForkedTemplate | None:
        """Sets a Flow item's cycles. Orphaning what Habit iterations recorded raises
        :class:`NeedsConfirmation` unless ``reconcile`` says how to settle it."""

    @abstractmethod
    async def add_flow_dependency(
        self,
        flow_id: int,
        dependent_type: FlowItemType,
        dependent_id: int,
        depends_on_type: FlowItemType,
        depends_on_id: int,
    ) -> None:
        """Makes one Flow item come after another."""

    @abstractmethod
    async def remove_flow_dependency(
        self,
        dependent_type: FlowItemType,
        dependent_id: int,
        depends_on_type: FlowItemType,
        depends_on_id: int,
    ) -> None:
        """Removes a dependency between Flow items."""

    @abstractmethod
    async def start_flow(self, flow_id: int, request: StartFlowRequest) -> MaterializedFlow:
        """Starts a Flow: copies it into a real subtree under a target."""

    @abstractmethod
    async def set_flow_recurrence(
        self, flow_id: int, request: SetRecurrenceRequest
    ) -> FlowRecurrence:
        """Makes a Flow a Habit, or changes its Recurrence."""

    @abstractmethod
    async def delete_flow_recurrence(self, flow_id: int) -> None:
        """Takes a Habit's Recurrence away, leaving a plain Flow."""

    @abstractmethod
    async def clear_habit_modifications(self, flow_id: int) -> None:
        """Drops every edit made to a Habit's occurrences."""

    @abstractmethod
    async def fork_flow(self, flow_id: int, *, now: datetime | None = None) -> Flow:
        """Archives a Habit and forks a fresh copy of it."""

    @abstractmethod
    async def duplicate_flow(
        self, flow_id: int, parent_type: str, parent_id: int, position: int
    ) -> Flow:
        """Copies a Flow under a new parent."""

    @abstractmethod
    async def duplicate_flow_item(
        self,
        item_type: FlowItemType,
        item_id: int,
        parent_type: str,
        parent_id: int,
        position: int,
    ) -> int:
        """Copies a Flow item under a new parent in its Flow, and answers the copy's id."""

    @abstractmethod
    async def convert_to_flow(
        self, node_type: str, node_id: int, *, keep_dependencies: bool, map_scopes: bool
    ) -> Flow:
        """Turns a Task or Goal subtree into a Flow."""

    # ---- Client mode: the reads and settings the app's Backend port needs ---------------------

    @abstractmethod
    async def list_tasks(self, *, now: datetime | None = None) -> list[Task]:
        """Every Task — stored rows and every Habit occurrence — derived at ``now``."""

    @abstractmethod
    async def list_goals(self, *, now: datetime | None = None) -> list[Goal]:
        """Every Goal, derived at ``now``."""

    @abstractmethod
    async def list_commitments(self, *, now: datetime | None = None) -> list[Commitment]:
        """Every Commitment, derived at ``now``."""

    @abstractmethod
    async def list_waits(self, *, now: datetime | None = None) -> list[Expectation]:
        """Every wait, derived at ``now``."""

    @abstractmethod
    async def scope_lifecycles(self, *, now: datetime | None = None) -> list[ItemLifecycle]:
        """Every node's derived lifecycle, at ``now``."""

    @abstractmethod
    async def all_task_dependencies(
        self, *, now: datetime | None = None
    ) -> list[TaskDependencyEdge]:
        """Every dependency edge on the board."""

    @abstractmethod
    async def dependency_candidates(
        self, id: NodeId, *, now: datetime | None = None
    ) -> list[Dependency]:
        """What the Task ``id`` may be made to depend on: what the quick dependency picker
        offers."""

    @abstractmethod
    async def scope_containment_conflicts(
        self, node_type: str, node_id: int, time_scope: TimeScope
    ) -> list[ViolatingDescendant]:
        """The descendants of a node that ``time_scope`` would leave outside it. Writes nothing."""

    @abstractmethod
    async def reparent_conflicts(
        self, node_type: str, node_id: int, new_parent_type: str, new_parent_id: int
    ) -> ReparentConflicts:
        """What moving a node under a new parent would leave outside its new ancestors' Time
        Scope, and the scope to clamp them to. Writes nothing."""

    @abstractmethod
    async def list_infos(self) -> list[Info]:
        """Every Info."""

    @abstractmethod
    async def list_flows(self) -> list[Flow]:
        """Every Flow and Habit template."""

    @abstractmethod
    async def list_flow_goals(self, flow_id: int) -> list[FlowGoal]:
        """One Flow's Goal items."""

    @abstractmethod
    async def list_flow_tasks(self, flow_id: int) -> list[FlowTask]:
        """One Flow's Task items."""

    @abstractmethod
    async def list_all_flow_goals(self) -> list[FlowGoal]:
        """Every Flow's Goal items."""

    @abstractmethod
    async def list_all_flow_tasks(self) -> list[FlowTask]:
        """Every Flow's Task items."""

    @abstractmethod
    async def list_all_flow_cycles(self) -> list[FlowItemCycle]:
        """Every Flow item's cycles."""

    @abstractmethod
    async def list_all_flow_dependencies(self) -> list[FlowDependency]:
        """Every dependency between Flow items."""

    @abstractmethod
    async def get_flow_recurrence(self, flow_id: int) -> FlowRecurrence | None:
        """A Habit's recurrence, or ``None`` for a Flow without one."""

    @abstractmethod
    async def habit_completion_count(self, flow_id: int) -> int:
        """How many of a Habit's occurrences are complete."""

    @abstractmethod
    async def flow_origins(self, nodes: list[TargetRef]) -> list[FlowOrigin]:
        """Which Flow, if any, each of ``nodes`` was started from."""

    @abstractmethod
    async def list_flow_instance_nodes(self) -> list[TargetRef]:
        """Every node a started Flow produced."""

    @abstractmethod
    async def scope_valid_flow_targets(
        self,
        candidates: list[TargetRef],
        *,
        duration_n: int | None = None,
        duration_kind: str | None = None,
        anchor_date: date | None = None,
    ) -> list[TargetRef]:
        """Which of ``candidates`` a Flow of the given duration may be started under."""

    @abstractmethod
    async def list_all_block_reasons(self) -> list[BlockReason]:
        """Every stored and derived block reason."""

    @abstractmethod
    async def mcp_access_catalogue(self) -> McpAccessCatalogue:
        """The MCP roots, every node that could be one, and which may be added now."""

    @abstractmethod
    async def list_mcp_access(self) -> list[EffectiveAccess]:
        """Every stored node the MCP can see, with the root it is seen through."""

    @abstractmethod
    async def add_mcp_root(self, node_kind: NodeTable, node_id: int) -> None:
        """Makes one stored node an MCP root."""

    @abstractmethod
    async def remove_mcp_root(self, node_kind: NodeTable, node_id: int) -> None:
        """Stops one node being an MCP root."""

    @abstractmethod
    async def agent_capacity(self) -> CapacityState:
        """The agent capacity lock, as every open of this file in the process shares it."""

    @abstractmethod
    async def set_agent_capacity(self, at_capacity: bool) -> CapacityState:
        """Sets the agent capacity lock on or off, and counts it as a change to the board."""

    @abstractmethod
    async def delete_nodes(self, nodes: list[GestureNode]) -> None:
        """Deletes every node in ``nodes``, all or nothing: the app's multi-node delete, as one
        Gesture."""

    @abstractmethod
    async def run_gesture(self, name: GestureName, steps: list[StepEntry]) -> list[Any]:
        """Runs the gesture operation ``name``: its listed writes, in order, as one Gesture,
        answering each write's result. All or nothing, except a write marked
        ``may_be_refused``."""

    @abstractmethod
    async def undo(self) -> GestureSummary | None:
        """Reverses this client's most recent Gesture, and answers it; ``None`` when this client's
        Undo Stack is empty. Each write through this open is one Gesture of its client."""

    @abstractmethod
    async def redo(self) -> GestureSummary | None:
        """Reapplies this client's most recently undone Gesture; ``None`` when there is none."""

    @abstractmethod
    async def undo_status(self) -> UndoStatus:
        """What this client's next undo and redo would be."""

    @abstractmethod
    async def reset_undo(self) -> None:
        """Empties the journal and clears the ambient Gesture, as the app does at every start. For
        a server's startup, while it holds the database."""

    @property
    @abstractmethod
    def revision(self) -> int:
        """The board's revision: how many writes have been committed to this database file
        through any open of it in this process."""

    @abstractmethod
    async def next_change(self, after: int) -> int:
        """Waits until the board's revision is past ``after``, and answers it."""


class SqliteDatabase(Database):
    """The :class:`Database` port's implementation: Arlesh's Rust core over the SQLite file,
    as :func:`open` returns it. Each operation runs in one transaction of the core."""

    def __init__(self, native: _native.NativeDatabase) -> None:
        self._native = native

    @property
    def client(self) -> str | None:
        return self._native.client

    async def close(self) -> None:
        await self._native.close()

    async def serve_mcp(self, *, host: str = "127.0.0.1", port: int = 0) -> int:
        try:
            return await self._native.serve_mcp(host, port)
        except _native.NativeError as error:
            raise from_native(error) from None

    async def stop_mcp(self) -> None:
        await self._native.stop_mcp()

    async def _call(self, answer: TypeAdapter[T], op: str, **arguments: Any) -> T:
        """Runs the operation ``op`` and reads its answer as ``answer`` describes."""
        request = {"op": op, **{name: _wire(value) for name, value in arguments.items()}}
        try:
            raw = await self._native.call(to_json(request).decode())
        except _native.NativeError as error:
            raise from_native(error) from None
        return answer.validate_json(raw)

    async def board(
        self, *, now: datetime | None = None, at_capacity: bool | None = None
    ) -> MindmapLoad:
        return await self._call(_BOARD, "board", now=now, at_capacity=at_capacity)

    async def get_task(self, id: int) -> TaskWithBlockers:
        return await self._call(_TASK_WITH_BLOCKERS, "get_task", id=id)

    async def get_goal(self, id: int) -> Goal:
        return await self._call(_GOAL, "get_goal", id=id)

    async def get_commitment(self, id: int) -> Commitment:
        return await self._call(_COMMITMENT, "get_commitment", id=id)

    async def get_domain(self, id: int) -> Domain:
        return await self._call(_DOMAIN, "get_domain", id=id)

    async def get_info(self, id: int) -> Info:
        return await self._call(_INFO, "get_info", id=id)

    async def get_flow(self, id: int) -> Flow:
        return await self._call(_FLOW, "get_flow", id=id)

    async def list_domains(self, subtype: DomainSubtype | None = None) -> list[Domain]:
        return await self._call(_DOMAINS, "list_domains", subtype=subtype)

    async def task_dependencies(self, id: NodeId) -> list[Dependency]:
        return await self._call(_DEPENDENCIES, "task_dependencies", id=id)

    async def task_done_at(self, id: NodeId) -> datetime | None:
        return await self._call(_INSTANT, "task_done_at", id=id)

    async def create_task(self, request: CreateTaskRequest) -> Task:
        return await self._call(_TASK, "create_task", request=request)

    async def update_task(
        self,
        id: NodeId,
        request: UpdateTaskRequest,
        *,
        confirmed: bool = False,
        descendant_plans: DescendantPlans | None = None,
    ) -> Task:
        return await self._call(
            _TASK,
            "update_task",
            id=id,
            request=request,
            confirmed=confirmed,
            descendant_plans=descendant_plans,
        )

    async def plan_containment_conflicts(
        self, id: NodeId, plan: TimeScope | None
    ) -> list[PlanClampTarget]:
        return await self._call(_CLAMPS, "plan_containment_conflicts", id=id, plan=plan)

    async def delete_task(self, id: NodeId) -> None:
        await self._call(_NOTHING, "delete_task", id=id)

    async def step_task_status(
        self, id: NodeId, step: StatusStep, *, confirmed: bool = False
    ) -> StatusStepOutcome:
        return await self._call(
            _STATUS_STEP, "step_task_status", id=id, step=step, confirmed=confirmed
        )

    async def toggle_task_agentic(self, id: NodeId) -> Task:
        return await self._call(_TASK, "toggle_task_agentic", id=id)

    async def set_task_archived(self, id: NodeId, archived: bool) -> Task:
        archival = TaskArchival.archived if archived else TaskArchival.live
        return await self.update_task(id, UpdateTaskRequest(archival=archival))

    async def add_task_dependency(self, task_id: NodeId, dependency: AnyDependency) -> None:
        await self._call(_NOTHING, "add_task_dependency", task_id=task_id, dependency=dependency)

    async def remove_task_dependency(self, task_id: NodeId, dependency: AnyDependency) -> None:
        await self._call(_NOTHING, "remove_task_dependency", task_id=task_id, dependency=dependency)

    async def set_task_done_at(self, id: NodeId, at: datetime) -> None:
        await self._call(_NOTHING, "set_task_done_at", id=id, at=at)

    async def duplicate_task(
        self, id: int, target_type: str, target_id: int, position: int
    ) -> DuplicatedTask:
        return await self._call(
            _DUPLICATED_TASK,
            "duplicate_task",
            id=id,
            target_type=target_type,
            target_id=target_id,
            position=position,
        )

    async def create_goal(self, request: CreateGoalRequest) -> Goal:
        return await self._call(_GOAL, "create_goal", request=request)

    async def update_goal(
        self, id: NodeId, request: UpdateGoalRequest, *, confirmed: bool = False
    ) -> Goal:
        return await self._call(_GOAL, "update_goal", id=id, request=request, confirmed=confirmed)

    async def delete_goal(self, id: NodeId) -> None:
        await self._call(_NOTHING, "delete_goal", id=id)

    async def duplicate_goal(
        self, id: int, target_type: str, target_id: int, position: int
    ) -> DuplicatedGoal:
        return await self._call(
            _DUPLICATED_GOAL,
            "duplicate_goal",
            id=id,
            target_type=target_type,
            target_id=target_id,
            position=position,
        )

    async def create_commitment(self, request: CreateCommitmentRequest) -> Commitment:
        return await self._call(_COMMITMENT, "create_commitment", request=request)

    async def update_commitment(self, id: NodeId, request: UpdateCommitmentRequest) -> Commitment:
        return await self._call(_COMMITMENT, "update_commitment", id=id, request=request)

    async def delete_commitment(self, id: NodeId) -> None:
        await self._call(_NOTHING, "delete_commitment", id=id)

    async def set_commitment_archived(self, id: NodeId, archived: bool) -> Commitment:
        archival = CommitmentArchival.archived if archived else CommitmentArchival.live
        return await self.update_commitment(id, UpdateCommitmentRequest(archival=archival))

    async def press_commitment_verdict(self, id: NodeId, press: VerdictPress) -> Commitment:
        return await self._call(_COMMITMENT, "press_commitment_verdict", id=id, press=press)

    async def create_wait(self, request: CreateExpectationRequest) -> Expectation:
        return await self._call(_EXPECTATION, "create_wait", request=request)

    async def update_wait(self, id: NodeId, request: UpdateExpectationRequest) -> Expectation:
        return await self._call(_EXPECTATION, "update_wait", id=id, request=request)

    async def delete_wait(self, id: NodeId) -> None:
        await self._call(_NOTHING, "delete_wait", id=id)

    async def complete_wait_check(self, id: int) -> Expectation:
        return await self._call(_EXPECTATION, "complete_wait_check", id=id)

    async def reopen_wait_check(self, id: int, due_at: datetime) -> Expectation:
        return await self._call(_EXPECTATION, "reopen_wait_check", id=id, due_at=due_at)

    async def update_spawned_wait(
        self, task_id: int, request: UpdateSpawnedWaitRequest
    ) -> SpawnedWait:
        return await self._call(
            _SPAWNED_WAIT, "update_spawned_wait", task_id=task_id, request=request
        )

    async def complete_spawned_wait_check(self, task_id: int) -> None:
        await self._call(_NOTHING, "complete_spawned_wait_check", task_id=task_id)

    async def reopen_spawned_wait_check(self, task_id: int, due_at: datetime) -> None:
        await self._call(_NOTHING, "reopen_spawned_wait_check", task_id=task_id, due_at=due_at)

    async def set_tag(self, kind: str, id: NodeId, tag_id: int, present: bool) -> None:
        await self._call(_NOTHING, "set_tag", kind=kind, id=id, tag_id=tag_id, present=present)

    async def set_block_reasons(
        self, owner_type: str, owner_id: NodeId, reasons: list[str]
    ) -> None:
        await self._call(
            _NOTHING,
            "set_block_reasons",
            owner_type=owner_type,
            owner_id=owner_id,
            reasons=reasons,
        )

    async def create_info(self, request: CreateInfoRequest) -> Info:
        return await self._call(_INFO, "create_info", request=request)

    async def update_info(self, id: int, request: UpdateInfoRequest) -> Info:
        return await self._call(_INFO, "update_info", id=id, request=request)

    async def delete_info(self, id: int) -> None:
        await self._call(_NOTHING, "delete_info", id=id)

    async def duplicate_info(
        self, id: int, target_type: str, target_id: int, position: int
    ) -> DuplicatedInfo:
        return await self._call(
            _DUPLICATED_INFO,
            "duplicate_info",
            id=id,
            target_type=target_type,
            target_id=target_id,
            position=position,
        )

    async def create_domain(self, request: CreateDomainRequest) -> Domain:
        return await self._call(_DOMAIN, "create_domain", request=request)

    async def update_domain(self, id: int, request: UpdateDomainRequest) -> Domain:
        return await self._call(_DOMAIN, "update_domain", id=id, request=request)

    async def delete_domain(self, id: int) -> None:
        await self._call(_NOTHING, "delete_domain", id=id)

    async def duplicate_domain(self, id: int, target_id: int, position: int) -> DuplicatedDomain:
        return await self._call(
            _DUPLICATED_DOMAIN, "duplicate_domain", id=id, target_id=target_id, position=position
        )

    async def create_flow(self, request: CreateFlowRequest) -> Flow:
        return await self._call(_FLOW, "create_flow", request=request)

    async def update_flow(self, id: int, request: UpdateFlowRequest) -> Flow:
        return await self._call(_FLOW, "update_flow", id=id, request=request)

    async def delete_flow(self, id: int) -> None:
        await self._call(_NOTHING, "delete_flow", id=id)

    async def create_flow_goal(self, request: CreateFlowItemRequest) -> FlowGoal:
        return await self._call(_FLOW_GOAL, "create_flow_goal", request=request)

    async def create_flow_task(self, request: CreateFlowItemRequest) -> FlowTask:
        return await self._call(_FLOW_TASK, "create_flow_task", request=request)

    async def create_flow_commitment(self, request: CreateFlowItemRequest) -> FlowCommitment:
        return await self._call(_FLOW_COMMITMENT, "create_flow_commitment", request=request)

    async def create_flow_wait(self, request: CreateFlowItemRequest) -> FlowExpectation:
        return await self._call(_FLOW_WAIT, "create_flow_wait", request=request)

    async def update_flow_commitment(
        self, id: int, request: UpdateFlowItemRequest
    ) -> FlowCommitment:
        return await self._call(_FLOW_COMMITMENT, "update_flow_commitment", id=id, request=request)

    async def update_flow_wait(self, id: int, request: UpdateFlowItemRequest) -> FlowExpectation:
        return await self._call(_FLOW_WAIT, "update_flow_wait", id=id, request=request)

    async def update_flow_goal(self, id: int, request: UpdateFlowItemRequest) -> FlowGoal:
        return await self._call(_FLOW_GOAL, "update_flow_goal", id=id, request=request)

    async def update_flow_task(self, id: int, request: UpdateFlowItemRequest) -> FlowTask:
        return await self._call(_FLOW_TASK, "update_flow_task", id=id, request=request)

    async def delete_flow_item(self, item_type: FlowItemType, id: int) -> None:
        await self._call(_NOTHING, "delete_flow_item", item_type=item_type, id=id)

    async def set_flow_item_cycles(
        self,
        flow_id: int,
        item_type: FlowItemType,
        item_id: int,
        cycles: list[FlowCycleInput],
        *,
        reconcile: Reconcile | None = None,
        now: datetime | None = None,
    ) -> ForkedTemplate | None:
        return await self._call(
            _FORK,
            "set_flow_item_cycles",
            flow_id=flow_id,
            item_type=item_type,
            item_id=item_id,
            cycles=cycles,
            reconcile=reconcile,
            now=now,
        )

    async def add_flow_dependency(
        self,
        flow_id: int,
        dependent_type: FlowItemType,
        dependent_id: int,
        depends_on_type: FlowItemType,
        depends_on_id: int,
    ) -> None:
        await self._call(
            _NOTHING,
            "add_flow_dependency",
            flow_id=flow_id,
            dependent_type=dependent_type,
            dependent_id=dependent_id,
            depends_on_type=depends_on_type,
            depends_on_id=depends_on_id,
        )

    async def remove_flow_dependency(
        self,
        dependent_type: FlowItemType,
        dependent_id: int,
        depends_on_type: FlowItemType,
        depends_on_id: int,
    ) -> None:
        await self._call(
            _NOTHING,
            "remove_flow_dependency",
            dependent_type=dependent_type,
            dependent_id=dependent_id,
            depends_on_type=depends_on_type,
            depends_on_id=depends_on_id,
        )

    async def start_flow(self, flow_id: int, request: StartFlowRequest) -> MaterializedFlow:
        return await self._call(_MATERIALIZED, "start_flow", flow_id=flow_id, request=request)

    async def set_flow_recurrence(
        self, flow_id: int, request: SetRecurrenceRequest
    ) -> FlowRecurrence:
        return await self._call(
            _RECURRENCE, "set_flow_recurrence", flow_id=flow_id, request=request
        )

    async def delete_flow_recurrence(self, flow_id: int) -> None:
        await self._call(_NOTHING, "delete_flow_recurrence", flow_id=flow_id)

    async def clear_habit_modifications(self, flow_id: int) -> None:
        await self._call(_NOTHING, "clear_habit_modifications", flow_id=flow_id)

    async def fork_flow(self, flow_id: int, *, now: datetime | None = None) -> Flow:
        return await self._call(_FLOW, "fork_flow", flow_id=flow_id, now=now)

    async def duplicate_flow(
        self, flow_id: int, parent_type: str, parent_id: int, position: int
    ) -> Flow:
        return await self._call(
            _FLOW,
            "duplicate_flow",
            flow_id=flow_id,
            parent_type=parent_type,
            parent_id=parent_id,
            position=position,
        )

    async def duplicate_flow_item(
        self,
        item_type: FlowItemType,
        item_id: int,
        parent_type: str,
        parent_id: int,
        position: int,
    ) -> int:
        return await self._call(
            _ID,
            "duplicate_flow_item",
            item_type=item_type,
            item_id=item_id,
            parent_type=parent_type,
            parent_id=parent_id,
            position=position,
        )

    async def convert_to_flow(
        self, node_type: str, node_id: int, *, keep_dependencies: bool, map_scopes: bool
    ) -> Flow:
        return await self._call(
            _FLOW,
            "convert_to_flow",
            node_type=node_type,
            node_id=node_id,
            keep_dependencies=keep_dependencies,
            map_scopes=map_scopes,
        )

    async def list_tasks(self, *, now: datetime | None = None) -> list[Task]:
        return await self._call(_TASKS, "list_tasks", now=now)

    async def list_goals(self, *, now: datetime | None = None) -> list[Goal]:
        return await self._call(_GOALS, "list_goals", now=now)

    async def list_commitments(self, *, now: datetime | None = None) -> list[Commitment]:
        return await self._call(_COMMITMENTS, "list_commitments", now=now)

    async def list_waits(self, *, now: datetime | None = None) -> list[Expectation]:
        return await self._call(_WAITS, "list_waits", now=now)

    async def scope_lifecycles(self, *, now: datetime | None = None) -> list[ItemLifecycle]:
        return await self._call(_LIFECYCLES, "scope_lifecycles", now=now)

    async def all_task_dependencies(
        self, *, now: datetime | None = None
    ) -> list[TaskDependencyEdge]:
        return await self._call(_DEPENDENCY_EDGES, "list_all_task_dependencies", now=now)

    async def dependency_candidates(
        self, id: NodeId, *, now: datetime | None = None
    ) -> list[Dependency]:
        return await self._call(_DEPENDENCIES, "dependency_candidates", id=id, now=now)

    async def scope_containment_conflicts(
        self, node_type: str, node_id: int, time_scope: TimeScope
    ) -> list[ViolatingDescendant]:
        return await self._call(
            _VIOLATIONS,
            "scope_containment_conflicts",
            node_type=node_type,
            node_id=node_id,
            time_scope=time_scope,
        )

    async def reparent_conflicts(
        self, node_type: str, node_id: int, new_parent_type: str, new_parent_id: int
    ) -> ReparentConflicts:
        return await self._call(
            _REPARENT_CONFLICTS,
            "reparent_conflicts",
            node_type=node_type,
            node_id=node_id,
            new_parent_type=new_parent_type,
            new_parent_id=new_parent_id,
        )

    async def list_infos(self) -> list[Info]:
        return await self._call(_INFOS, "list_infos")

    async def list_flows(self) -> list[Flow]:
        return await self._call(_FLOWS, "list_flows")

    async def list_flow_goals(self, flow_id: int) -> list[FlowGoal]:
        return await self._call(_FLOW_GOALS, "list_flow_goals", flow_id=flow_id)

    async def list_flow_tasks(self, flow_id: int) -> list[FlowTask]:
        return await self._call(_FLOW_TASKS, "list_flow_tasks", flow_id=flow_id)

    async def list_all_flow_goals(self) -> list[FlowGoal]:
        return await self._call(_FLOW_GOALS, "list_all_flow_goals")

    async def list_all_flow_tasks(self) -> list[FlowTask]:
        return await self._call(_FLOW_TASKS, "list_all_flow_tasks")

    async def list_all_flow_cycles(self) -> list[FlowItemCycle]:
        return await self._call(_FLOW_CYCLES, "list_all_flow_cycles")

    async def list_all_flow_dependencies(self) -> list[FlowDependency]:
        return await self._call(_FLOW_DEPENDENCIES, "list_all_flow_dependencies")

    async def get_flow_recurrence(self, flow_id: int) -> FlowRecurrence | None:
        return await self._call(_RECURRENCE_OR_NONE, "get_flow_recurrence", flow_id=flow_id)

    async def habit_completion_count(self, flow_id: int) -> int:
        return await self._call(_ID, "habit_completion_count", flow_id=flow_id)

    async def flow_origins(self, nodes: list[TargetRef]) -> list[FlowOrigin]:
        return await self._call(_FLOW_ORIGINS, "flow_origins", nodes=nodes)

    async def list_flow_instance_nodes(self) -> list[TargetRef]:
        return await self._call(_TARGETS, "list_flow_instance_nodes")

    async def scope_valid_flow_targets(
        self,
        candidates: list[TargetRef],
        *,
        duration_n: int | None = None,
        duration_kind: str | None = None,
        anchor_date: date | None = None,
    ) -> list[TargetRef]:
        return await self._call(
            _TARGETS,
            "scope_valid_flow_targets",
            candidates=candidates,
            duration_n=duration_n,
            duration_kind=duration_kind,
            anchor_date=anchor_date,
        )

    async def list_all_block_reasons(self) -> list[BlockReason]:
        return await self._call(_BLOCK_REASONS, "list_all_block_reasons")

    async def mcp_access_catalogue(self) -> McpAccessCatalogue:
        return await self._call(_ACCESS_CATALOGUE, "mcp_access_catalogue")

    async def list_mcp_access(self) -> list[EffectiveAccess]:
        return await self._call(_EFFECTIVE_ACCESS, "list_mcp_access")

    async def add_mcp_root(self, node_kind: NodeTable, node_id: int) -> None:
        await self._call(_NOTHING, "add_mcp_root", node_kind=node_kind, node_id=node_id)

    async def remove_mcp_root(self, node_kind: NodeTable, node_id: int) -> None:
        await self._call(_NOTHING, "remove_mcp_root", node_kind=node_kind, node_id=node_id)

    async def agent_capacity(self) -> CapacityState:
        return await self._call(_CAPACITY, "agent_capacity")

    async def set_agent_capacity(self, at_capacity: bool) -> CapacityState:
        return await self._call(_CAPACITY, "set_agent_capacity", at_capacity=at_capacity)

    async def delete_nodes(self, nodes: list[GestureNode]) -> None:
        await self._call(_NOTHING, "delete_nodes", nodes=nodes)

    async def run_gesture(self, name: GestureName, steps: list[StepEntry]) -> list[Any]:
        return await self._call(_ANSWERS, "run_gesture", name=name, steps=steps)

    async def undo(self) -> GestureSummary | None:
        return await self._call(_SUMMARY_OR_NONE, "undo")

    async def redo(self) -> GestureSummary | None:
        return await self._call(_SUMMARY_OR_NONE, "redo")

    async def undo_status(self) -> UndoStatus:
        return await self._call(_UNDO_STATUS, "undo_status")

    async def reset_undo(self) -> None:
        try:
            await self._native.reset_undo()
        except _native.NativeError as error:
            raise from_native(error) from None

    @property
    def revision(self) -> int:
        return self._native.revision

    async def next_change(self, after: int) -> int:
        return await self._native.next_change(after)


_BOARD = TypeAdapter(MindmapLoad)
_TASK = TypeAdapter(Task)
_TASK_WITH_BLOCKERS = TypeAdapter(TaskWithBlockers)
_GOAL = TypeAdapter(Goal)
_COMMITMENT = TypeAdapter(Commitment)
_EXPECTATION = TypeAdapter(Expectation)
_SPAWNED_WAIT = TypeAdapter(SpawnedWait)
_INFO = TypeAdapter(Info)
_DOMAIN = TypeAdapter(Domain)
_DOMAINS = TypeAdapter(list[Domain])
_FLOW = TypeAdapter(Flow)
_FLOW_GOAL = TypeAdapter(FlowGoal)
_FLOW_TASK = TypeAdapter(FlowTask)
_FLOW_COMMITMENT = TypeAdapter(FlowCommitment)
_FLOW_WAIT = TypeAdapter(FlowExpectation)
_RECURRENCE = TypeAdapter(FlowRecurrence)
_MATERIALIZED = TypeAdapter(MaterializedFlow)
_FORK: TypeAdapter[ForkedTemplate | None] = TypeAdapter(ForkedTemplate | None)
_DEPENDENCIES = TypeAdapter(list[Dependency])
_STATUS_STEP = TypeAdapter(StatusStepOutcome)
_INSTANT: TypeAdapter[datetime | None] = TypeAdapter(datetime | None)
_ID = TypeAdapter(int)
_CLAMPS = TypeAdapter(list[PlanClampTarget])
_DUPLICATED_TASK = TypeAdapter(DuplicatedTask)
_DUPLICATED_GOAL = TypeAdapter(DuplicatedGoal)
_DUPLICATED_INFO = TypeAdapter(DuplicatedInfo)
_DUPLICATED_DOMAIN = TypeAdapter(DuplicatedDomain)
_TASKS: TypeAdapter[list[Task]] = TypeAdapter(list[Task])
_GOALS: TypeAdapter[list[Goal]] = TypeAdapter(list[Goal])
_COMMITMENTS: TypeAdapter[list[Commitment]] = TypeAdapter(list[Commitment])
_WAITS: TypeAdapter[list[Expectation]] = TypeAdapter(list[Expectation])
_LIFECYCLES: TypeAdapter[list[ItemLifecycle]] = TypeAdapter(list[ItemLifecycle])
_DEPENDENCY_EDGES: TypeAdapter[list[TaskDependencyEdge]] = TypeAdapter(list[TaskDependencyEdge])
_VIOLATIONS: TypeAdapter[list[ViolatingDescendant]] = TypeAdapter(list[ViolatingDescendant])
_REPARENT_CONFLICTS: TypeAdapter[ReparentConflicts] = TypeAdapter(ReparentConflicts)
_INFOS: TypeAdapter[list[Info]] = TypeAdapter(list[Info])
_FLOWS: TypeAdapter[list[Flow]] = TypeAdapter(list[Flow])
_FLOW_GOALS: TypeAdapter[list[FlowGoal]] = TypeAdapter(list[FlowGoal])
_FLOW_TASKS: TypeAdapter[list[FlowTask]] = TypeAdapter(list[FlowTask])
_FLOW_CYCLES: TypeAdapter[list[FlowItemCycle]] = TypeAdapter(list[FlowItemCycle])
_FLOW_DEPENDENCIES: TypeAdapter[list[FlowDependency]] = TypeAdapter(list[FlowDependency])
_RECURRENCE_OR_NONE: TypeAdapter[FlowRecurrence | None] = TypeAdapter(FlowRecurrence | None)
_FLOW_ORIGINS: TypeAdapter[list[FlowOrigin]] = TypeAdapter(list[FlowOrigin])
_TARGETS: TypeAdapter[list[TargetRef]] = TypeAdapter(list[TargetRef])
_BLOCK_REASONS: TypeAdapter[list[BlockReason]] = TypeAdapter(list[BlockReason])
_ACCESS_CATALOGUE: TypeAdapter[McpAccessCatalogue] = TypeAdapter(McpAccessCatalogue)
_EFFECTIVE_ACCESS: TypeAdapter[list[EffectiveAccess]] = TypeAdapter(list[EffectiveAccess])
_CAPACITY: TypeAdapter[CapacityState] = TypeAdapter(CapacityState)
_SUMMARY_OR_NONE: TypeAdapter[GestureSummary | None] = TypeAdapter(GestureSummary | None)
_UNDO_STATUS = TypeAdapter(UndoStatus)
_ANSWERS: TypeAdapter[list[Any]] = TypeAdapter(list[Any])

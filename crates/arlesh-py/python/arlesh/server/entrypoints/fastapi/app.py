"""The application: every router behind the bearer token, the error answers and the logging."""

from __future__ import annotations

from contextvars import ContextVar

from fastapi import APIRouter, Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException

from arlesh import ArleshError
from arlesh.server.business_logic.board import Board
from arlesh.server.business_logic.pairing import Pairing, PairingRefused
from arlesh.server.entrypoints.fastapi.exception_handling.exception_handlers import (
    handle_authentication_failure,
    handle_core_refusal,
    handle_http_exception,
    handle_pairing_refusal,
    handle_rate_limit,
    handle_request_validation_exception,
    handle_unknown_exception,
)
from arlesh.server.entrypoints.fastapi.exceptions import AuthenticationFailed, RateLimited
from arlesh.server.entrypoints.fastapi.logging.lifespan import lifespan
from arlesh.server.entrypoints.fastapi.logging.log_middleware import RequestLoggingMiddleware
from arlesh.server.entrypoints.fastapi.revision import (
    GzipExceptEventsMiddleware,
    RevisionHeadersMiddleware,
)
from arlesh.server.entrypoints.fastapi.routers.access import McpAccessRouter
from arlesh.server.entrypoints.fastapi.routers.agents import AgentAccountsRouter, AgentsRouter
from arlesh.server.entrypoints.fastapi.routers.board import BoardsRouter
from arlesh.server.entrypoints.fastapi.routers.commitments import CommitmentsRouter
from arlesh.server.entrypoints.fastapi.routers.devices import DevicesRouter
from arlesh.server.entrypoints.fastapi.routers.domains import DomainsRouter
from arlesh.server.entrypoints.fastapi.routers.events import EventsRouter
from arlesh.server.entrypoints.fastapi.routers.flow_items import FlowItemsRouter
from arlesh.server.entrypoints.fastapi.routers.flows import FlowsRouter
from arlesh.server.entrypoints.fastapi.routers.gestures import GesturesRouter
from arlesh.server.entrypoints.fastapi.routers.goals import GoalsRouter
from arlesh.server.entrypoints.fastapi.routers.health import HealthRouter
from arlesh.server.entrypoints.fastapi.routers.infos import InfosRouter
from arlesh.server.entrypoints.fastapi.routers.nodes import NodesRouter
from arlesh.server.entrypoints.fastapi.routers.pair import PairRouter
from arlesh.server.entrypoints.fastapi.routers.scopes import RulesRouter, ScopesRouter
from arlesh.server.entrypoints.fastapi.routers.tasks import TasksRouter
from arlesh.server.entrypoints.fastapi.routers.undo import UndoRouter
from arlesh.server.entrypoints.fastapi.routers.waits import WaitsRouter
from arlesh.server.entrypoints.fastapi.security_scheme import (
    MCP_CLIENT,
    BearerTokenSecurityScheme,
    ConnectTokenSecurityScheme,
)
from arlesh.server.entrypoints.mcp.router import ExpectationsRouter, McpRouter
from arlesh.server.ports.pairing.pairing_store import PairingStore
from arlesh.server.ports.tokens.connect_token_store import ConnectTokens
from arlesh.server.ports.tokens.token_store import TokenStore

DESCRIPTION = """\
Arlesh's board over HTTP, run by Arlesh's own Rust core through the `arlesh` bindings.

* **Every request but `/pair`** carries a bearer token from `arlesh-server token add <client>`.
  The token names the client, and the undo journal records that client on every write it makes.
  A request without one, or with one this server did not issue, is refused 401.
* **Every error** carries the core's `kind` in its body. Branch on it, not on the status.
* **422** means *send it again with more*: `needs_confirmation` (add `?confirmed=true`, or for
  cycles a `reconcile`) or `needs_time_scope` (add a `time_scope`).
* An update's field left out is unchanged; `null` clears it.
* **`POST /pair`** and **`POST /pair/poll`** are open without a token: a new device asks for a
  PIN, someone signed in approves it (`POST /pairings/{pin}/approve`, or `arlesh-server pin
  approve`), and the device's next poll answers its own token, once.
* **`/health`** answers the API version (`api_version`, bumped only on a breaking change) and
  the build commit: the desktop app's handshake before it uses the server.
* **`/events/changes`** streams `board-changed` (Server-Sent Events) after every committed write.
* **`/events/expectations`** is a long poll over the changes to the waits the MCP can see
  (`?agentic=true` keeps the agentic ones): what an agent's notifications follow. The core
  computes the answer.
* **Every answer** carries `X-Arlesh-Revision` and `X-Arlesh-Epoch`: the board's revision (the
  one `/events/changes` sends) and the run of the server it counts in. Answers over 1 KB are
  gzipped when the client accepts it; the event streams never are.
* **`/mcp`** is Arlesh's MCP endpoint (Streamable HTTP with sessions: `initialize` answers an
  `Mcp-Session-Id`; `POST` a JSON-RPC message with it, get JSON). It takes the **connect token**
  (`arlesh-server connect-token`), not a device token. A session is unattached until its agent
  attaches with a one-time PIN (`POST /agents/pins`, signed in), and then sees only its Claim.
* **`/agents`** lists the agents and accounts, issues PINs and changes an agent by hand (pause,
  resume, release, lock, remove), behind a device token.
"""


class AppRouter(APIRouter):
    """Every board route, behind the bearer token."""

    def __init__(
        self,
        *,
        board: Board,
        client_context: ContextVar[str],
        security_scheme: BearerTokenSecurityScheme,
        tokens: TokenStore,
        pairing: Pairing,
        version: str,
    ) -> None:
        super().__init__(dependencies=[Depends(security_scheme.validate_auth)])
        routed = (board, client_context)
        self.include_router(HealthRouter(version), prefix="/health")
        self.include_router(BoardsRouter(*routed, tag="board"), prefix="/board")
        self.include_router(EventsRouter(*routed, tag="events"), prefix="/events/changes")
        self.include_router(McpAccessRouter(*routed, tag="mcp-access"), prefix="/mcp-access")
        self.include_router(UndoRouter(*routed, tag="undo"))
        self.include_router(GesturesRouter(*routed, tag="gestures"), prefix="/gestures")
        self.include_router(TasksRouter(*routed, tag="tasks"), prefix="/tasks")
        self.include_router(GoalsRouter(*routed, tag="goals"), prefix="/goals")
        self.include_router(CommitmentsRouter(*routed, tag="commitments"), prefix="/commitments")
        self.include_router(WaitsRouter(*routed, tag="waits"), prefix="/waits")
        self.include_router(InfosRouter(*routed, tag="infos"), prefix="/infos")
        self.include_router(DomainsRouter(*routed, tag="domains"), prefix="/domains")
        self.include_router(FlowsRouter(*routed, tag="flows"), prefix="/flows")
        self.include_router(FlowItemsRouter(*routed, tag="flows"), prefix="/flow-items")
        self.include_router(NodesRouter(*routed, tag="nodes"), prefix="/nodes")
        self.include_router(ScopesRouter(), prefix="/scopes")
        self.include_router(RulesRouter(), prefix="/rules")
        self.include_router(AgentsRouter(*routed, tag="agents"), prefix="/agents")
        self.include_router(AgentAccountsRouter(*routed, tag="agents"), prefix="/agent-accounts")
        self.include_router(DevicesRouter(tokens, pairing, client_context))


class ArleshServer(FastAPI):
    """The server over the ``board``, admitting the clients ``tokens`` knows.

    Starting it write-opens the database — refused while the desktop app holds it, unless the
    board was made with ``force`` — so a server that is up is one that may write.
    """

    def __init__(
        self,
        *,
        board: Board,
        tokens: TokenStore,
        pairs: PairingStore,
        connect: ConnectTokens,
        version: str,
    ) -> None:
        client_context: ContextVar[str] = ContextVar("arlesh_client")
        super().__init__(
            title="Arlesh",
            description=DESCRIPTION,
            version=version,
            lifespan=lifespan(board),
        )
        pairing = Pairing(pairs, tokens)
        # The one route open without a token: how a device without one gets one.
        self.include_router(PairRouter(pairing), prefix="/pair")
        # Behind the connect token, not a device token: what the agents' sessions connect with.
        connected = ConnectTokenSecurityScheme(connect)
        self.include_router(
            McpRouter(board, MCP_CLIENT, dependencies=[Depends(connected.validate_connect)]),
            prefix="/mcp",
        )
        self.include_router(
            ExpectationsRouter(board, dependencies=[Depends(connected.validate_attached)]),
            prefix="/events/expectations",
        )
        self.include_router(
            AppRouter(
                board=board,
                client_context=client_context,
                security_scheme=BearerTokenSecurityScheme(tokens, client_context),
                tokens=tokens,
                pairing=pairing,
                version=version,
            )
        )
        self.add_middleware(RequestLoggingMiddleware)
        self.add_middleware(
            RevisionHeadersMiddleware, revision=lambda: board.revision, epoch=board.epoch
        )
        # Outermost, so it compresses the answer the stamp was put on.
        self.add_middleware(GzipExceptEventsMiddleware)
        self.add_exception_handler(ArleshError, handle_core_refusal)
        self.add_exception_handler(PairingRefused, handle_pairing_refusal)
        self.add_exception_handler(RateLimited, handle_rate_limit)
        self.add_exception_handler(AuthenticationFailed, handle_authentication_failure)
        self.add_exception_handler(RequestValidationError, handle_request_validation_exception)
        self.add_exception_handler(HTTPException, handle_http_exception)
        self.add_exception_handler(Exception, handle_unknown_exception)

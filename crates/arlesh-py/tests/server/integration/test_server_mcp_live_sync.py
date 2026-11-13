"""An agent's write through ``/mcp`` reaches ``/events/changes`` as changed nodes, like any other
write: the MCP does not go through the routes, so this is the one path the stream hears of from a
different door."""

from __future__ import annotations

import httpx
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore

from tests.server.integration.live_stream import follow
from tests.server.integration.test_server_wait_events import Agent

ROOT_ASPECT = 1


def test_an_agents_write_through_mcp_reaches_the_change_stream_as_changed_nodes(
    live: str, tokens: DatabaseTokenStore, connect_token: str
) -> None:
    token = tokens.add("user")
    admin = {"Authorization": f"Bearer {token}"}
    domain = httpx.post(
        f"{live}/domains",
        json={"title": "Home", "subtype": "domain", "parent_id": ROOT_ASPECT},
        headers=admin,
    ).json()["id"]
    opened = httpx.put(f"{live}/mcp-access/roots/domain/{domain}", headers=admin)
    assert opened.status_code == 204, opened.text
    agent = Agent(live, connect_token)
    agent.attach(httpx.post(f"{live}/agents/pins", headers=admin).json()["pin"], domain)
    stream = follow(live, token)
    assert stream.connected.wait(20)
    stream.heads.get(timeout=20)

    made = agent.call(
        "arlesh_tasks",
        operation="create",
        title="From the agent",
        parent_type="domain",
        parent_id=str(domain),
    )
    event = stream.next_change()

    titles = [value["title"] for _, value in event["changes"]["tasks"]["set"]]
    assert titles == ["From the agent"]
    assert made["short_id"]

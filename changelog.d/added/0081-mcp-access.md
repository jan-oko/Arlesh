- **MCP access.** The MCP endpoint now sees only the parts of the board you open to it. On the
  settings modal's *MCP access* page, add **MCP roots** with the node search: an agent can read
  everything inside a root and nothing outside, Agentic tasks inside a root are the only thing it
  can write, and private nodes stay hidden even inside one. With no roots it sees nothing — so
  after updating, add a root before an agent can read the board again. Every node the MCP can see
  shows an eye in its status badges, naming the root it is seen through. The agent is told its
  roots when it connects, and a request for anything outside them is refused as `not_permitted`.
  Adding or removing a root is undoable.

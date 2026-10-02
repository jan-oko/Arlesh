- **The beads id.** A Task, Goal, Commitment or Project no longer carries the id of a bd issue. The
  editors' **Issue** row and its × are gone, a Steps card no longer lists an **Issue** field, a
  copied node no longer carries the link, and the MCP server no longer has the `arlesh_beads` tool
  or a `beads_id` on anything it returns. bd is retired, and work is tracked on the Arlesh board.

  Nothing is lost: every id that was set is kept in a `retired_beads_ids` table in the database.

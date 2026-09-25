- **Choose the MCP port in Settings, and see whether the endpoint is running.** The Settings MCP
  page now has a port field (4747 by default). Changing it moves the endpoint straight away — no
  restart of Arlesh needed. The page also says whether the endpoint is listening and on which
  address, or why it is not — typically that another Arlesh already holds the port — with a
  Restart button to try again. `ARLESH_MCP_PORT` still overrides the setting when it is set, and
  the page says when it does.

- **Arlesh over HTTP.** `pip install 'arlesh[server]'` adds `arlesh-server`, which serves your
  board over HTTP from the machine that holds it: the whole board in one request, every kind of
  node's edits, Arlesh's scope and lifecycle rules, and the MCP endpoint at `/mcp`. Every request
  needs a token you issue per device with `arlesh-server token add <name>`. That name is recorded
  on every change the device makes, and a token can be revoked at any time. It listens on this
  machine only unless you pass `--host`, and serves HTTPS when given `--tls-cert` and `--tls-key`.
  It will not start while the Arlesh app has the same database open, unless you pass `--force`.

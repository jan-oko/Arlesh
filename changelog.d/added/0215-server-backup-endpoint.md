- **`GET /backup` on the server.** Set `ARLESH_BACKUP_TOKEN` in the server's environment (a
  container's `environment:`, say) and the server streams a consistent snapshot of its SQLite
  database, with `Authorization: Bearer <that token>`, as `arlesh-YYYY-MM-DD.db`. It is the
  administrator's, kept apart from the device tokens: a paired device's token does not open it, and
  without the variable the route does not exist. The snapshot is taken with SQLite's backup API on a
  read-only connection, so it does not hold up the server's writes or touch the live database.

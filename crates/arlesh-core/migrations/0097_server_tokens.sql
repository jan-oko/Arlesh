-- The server's bearer tokens, one per client (Task 9f0; settled with the user 2026-10-30).
--
-- `arlesh-server` admits a request only with a token it issued, and the token names the client the
-- undo journal records. The tokens used to live in a JSON file beside the database
-- (`<db>.tokens`). They move here, so they travel with the database they guard: a server seeded by
-- copying `arlesh.db` brings its devices with it, and a database URL is all the server needs.
--
-- **Server-only.** The desktop app never reads or writes this table; it is created in every
-- database only because there is one migration chain. A token is kept as the SHA-256 digest of its
-- text, never the text: a token is 256 random bits, so a slow hash would add nothing.
--
-- Not journaled: issuing or revoking a token is not a board edit, and no one's Ctrl+Z may bring a
-- revoked token back. `undo::EXCLUDED_TABLES` names it for that reason.
CREATE TABLE server_tokens (
    client     TEXT PRIMARY KEY NOT NULL,
    sha256     TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

-- Agents: the identities that work the board through the MCP, their Claims, and the usage of the
-- accounts they work under (Task 7a0; settled with the user 2026-11-07).
--
-- An **Agent** is a session of an AI client that attached with a one-time PIN. It holds at most one
-- **Claim**: a subtree of the board that is its whole view. Claims are kept here, on the Agent's
-- row, so "only one active Claim covers a node" is decided against the table.
--
-- **Not journaled** (`undo::EXCLUDED_TABLES`), like `server_tokens`: attaching, claiming or
-- locking an agent is not a board edit, and no Ctrl+Z may revoke an Agent or hand a Claim back.
-- Every table here is present in every database, the desktop app's included, because there is one
-- migration chain; `connect_tokens` is the only one only a server reads.
--
-- Secrets are kept as SHA-256 digests, never as text, like the server's device tokens.

CREATE TABLE agents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- What Settings -> Agents shows. Unique, so a name points at one agent.
    name         TEXT NOT NULL UNIQUE,
    -- The label of the account the agent works under; usage is kept per account.
    account      TEXT NOT NULL,
    -- The client's own session id, as the agent last attached with it.
    session_uuid TEXT NOT NULL,
    -- The agent token's digest: what lets a session attach again after a restart.
    token_sha256 TEXT NOT NULL UNIQUE,
    -- The Claim's root, keyed as `mcp_roots` keys a node; both NULL when the agent holds none.
    claim_kind   TEXT,
    claim_id     INTEGER,
    -- A paused Claim leaves the subtree free for another agent to claim; the agent keeps its token.
    claim_paused INTEGER NOT NULL DEFAULT 0 CHECK (claim_paused IN (0, 1)),
    -- When the Claim was made: the older of two overlapping Claims keeps its place.
    claimed_at   TEXT,
    -- A manual lock: the agent's claimed Agentic Tasks read blocked while it is on.
    locked       INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    created_at   TEXT NOT NULL,
    last_seen_at TEXT,
    CHECK ((claim_kind IS NULL) = (claim_id IS NULL) AND (claim_kind IS NULL) = (claimed_at IS NULL))
);

-- One-time PINs a signed-in client asked for. A used or lapsed PIN is deleted.
CREATE TABLE agent_pins (
    pin        TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- Wrong PINs presented, newest last: enough of them in a short while shuts the door for a while.
CREATE TABLE agent_pin_failures (
    failed_at TEXT NOT NULL
);

-- A manual lock on a whole account. An account exists as soon as an agent names it.
CREATE TABLE agent_accounts (
    label  TEXT PRIMARY KEY NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1))
);

-- What an account has used, per limit window, as an agent last reported it. An account is at
-- capacity while a window sits at 100% before its reset: derived, so it lifts by itself.
CREATE TABLE agent_account_usage (
    account      TEXT NOT NULL,
    window_kind  TEXT NOT NULL,
    percent_used REAL NOT NULL,
    resets_at    TEXT NOT NULL,
    reported_at  TEXT NOT NULL,
    PRIMARY KEY (account, window_kind)
);

-- The one low-privilege token every MCP session of a server connects with. At most one row: issuing
-- a new token replaces the old. It admits a session to `/mcp` and lets it call the attach tool, and
-- nothing else. Server-only; the desktop app's own endpoint is loopback and needs none.
CREATE TABLE connect_tokens (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    sha256       TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT
);

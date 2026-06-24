PRAGMA foreign_keys = ON;

CREATE TABLE domains (
    id                       INTEGER PRIMARY KEY,
    title                    TEXT NOT NULL,
    description              TEXT,
    subtype                  TEXT NOT NULL CHECK (subtype IN ('aspect', 'project', 'domain', 'tag')),
    parent_id                INTEGER REFERENCES domains(id),
    color                    TEXT,
    status                   TEXT CHECK (status IN ('active', 'achieved', 'frozen', 'archived')),
    knowledge_base_directory TEXT
);

INSERT INTO domains (title, subtype, color) VALUES
    ('Body',        'aspect', '#e74c3c'),
    ('Connections', 'aspect', '#9b59b6'),
    ('Growth',      'aspect', '#27ae60'),
    ('Duty',        'aspect', '#2980b9'),
    ('Flow',        'aspect', '#95a5a6'),
    ('Self',        'aspect', '#bdc3c7');

CREATE TABLE scopes (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('season', 'month', 'week', 'day')),
    label      TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date   TEXT NOT NULL,
    week_id    INTEGER REFERENCES scopes(id),
    month_id   INTEGER REFERENCES scopes(id),
    season_id  INTEGER REFERENCES scopes(id),
    UNIQUE (kind, start_date)
);

CREATE TABLE people (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    aliases     TEXT NOT NULL DEFAULT '[]',
    linked_note TEXT
);

CREATE TABLE goals (
    id             INTEGER PRIMARY KEY,
    title          TEXT NOT NULL,
    parent_type    TEXT NOT NULL CHECK (parent_type IN ('project', 'goal', 'domain')),
    parent_id      INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'achieved', 'frozen', 'archived')),
    blocked_reason TEXT,
    scope_id       INTEGER REFERENCES scopes(id)
);

CREATE TABLE tasks (
    id             INTEGER PRIMARY KEY,
    title          TEXT NOT NULL,
    parent_type    TEXT NOT NULL CHECK (parent_type IN ('project', 'goal', 'domain', 'task')),
    parent_id      INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'todo'
                       CHECK (status IN ('todo', 'in_progress', 'done')),
    blocked_reason TEXT,
    delegate_to    INTEGER REFERENCES people(id),
    scope_id       INTEGER REFERENCES scopes(id)
);

CREATE TABLE task_dependencies (
    task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('task', 'goal')),
    dependency_id   INTEGER NOT NULL,
    PRIMARY KEY (task_id, dependency_type, dependency_id)
);

CREATE TABLE tags_on_goals (
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (goal_id, tag_id)
);

CREATE TABLE tags_on_tasks (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES domains(id),
    PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE events (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    scope_id    INTEGER REFERENCES scopes(id),
    event_time  TEXT,
    linked_note TEXT
);

CREATE TABLE threads (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    linked_note TEXT
);

CREATE TABLE goal_knowledge_base_links (
    goal_id     INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'event', 'thread', 'scope')),
    entity_id   INTEGER NOT NULL,
    PRIMARY KEY (goal_id, entity_type, entity_id)
);

CREATE TABLE task_knowledge_base_links (
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'event', 'thread', 'scope')),
    entity_id   INTEGER NOT NULL,
    PRIMARY KEY (task_id, entity_type, entity_id)
);

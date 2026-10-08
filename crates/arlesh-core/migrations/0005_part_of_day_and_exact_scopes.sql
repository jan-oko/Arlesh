-- Extend scopes with Part-of-Day and Exact kinds.
--
-- SQLite cannot alter a CHECK constraint or a UNIQUE constraint in place, so the table is
-- rebuilt. `defer_foreign_keys` postpones FK enforcement to commit (it works inside the
-- migration transaction, unlike `foreign_keys = OFF`), so dropping the old `scopes` while
-- goals/tasks/events still reference it is allowed; ids are preserved, so every reference
-- stays valid at commit.
--
-- New columns:
--   day_id          containment parent for Part-of-Day scopes (the day the part starts on)
--   part            which sub-day band, for Part-of-Day scopes
--   start_datetime  explicit boundaries for Exact scopes (ISO 8601, minute precision)
--   end_datetime
--
-- Canonical scopes keep date-only start_date/end_date and resolve to datetimes on read.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE scopes_new (
    id             INTEGER PRIMARY KEY,
    kind           TEXT NOT NULL CHECK (kind IN ('season', 'month', 'week', 'day', 'part_of_day', 'exact')),
    label          TEXT NOT NULL,
    start_date     TEXT NOT NULL,
    end_date       TEXT NOT NULL,
    week_id        INTEGER REFERENCES scopes(id),
    month_id       INTEGER REFERENCES scopes(id),
    season_id      INTEGER REFERENCES scopes(id),
    day_id         INTEGER REFERENCES scopes(id),
    part           TEXT CHECK (part IN ('morning', 'noon', 'afternoon', 'evening', 'night', 'premorning')),
    start_datetime TEXT,
    end_datetime   TEXT
);

INSERT INTO scopes_new (id, kind, label, start_date, end_date, week_id, month_id, season_id)
    SELECT id, kind, label, start_date, end_date, week_id, month_id, season_id FROM scopes;

DROP TABLE scopes;
ALTER TABLE scopes_new RENAME TO scopes;

-- Canonical scopes are unique by (kind, start_date). NULLs are distinct in SQLite UNIQUE
-- constraints, so the three scope families need separate partial unique indexes.
CREATE UNIQUE INDEX scopes_canonical_uniq ON scopes (kind, start_date)
    WHERE kind IN ('season', 'month', 'week', 'day');
CREATE UNIQUE INDEX scopes_part_uniq ON scopes (start_date, part)
    WHERE kind = 'part_of_day';
CREATE UNIQUE INDEX scopes_exact_uniq ON scopes (start_datetime, end_datetime)
    WHERE kind = 'exact';

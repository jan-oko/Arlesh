-- An info node gains an optional multi-line `details` field, separate from its one-line `body` — for
-- longer supporting text such as error tracebacks. NULL means no details.
ALTER TABLE infos ADD COLUMN details TEXT;

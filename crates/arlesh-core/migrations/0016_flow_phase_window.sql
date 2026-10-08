-- Feature B: sub-day Flow Windows.
-- flow_duration_kind may now also be 'part' or 'exact' (a Phase window, vs a coarse Span window of
-- day/week/month/season). A Phase window is carried date-free on the template and combined with the
-- start anchor's date at materialization:
--   * part  -> flow_window_part names the band (e.g. 'evening'); flow_duration_n = 1.
--   * exact -> flow_window_time_start/_end give a 'HH:MM' time-of-day range.

ALTER TABLE flows ADD COLUMN flow_window_part TEXT
    CHECK (flow_window_part IS NULL OR flow_window_part IN
        ('morning', 'noon', 'afternoon', 'evening', 'night', 'premorning'));
ALTER TABLE flows ADD COLUMN flow_window_time_start TEXT; -- 'HH:MM' for exact Phase windows
ALTER TABLE flows ADD COLUMN flow_window_time_end   TEXT; -- 'HH:MM' for exact Phase windows

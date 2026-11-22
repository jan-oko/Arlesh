//! A dev tool, run by hand and never by CI: what one "press" costs on an in-memory board
//! (task `ccc`, sizing the client Replica). It takes a copy of any Arlesh database as its first
//! argument, so nothing private is compiled in.
//!
//! `DUMP_BOARD=<file>` (with `HABITS_ALONE=1` to read each Habit by itself) writes the derived board at a fixed instant instead of measuring, to compare
//! before and after a change to the board read byte for byte. `EACH=1` prints every press.
//! Build it for a phone with `--target aarch64-linux-android` and run it from `adb shell`.
//!
//! usage: press_measure <arlesh.db copy> [presses=60] [warmup=10] [scale_to_tasks=0]
//!
//! Phases per press: gesture open, write (step_status + commit), gesture close, blocking read,
//! BoardSources::read (total, then an estimate of query time by replaying its statements; the remainder is decode plus what the replay cannot bind),
//! derive_board, facts (reads + derivation), diff (serialize, compare).
//! Also: cold load of a full snapshot into an empty in-memory database, and core undo of one write.
use std::collections::BTreeMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use arlesh_core::database::client::ClientId;
use arlesh_core::database::open::{open, OpenMode};
use arlesh_core::database::session::SessionFactory;
use arlesh_core::flows::occurrences::Horizon;
use arlesh_core::mindmap::rules as mrules;
use arlesh_core::mindmap::sources::BoardSources;
use arlesh_core::nodes::id::NodeId;
use arlesh_core::replication;
use arlesh_core::tasks::gestures::{step_status, StatusStepOutcome};
use arlesh_core::tasks::rules::gestures::StatusStep;
use arlesh_core::undo::{self, stacks::UndoStacks};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

// ---- capturing the SQL BoardSources::read runs, through sqlx's own tracing events ----

struct Capture {
    on: Arc<AtomicBool>,
    sink: Arc<Mutex<Vec<String>>>,
}
struct Grab(Option<String>);
impl tracing::field::Visit for Grab {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "db.statement" {
            self.0 = Some(format!("{value:?}"));
        }
    }
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "db.statement" {
            self.0 = Some(value.to_owned());
        }
    }
}
impl tracing::Subscriber for Capture {
    fn register_callsite(
        &self,
        _: &'static tracing::Metadata<'static>,
    ) -> tracing::subscriber::Interest {
        tracing::subscriber::Interest::sometimes()
    }
    fn enabled(&self, m: &tracing::Metadata<'_>) -> bool {
        self.on.load(Ordering::Relaxed) && m.target() == "sqlx::query"
    }
    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn event(&self, e: &tracing::Event<'_>) {
        let mut g = Grab(None);
        e.record(&mut g);
        if let Some(s) = g.0 {
            if let Ok(mut v) = self.sink.lock() {
                v.push(s.trim().trim_matches('"').replace("\\n", "\n"));
            }
        }
    }
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
}

fn ms(i: Instant) -> f64 {
    i.elapsed().as_secs_f64() * 1000.0
}

#[derive(Default)]
struct Phases(BTreeMap<&'static str, Vec<f64>>);
impl Phases {
    fn put(&mut self, k: &'static str, v: f64) {
        self.0.entry(k).or_default().push(v);
    }
    fn report(&self, order: &[&str]) {
        println!(
            "{:<22}{:>10}{:>10}{:>10}{:>10}",
            "phase (ms)", "median", "p95", "min", "max"
        );
        for k in order {
            if let Some(v) = self.0.get(k) {
                let mut s = v.clone();
                s.sort_by(f64::total_cmp);
                let med = s[s.len() / 2];
                let p95 = s[((s.len() as f64) * 0.95).ceil() as usize - 1];
                println!(
                    "{k:<22}{med:>10.2}{p95:>10.2}{:>10.2}{:>10.2}",
                    s[0],
                    s[s.len() - 1]
                );
            }
        }
    }
}

async fn memory_pool() -> anyhow::Result<SqlitePool> {
    // One connection that never goes away: each `:memory:` connection is its own database.
    let options = SqliteConnectOptions::from_str("sqlite::memory:")?;
    Ok(SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .after_connect(|c, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(&mut *c)
                    .await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await?)
}

/// Cold load: empty in-memory db (baseline schema), then every snapshot row inserted.
async fn cold_load(snapshot: &replication::Snapshot) -> anyhow::Result<(SqlitePool, f64, f64)> {
    let t = Instant::now();
    let pool = memory_pool().await?;
    arlesh_core::database::migrate(&pool).await?;
    let schema_ms = ms(t);

    let t = Instant::now();
    let mut conn = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE undo_context SET suppressed = 1 WHERE id = 1")
        .execute(&mut *conn)
        .await?;
    sqlx::query("BEGIN").execute(&mut *conn).await?;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name <> '_sqlx_migrations'",
    )
    .fetch_all(&mut *conn)
    .await?;
    for table in tables.iter().filter(|t| replication::is_replicated(t)) {
        sqlx::query(&format!("DELETE FROM \"{table}\""))
            .execute(&mut *conn)
            .await?;
    }
    let mut by_table: BTreeMap<&str, Vec<&replication::StoredRow>> = BTreeMap::new();
    for row in &snapshot.rows {
        by_table.entry(row.table.as_str()).or_default().push(row);
    }
    for (table, rows) in by_table {
        let cols: Vec<String> = sqlx::query(&format!("PRAGMA table_info(\"{table}\")"))
            .fetch_all(&mut *conn)
            .await?
            .iter()
            .map(|r| r.get::<String, _>("name"))
            .collect();
        let names = cols
            .iter()
            .map(|c| format!("\"{c}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let vals = cols
            .iter()
            .map(|c| format!("json_extract(?2, '$.{c}')"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql =
            format!("INSERT OR REPLACE INTO \"{table}\" (rowid, {names}) VALUES (?1, {vals})");
        for row in rows {
            sqlx::query(&sql)
                .bind(row.rowid)
                .bind(&row.image)
                .execute(&mut *conn)
                .await?;
        }
    }
    sqlx::query("COMMIT").execute(&mut *conn).await?;
    sqlx::query("DELETE FROM undo_journal")
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE undo_context SET suppressed = 0 WHERE id = 1")
        .execute(&mut *conn)
        .await?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *conn)
        .await?;
    drop(conn);
    Ok((pool, schema_ms, ms(t)))
}

async fn scale_tasks(pool: &SqlitePool, target: i64) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    sqlx::query("UPDATE undo_context SET suppressed = 1 WHERE id = 1")
        .execute(&mut *conn)
        .await?;
    let cols: Vec<String> = sqlx::query("PRAGMA table_info(tasks)")
        .fetch_all(&mut *conn)
        .await?
        .iter()
        .map(|r| r.get::<String, _>("name"))
        .filter(|c| c != "id")
        .collect();
    let list = cols
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    loop {
        let have: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks")
            .fetch_one(&mut *conn)
            .await?;
        if have >= target {
            break;
        }
        // `position` is part of a unique key under some parent: nudge copies to a fresh one.
        let sql = format!(
            "INSERT INTO tasks ({list}) SELECT {} FROM tasks WHERE archival = 'live' ORDER BY rowid LIMIT {}",
            cols.iter()
                .map(|c| if c == "position" { "position + 100000 * (SELECT count(*) FROM tasks)".to_owned() } else { format!("\"{c}\"") })
                .collect::<Vec<_>>()
                .join(", "),
            target - have
        );
        sqlx::query(&sql).execute(&mut *conn).await?;
    }
    sqlx::query("DELETE FROM undo_journal")
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE undo_context SET suppressed = 0 WHERE id = 1")
        .execute(&mut *conn)
        .await?;
    Ok(())
}

fn cpu_now() -> Option<usize> {
    let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
    let after = stat.rsplit_once(')')?.1;
    after.split_whitespace().nth(36)?.parse().ok()
}

fn freqs() -> String {
    let mut out = Vec::new();
    for i in 0..16 {
        if let Ok(s) = std::fs::read_to_string(format!(
            "/sys/devices/system/cpu/cpu{i}/cpufreq/scaling_cur_freq"
        )) {
            out.push(format!(
                "cpu{i}={}MHz",
                s.trim().parse::<u64>().unwrap_or(0) / 1000
            ));
        }
    }
    out.join(" ")
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let path = args.next().ok_or_else(|| {
        anyhow::anyhow!("usage: press_measure <arlesh.db copy> [presses] [warmup] [scale_to_tasks]")
    })?;
    let presses: usize = args.next().map_or(60, |s| s.parse().unwrap_or(60));
    let warmup: usize = args.next().map_or(10, |s| s.parse().unwrap_or(10));
    let scale: i64 = args.next().map_or(0, |s| s.parse().unwrap_or(0));

    let on = Arc::new(AtomicBool::new(false));
    let sink = Arc::new(Mutex::new(Vec::new()));
    tracing::subscriber::set_global_default(Capture {
        on: on.clone(),
        sink: sink.clone(),
    })?;

    // ---- snapshot from the source file ----
    let source = open(
        std::path::Path::new(&path),
        OpenMode::Write {
            client: ClientId::desktop(),
            force: true,
        },
    )
    .await?;
    let mut db = source.begin_read().await?;
    let t = Instant::now();
    let snapshot = replication::snapshot(&mut db).await?;
    let snapshot_read = ms(t);
    db.commit().await?;
    let t = Instant::now();
    let body = replication::rules::wire::snapshot_body(&snapshot, "e", 0)?;
    let snap_ser = ms(t);
    let t = Instant::now();
    let _parsed: serde_json::Value = serde_json::from_str(&body)?;
    let snap_parse = ms(t);
    println!(
        "snapshot: {} rows, {} tables, body {} bytes; server read {snapshot_read:.1} ms, body serialize {snap_ser:.1} ms, client JSON parse {snap_parse:.1} ms",
        snapshot.rows.len(),
        snapshot.rows.iter().map(|r| r.table.as_str()).collect::<std::collections::BTreeSet<_>>().len(),
        body.len()
    );
    source.close().await;

    // ---- cold load (3 runs) ----
    let mut keep = None;
    for run in 0..3 {
        let (pool, schema_ms, rows_ms) = cold_load(&snapshot).await?;
        println!("cold load run {run}: schema install {schema_ms:.1} ms + insert rows {rows_ms:.1} ms = {:.1} ms", schema_ms + rows_ms);
        keep = Some(pool);
    }
    let pool = keep.ok_or_else(|| anyhow::anyhow!("no cold load ran"))?;
    if scale > 0 {
        scale_tasks(&pool, scale).await?;
    }
    let n_tasks: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks")
        .fetch_one(&pool)
        .await?;
    let factory = SessionFactory::new(pool.clone());
    let stacks = UndoStacks::new();

    // candidates: leaf, non-agentic Tasks
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM tasks WHERE archival = 'live' AND compound = 0 AND status IN ('todo','started','done') ORDER BY id",
    )
    .fetch_all(&pool)
    .await?;
    println!(
        "board in memory: {n_tasks} Tasks; {} press candidates; start {}",
        ids.len(),
        freqs()
    );

    if let Ok(out) = std::env::var("DUMP_BOARD") {
        // The board at a fixed instant, for a before/after byte comparison of a change to the read.
        let fixed = chrono::NaiveDate::from_ymd_opt(2026, 11, 21)
            .and_then(|d| d.and_hms_opt(12, 0, 0))
            .ok_or_else(|| anyhow::anyhow!("bad date"))?;
        let mut db = factory.begin_read().await?;
        let blocking = arlesh_core::agents::service::blocking(&mut db, fixed).await?;
        let mut sources = BoardSources::read(&mut db).await?;
        if std::env::var("HABITS_ALONE").is_ok() {
            // Read every Habit by itself, as the board read did before it shared the Flow lists.
            for flow in sources.flows.iter().filter(|flow| flow.is_habit) {
                let alone = arlesh_core::flows::occurrences::HabitSource::read(&mut db, flow).await;
                sources.habits.insert(flow.id, alone);
            }
        }
        db.commit().await?;
        let load = mrules::derive_board(sources, fixed, Horizon::default(), blocking)?;
        std::fs::write(&out, serde_json::to_vec_pretty(&load)?)?;
        println!("board written to {out}");
        return Ok(());
    }

    let mut ph = Phases::default();
    let mut cpus: BTreeMap<usize, usize> = BTreeMap::new();
    let mut prev: Option<(Vec<u8>, serde_json::Value)> = None;
    let mut refused = 0;
    let mut done_presses = 0usize;
    let mut cursor = 7usize;
    let mut board_bytes = 0usize;
    let total_runs = presses + warmup;
    let mut undo_times = Vec::new();
    let mut undo_runs = 0usize;
    let run_start = Instant::now();

    while done_presses < total_runs + 20 {
        let undo_phase = done_presses >= total_runs;
        let id: NodeId = ids[cursor % ids.len()].parse()?;
        cursor += 37;
        let now = chrono::Local::now().naive_local();

        // write, inside a Gesture
        let t = Instant::now();
        {
            let mut s = factory.connect().await?;
            s.undo().open_gesture().await?;
        }
        let t_open = ms(t);
        if done_presses == 0 {
            sink.lock().map_err(|e| anyhow::anyhow!("{e}"))?.clear();
            on.store(true, Ordering::Relaxed);
        }
        let t = Instant::now();
        let mut db = factory.begin().await?;
        let outcome = step_status(&mut db, &id, StatusStep::Advance, true, now)
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))?;
        db.commit().await?;
        let t_write = ms(t);
        if done_presses == 0 {
            on.store(false, Ordering::Relaxed);
            let w = sink.lock().map_err(|e| anyhow::anyhow!("{e}"))?.clone();
            println!("(write: {} statements)", w.len());
            let mut hist: BTreeMap<String, usize> = BTreeMap::new();
            for q in &w {
                let one: String = q.split_whitespace().collect::<Vec<_>>().join(" ");
                *hist.entry(one.chars().take(110).collect()).or_default() += 1;
            }
            let mut top: Vec<_> = hist.into_iter().collect();
            top.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
            for (q, n) in top.iter().take(40) {
                println!("   {n:>5} x {q}");
            }
        }
        let t = Instant::now();
        undo::close_gesture(&factory, &stacks).await?;
        let t_close = ms(t);
        if matches!(outcome, StatusStepOutcome::Refused { .. }) {
            refused += 1;
            continue;
        }
        if undo_phase {
            let t = Instant::now();
            undo::undo(&factory, &stacks).await?;
            undo_times.push(ms(t));
            undo_runs += 1;
            done_presses += 1;
            continue;
        }

        // read
        let t = Instant::now();
        let mut db = factory.begin_read().await?;
        let blocking = arlesh_core::agents::service::blocking(&mut db, now).await?;
        let t_blocking = ms(t);
        sink.lock().map_err(|e| anyhow::anyhow!("{e}"))?.clear();
        on.store(true, Ordering::Relaxed);
        let t = Instant::now();
        let sources = BoardSources::read(&mut db).await?;
        let t_read = ms(t);
        on.store(false, Ordering::Relaxed);

        // derive
        let t = Instant::now();
        let mut load = mrules::derive_board(sources, now, Horizon::default(), blocking)?;
        let t_derive = ms(t);

        // facts (reads, then derivation)
        let t = Instant::now();
        let access = arlesh_core::access::access_map(&mut db)
            .await
            .ok()
            .map(|m| m.effective());
        load.answer_drafts = db.answer_drafts().list().await?;
        let t_facts_read = ms(t);
        db.commit().await?;
        let t = Instant::now();
        load.short_ids = arlesh_core::mcp::ids::board_short_ids(&load);
        let (facts, activity) = mrules::facts::derive(&load, access.as_deref());
        load.facts = facts;
        load.agent_activity = Some(activity);
        let t_facts = ms(t);

        // diff
        let t = Instant::now();
        let bytes = serde_json::to_vec(&load)?;
        let t_ser = ms(t);
        let t = Instant::now();
        let value = serde_json::to_value(&load)?;
        let t_value = ms(t);
        let t = Instant::now();
        let mut changed = 0usize;
        if let (Some((pb, pv)), true) = (&prev, true) {
            if *pb != bytes {
                if let (Some(a), Some(b)) = (pv.as_object(), value.as_object()) {
                    for (k, bv) in b {
                        match (a.get(k), bv) {
                            (Some(serde_json::Value::Array(x)), serde_json::Value::Array(y)) => {
                                changed += y
                                    .iter()
                                    .enumerate()
                                    .filter(|(i, v)| x.get(*i) != Some(v))
                                    .count()
                            }
                            (Some(x), y) => changed += usize::from(x != y),
                            (None, _) => changed += 1,
                        }
                    }
                }
            }
        }
        let t_cmp = ms(t);
        let _ = changed;
        board_bytes = bytes.len();
        prev = Some((bytes, value));

        // replay the read's statements for the query-only time
        let stmts: Vec<String> = sink.lock().map_err(|e| anyhow::anyhow!("{e}"))?.clone();
        let mut t_query = 0.0;
        let mut t_n1 = 0.0;
        let mut n_n1 = 0usize;
        {
            let mut c = pool.acquire().await?;
            for s in &stmts {
                let t = Instant::now();
                if sqlx::query(s).fetch_all(&mut *c).await.is_ok() {
                    if s.contains('?') {
                        t_n1 += ms(t);
                        n_n1 += 1;
                    } else {
                        t_query += ms(t);
                    }
                }
            }
        }
        if done_presses == 0 {
            println!(
                "(captured {} statements in BoardSources::read, {} with bind parameters)",
                stmts.len(),
                stmts.iter().filter(|s| s.contains('?')).count()
            );
            let mut hist: BTreeMap<String, usize> = BTreeMap::new();
            for q in &stmts {
                let one: String = q.split_whitespace().collect::<Vec<_>>().join(" ");
                *hist.entry(one.chars().take(110).collect()).or_default() += 1;
            }
            let mut top: Vec<_> = hist.into_iter().collect();
            top.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
            for (q, n) in top.iter().take(40) {
                println!("   {n:>5} x {q}");
            }
        }

        if let Some(c) = cpu_now() {
            *cpus.entry(c).or_default() += 1;
        }
        done_presses += 1;
        if done_presses <= warmup {
            continue;
        }
        if std::env::var("EACH").is_ok() {
            println!("each {done_presses} total {:.0} write {t_write:.0} read {t_read:.0} derive {t_derive:.0} cpu {:?} f {}", t_write + t_read + t_derive, cpu_now(), freqs());
        }
        ph.put("gesture open", t_open);
        ph.put("write (step+commit)", t_write);
        ph.put("gesture close", t_close);
        ph.put("blocking", t_blocking);
        ph.put("read total", t_read);
        let _ = n_n1;
        ph.put("  read: set queries", t_query);
        ph.put("  read: N+1 floor", t_n1);
        ph.put("  read: remainder", (t_read - t_query - t_n1).max(0.0));
        ph.put("derive", t_derive);
        ph.put("facts reads", t_facts_read);
        ph.put("facts derive", t_facts);
        ph.put("diff: serialize", t_ser);
        ph.put("diff: to_value", t_value);
        ph.put("diff: compare", t_cmp);
        let pipeline = t_open
            + t_write
            + t_close
            + t_blocking
            + t_read
            + t_derive
            + t_facts_read
            + t_facts
            + t_ser
            + t_cmp;
        ph.put("TOTAL (ser path)", pipeline);
        if done_presses.is_multiple_of(20) {
            println!("  ..{done_presses} presses, {}", freqs());
        }
    }
    println!("\n{presses} measured presses ({warmup} warm-up discarded), refused skipped: {refused}, wall {:.1}s", run_start.elapsed().as_secs_f64());
    println!(
        "board JSON {board_bytes} bytes; cpus the process was on at press end: {cpus:?}; end {}",
        freqs()
    );
    ph.report(&[
        "gesture open",
        "write (step+commit)",
        "gesture close",
        "blocking",
        "read total",
        "  read: set queries",
        "  read: N+1 floor",
        "  read: remainder",
        "derive",
        "facts reads",
        "facts derive",
        "diff: serialize",
        "diff: to_value",
        "diff: compare",
        "TOTAL (ser path)",
    ]);
    let mut u = Phases::default();
    for v in &undo_times {
        u.put("undo one write", *v);
    }
    println!("\nundo ({undo_runs} runs):");
    u.report(&["undo one write"]);
    Ok(())
}

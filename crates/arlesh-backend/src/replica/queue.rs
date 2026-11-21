//! The writes the Replica has predicted and not yet seen settled (ADR 0017, decision 6).
//!
//! A write is run on the Replica first, so the board changes at once, and then sent to the server,
//! one at a time and in order. While any write is pending the rows the server's events carry are
//! held back; when every pending write has been answered and the events have caught up with the
//! answers, the predictions are taken back and the server's rows applied in one step ([`Syncer::settle`]).
//! A refusal does the same and then tries the writes queued behind it again, from the server's
//! board, saying how many were not made. Nothing is queued across a lost connection.
//!
//! The pure parts (what a write's arguments name, which ids a prediction made) are free functions
//! at the top; the rest is the part of the [`Syncer`] that handles them.

use std::{collections::HashSet, sync::Arc, time::Duration};

use arlesh_core::{
    error::WireError,
    nodes::id::RowId,
    replication::{
        replica::{self, JournalRange},
        RowChange,
    },
    undo::model::{GestureId, GestureSummary, StackedGesture},
};
use serde_json::Value;
use tokio::time::Instant;

use super::{source::SourceEvent, sync::Syncer, BoxFuture};
use crate::{
    http::{read_only_error, ReadOnlyReason},
    revision::BoardRevision,
    Backend,
};

/// How long settling waits for the events to reach what the server answered, before it fetches a
/// whole board instead.
pub const SETTLE_WAIT: Duration = Duration::from_secs(5);

/// What the caller of a write is given when the server answers it: run once the Replica is settled.
pub type Deliver = Box<dyn FnOnce() + Send>;
/// Runs a write on the local board; `Ok` means it applied. The typed answer goes to the caller from
/// inside, the first time it runs.
pub type LocalFn =
    Arc<dyn Fn(Arc<dyn Backend>) -> BoxFuture<'static, Result<(), WireError>> + Send + Sync>;
/// Sends a write to the server; the answer is delivered to the caller when the Replica is settled.
pub type RemoteFn =
    Arc<dyn Fn(Arc<dyn Backend>) -> BoxFuture<'static, Result<Deliver, WireError>> + Send + Sync>;
/// Tells the caller a write was refused.
pub type Fail = Box<dyn FnOnce(WireError) + Send>;

/// What a caller asks of the queue.
pub struct Op {
    /// The write on the local board, or `None` for one that is not predicted (it waits its turn).
    pub local: Option<LocalFn>,
    /// The write on the server.
    pub remote: RemoteFn,
    /// Tells the caller of a refusal, when it is waiting for the server's answer.
    pub fail: Option<Fail>,
    /// The write's arguments as JSON: what it names.
    pub args: Value,
    /// When the caller asked: the press timing log's `queue_wait` runs from here.
    pub submitted: std::time::Instant,
    /// Set for an undo: what it does with its answer when it cancels an unsent write instead.
    pub undo: Option<UndoAnswer>,
}

/// An undo that may be answered by cancelling the newest write, unsent.
pub struct UndoAnswer {
    /// Delivers the summary of what was cancelled, or `None` when the press is spent.
    pub answer: Box<dyn FnOnce(Option<GestureSummary>) + Send>,
}

/// What reaches the actor besides the server's events.
pub enum Command {
    /// A write, or a request to the server that waits its turn.
    Submit(Op),
    /// Stops (`true`) or starts following the server.
    Pause(bool),
    /// Answers the board as the server last confirmed it, as a snapshot body.
    Persist(tokio::sync::oneshot::Sender<Option<String>>),
    /// The server answered the write `ticket`, with the newest revision it had stamped by then.
    Answered {
        /// Which write.
        ticket: u64,
        /// The answer to deliver, or the refusal.
        outcome: Result<Deliver, WireError>,
        /// The newest revision the server had stamped.
        stamp: Option<BoardRevision>,
    },
}

/// Why predictions were taken back, for the notice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropReason {
    /// The server refused a write.
    Refused,
    /// The connection was lost.
    Unreachable,
}

/// Writes that were not made, said once per settle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dropped {
    /// How many writes were taken back and not made.
    pub count: usize,
    /// Why.
    pub reason: DropReason,
}

/// Told when writes were dropped: the shell turns it into one toast.
pub type OnDropped = Arc<dyn Fn(Dropped) + Send + Sync>;

#[derive(PartialEq, Eq)]
enum State {
    Queued,
    InFlight,
    Answered,
    Refused,
}

struct Pending {
    ticket: u64,
    op: Op,
    seed: RowId,
    range: Option<JournalRange>,
    provisional: HashSet<String>,
    state: State,
    deliver: Option<Deliver>,
    refusal: Option<WireError>,
    refusals_at_enqueue: u64,
}

/// What the server said while writes were pending: held until they settle.
#[derive(Default)]
struct Buffer {
    rows: Vec<RowChange>,
    position: i64,
    revision: u64,
    last_hash: Option<String>,
    from_agent: bool,
    needs_snapshot: bool,
}

/// The queue's state.
#[derive(Default)]
pub struct Queue {
    pending: std::collections::VecDeque<Pending>,
    buffer: Buffer,
    mark: i64,
    next_ticket: u64,
    refusals: u64,
    parked: Vec<Op>,
    fence: Option<BoardRevision>,
    waiting_since: Option<Instant>,
}

impl Queue {
    /// Starts the buffer again from `position`, after a snapshot.
    pub fn reset_buffer(&mut self, position: i64) {
        self.buffer = Buffer {
            position,
            ..Buffer::default()
        };
    }

    /// Makes the next settle take a whole board.
    pub fn ask_for_snapshot(&mut self) {
        self.buffer.needs_snapshot = true;
    }

    /// Whether any write is pending: the rows the server sends are then held back.
    pub fn holding(&self) -> bool {
        !self.pending.is_empty()
    }
}

/// Every string in `value`, however deep.
pub fn strings_in(value: &Value) -> HashSet<String> {
    let mut found = HashSet::new();
    collect(value, &mut found);
    found
}

fn collect(value: &Value, found: &mut HashSet<String>) {
    match value {
        Value::String(text) => {
            found.insert(text.clone());
        }
        Value::Array(items) => items.iter().for_each(|item| collect(item, found)),
        Value::Object(fields) => fields.values().for_each(|item| collect(item, found)),
        _ => {}
    }
}

/// Whether `args` name any of `ids`: a press on a node whose id a prediction may have made
/// differently from the server.
pub fn names_any(args: &Value, ids: &HashSet<String>) -> bool {
    !ids.is_empty() && strings_in(args).iter().any(|text| ids.contains(text))
}

/// The ids a prediction made that its arguments did not name: the ones the server may have made
/// differently.
pub fn provisional_ids(inserted: Vec<String>, args: &Value) -> HashSet<String> {
    let named = strings_in(args);
    inserted
        .into_iter()
        .filter(|id| !named.contains(id))
        .collect()
}

impl Syncer {
    /// Handles one command.
    pub(super) async fn on_command(&mut self, command: Command) -> Result<(), WireError> {
        match command {
            Command::Submit(op) => {
                self.submit(op).await;
                Ok(())
            }
            Command::Pause(paused) => {
                self.paused = paused;
                if paused {
                    self.abandon_pending(&read_only_error(ReadOnlyReason::ServerUnreachable))
                        .await;
                }
                Ok(())
            }
            Command::Persist(reply) => {
                self.abandon_pending(&read_only_error(ReadOnlyReason::ServerUnreachable))
                    .await;
                let _ = reply.send(self.confirmed_body().await);
                Ok(())
            }
            Command::Answered {
                ticket,
                outcome,
                stamp,
            } => self.answered(ticket, outcome, stamp).await,
        }
    }

    /// Why a write cannot be made now, if it cannot.
    fn refusal(&self) -> Option<WireError> {
        if self.live {
            return None;
        }
        Some(read_only_error(self.down_reason))
    }

    async fn submit(&mut self, mut op: Op) {
        if let Some(error) = self.refusal() {
            if let Some(fail) = op.fail.take() {
                fail(error);
            }
            return;
        }
        if op.undo.is_some() && self.cancel_unsent(&mut op).await {
            return;
        }
        let provisional: HashSet<String> = self
            .queue
            .pending
            .iter()
            .flat_map(|item| item.provisional.iter().cloned())
            .collect();
        if names_any(&op.args, &provisional) {
            self.queue.parked.push(op);
            return;
        }
        match op.local.clone() {
            Some(local) => self.predict(op, local).await,
            None => self.enqueue(
                op,
                arlesh_core::nodes::new_id::new_row_id(),
                None,
                HashSet::new(),
            ),
        }
        self.send_next();
    }

    /// Runs the write on the local board, and queues it for the server when it applied.
    async fn predict(&mut self, mut op: Op, local: LocalFn) {
        let Some(backend) = self.shared.local.borrow().clone() else {
            if let Some(fail) = op.fail.take() {
                fail(read_only_error(ReadOnlyReason::Syncing));
            }
            return;
        };
        let Ok(after) = replica::journal_mark(&self.factory).await else {
            return;
        };
        if !self.queue.holding() {
            self.queue.mark = after;
            self.queue.buffer = Buffer {
                position: self.position,
                ..Buffer::default()
            };
        }
        let queue_wait = op.submitted.elapsed();
        let written = std::time::Instant::now();
        let seed = arlesh_core::nodes::new_id::new_row_id();
        let outcome = super::seeded(seed, local(Arc::clone(&backend) as Arc<dyn Backend>)).await;
        let write = written.elapsed();
        let Ok(through) = replica::journal_mark(&self.factory).await else {
            return;
        };
        let range = (through > after).then_some(JournalRange { after, through });
        if outcome.is_err() {
            // A local refusal: nothing is sent, and whatever it half-wrote is taken back.
            if let Some(range) = range {
                let _ = replica::cancel(&self.factory, range).await;
            }
            return;
        }
        let inserted = match range {
            Some(range) => replica::inserted_ids(&self.factory, range)
                .await
                .unwrap_or_default(),
            None => Vec::new(),
        };
        let provisional = provisional_ids(inserted, &op.args);
        super::press::announce(&self.shared, &backend, queue_wait, write);
        self.enqueue(op, seed, range, provisional);
    }

    fn enqueue(
        &mut self,
        op: Op,
        seed: RowId,
        range: Option<JournalRange>,
        provisional: HashSet<String>,
    ) {
        let ticket = self.queue.next_ticket;
        self.queue.next_ticket += 1;
        self.queue.pending.push_back(Pending {
            ticket,
            op,
            seed,
            range,
            provisional,
            state: State::Queued,
            deliver: None,
            refusal: None,
            refusals_at_enqueue: self.queue.refusals,
        });
    }

    /// Sends the first queued write, when none is on its way and none has been refused.
    pub(super) fn send_next(&mut self) {
        if self
            .queue
            .pending
            .iter()
            .any(|item| matches!(item.state, State::InFlight | State::Refused))
        {
            return;
        }
        let refusals = self.queue.refusals;
        let Some(item) = self
            .queue
            .pending
            .iter_mut()
            .find(|item| item.state == State::Queued)
        else {
            return;
        };
        if item.op.undo.is_some() && item.refusals_at_enqueue != refusals {
            // The write this undo was waiting for was refused: the press is spent.
            let ticket = item.ticket;
            if let Some(undo) = item.op.undo.take() {
                (undo.answer)(None);
            }
            self.queue.pending.retain(|item| item.ticket != ticket);
            self.send_next();
            return;
        }
        item.state = State::InFlight;
        let (ticket, seed, send) = (item.ticket, item.seed, Arc::clone(&item.op.remote));
        let remote = Arc::clone(&self.remote);
        let commands = self.commands_tx.clone();
        tokio::spawn(async move {
            let outcome = super::seeded(seed, send(Arc::clone(&remote))).await;
            let stamp = remote.board_fence().await;
            let _ = commands.send(Command::Answered {
                ticket,
                outcome,
                stamp,
            });
        });
    }

    async fn answered(
        &mut self,
        ticket: u64,
        outcome: Result<Deliver, WireError>,
        stamp: Option<BoardRevision>,
    ) -> Result<(), WireError> {
        if let Some(stamp) = stamp {
            self.note_fence(stamp);
        }
        let Some(item) = self
            .queue
            .pending
            .iter_mut()
            .find(|item| item.ticket == ticket)
        else {
            return Ok(());
        };
        match outcome {
            Ok(deliver) => {
                item.state = State::Answered;
                item.deliver = Some(deliver);
            }
            Err(error) if is_unreachable(&error) => {
                return self.lose_connection(error).await;
            }
            Err(error) => {
                item.state = State::Refused;
                item.refusal = Some(error);
                self.queue.refusals += 1;
            }
        }
        self.queue.waiting_since.get_or_insert_with(Instant::now);
        self.send_next();
        self.try_settle().await
    }

    fn note_fence(&mut self, stamp: BoardRevision) {
        if stamp.epoch != self.epoch {
            self.queue.buffer.needs_snapshot = true;
        }
        let newer = match &self.queue.fence {
            Some(held) if held.epoch == stamp.epoch => held.revision < stamp.revision,
            _ => true,
        };
        if newer {
            self.queue.fence = Some(stamp);
        }
    }

    /// Takes in an event while writes are pending: its rows wait for the settle.
    pub(super) fn hold_event(&mut self, event: SourceEvent) {
        use arlesh_core::replication::rules::apply::{decide, Decision};
        let buffer = &mut self.queue.buffer;
        if event.epoch != self.epoch {
            buffer.needs_snapshot = true;
            return;
        }
        let Some(delta) = event.source else {
            buffer.needs_snapshot = true;
            return;
        };
        match decide(buffer.position, delta.base, delta.upto) {
            Decision::Gap => buffer.needs_snapshot = true,
            Decision::Held => {}
            Decision::Apply { skip_through } => {
                buffer
                    .rows
                    .extend(delta.rows.into_iter().filter(|row| row.seq > skip_through));
                buffer.position = delta.upto;
                buffer.last_hash = Some(delta.hash);
            }
        }
        buffer.revision = buffer.revision.max(event.revision);
        buffer.from_agent |= event.origin.as_deref() == Some("agent");
    }

    /// Settles when every write is answered and the events have reached the answers.
    pub(super) async fn try_settle(&mut self) -> Result<(), WireError> {
        if !self.queue.holding() {
            return Ok(());
        }
        let busy = self
            .queue
            .pending
            .iter()
            .any(|item| matches!(item.state, State::InFlight));
        let refused = self
            .queue
            .pending
            .iter()
            .any(|item| item.state == State::Refused);
        let unfinished = self
            .queue
            .pending
            .iter()
            .any(|item| item.state == State::Queued);
        if busy || (unfinished && !refused) {
            return Ok(());
        }
        let caught_up = self.queue.fence.as_ref().is_none_or(|fence| {
            fence.epoch == self.epoch && self.queue.buffer.revision >= fence.revision
        });
        let waited = self
            .queue
            .waiting_since
            .is_some_and(|since| since.elapsed() >= SETTLE_WAIT);
        if !caught_up && !self.queue.buffer.needs_snapshot && !waited {
            return Ok(());
        }
        if !caught_up {
            self.queue.buffer.needs_snapshot = true;
        }
        self.settle().await
    }

    /// Called every tick: a settle that has waited too long fetches a whole board.
    pub(super) async fn settle_on_tick(&mut self) -> Result<(), WireError> {
        self.try_settle().await
    }

    /// Takes every prediction back and applies what the server said, in one step; delivers each
    /// answer; and tries again, from the server's board, the writes queued behind a refusal.
    async fn settle(&mut self) -> Result<(), WireError> {
        let buffer = std::mem::take(&mut self.queue.buffer);
        let mark = self.queue.mark;
        self.apply_settled(mark, buffer).await?;
        self.queue.fence = None;
        self.queue.waiting_since = None;
        let items: Vec<Pending> = self.queue.pending.drain(..).collect();
        let mut refused = 0usize;
        let mut queued = Vec::new();
        for mut item in items {
            match item.state {
                State::Answered => {
                    if let Some(deliver) = item.deliver.take() {
                        deliver();
                    }
                }
                State::Refused => {
                    refused += 1;
                    if let (Some(fail), Some(error)) = (item.op.fail.take(), item.refusal.take()) {
                        fail(error);
                    }
                }
                State::Queued | State::InFlight => queued.push(item),
            }
        }
        self.queue.mark = replica::journal_mark(&self.factory).await.unwrap_or(0);
        self.queue.buffer = Buffer {
            position: self.position,
            ..Buffer::default()
        };
        let mut dropped = refused;
        for item in queued {
            if !self.replay(item).await {
                dropped += 1;
            }
        }
        if let Some(local) = self.shared.local.borrow().clone() {
            local.record_write();
        }
        if dropped > 0 {
            (self.on_dropped)(Dropped {
                count: dropped,
                reason: DropReason::Refused,
            });
        }
        self.send_next();
        for op in std::mem::take(&mut self.queue.parked) {
            self.submit(op).await;
        }
        Ok(())
    }

    /// Runs a queued write on the settled board again, with its own seed. `false` when it no
    /// longer applies there.
    async fn replay(&mut self, mut item: Pending) -> bool {
        let Some(local) = item.op.local.clone() else {
            item.state = State::Queued;
            self.queue.pending.push_back(item);
            return true;
        };
        let Some(backend) = self.shared.local.borrow().clone() else {
            return false;
        };
        let after = replica::journal_mark(&self.factory).await.unwrap_or(0);
        let outcome = super::seeded(item.seed, local(backend as Arc<dyn Backend>)).await;
        let through = replica::journal_mark(&self.factory).await.unwrap_or(after);
        let range = (through > after).then_some(JournalRange { after, through });
        if outcome.is_err() {
            if let Some(range) = range {
                let _ = replica::cancel(&self.factory, range).await;
            }
            return false;
        }
        item.range = range;
        item.provisional = match range {
            Some(range) => provisional_ids(
                replica::inserted_ids(&self.factory, range)
                    .await
                    .unwrap_or_default(),
                &item.op.args,
            ),
            None => HashSet::new(),
        };
        item.state = State::Queued;
        self.queue.pending.push_back(item);
        true
    }

    /// Replaces the predictions with the buffered rows, or with a snapshot when the buffer cannot
    /// be applied.
    async fn apply_settled(&mut self, mark: i64, buffer: Buffer) -> Result<(), WireError> {
        if buffer.needs_snapshot {
            let snapshot = self.fetch_snapshot().await?;
            replica::settle_with_snapshot(&self.factory, mark, &snapshot.snapshot)
                .await
                .map_err(|error| WireError::internal(error.to_string()))?;
            self.reseed(&snapshot);
            self.agent_origin = true;
            return Ok(());
        }
        replica::settle(&self.factory, mark, &buffer.rows)
            .await
            .map_err(|error| WireError::internal(error.to_string()))?;
        let after = self.tracker.advance(buffer.rows);
        self.position = buffer.position.max(self.position);
        self.note_revision(&self.epoch.clone(), buffer.revision);
        if buffer.last_hash.is_some_and(|hash| hash != after.hash) {
            tracing::error!("the settled rows do not hash as the server said; fetching a snapshot");
            self.needs_snapshot = true;
        }
        self.agent_origin = buffer.from_agent;
        Ok(())
    }

    /// The connection is gone: every prediction is taken back, nothing unsent is kept, and the
    /// board is read-only until the next snapshot says what the server holds.
    pub(super) async fn lose_connection(&mut self, error: WireError) -> Result<(), WireError> {
        self.live = false;
        self.down_reason = ReadOnlyReason::ServerUnreachable;
        let count = self.abandon_pending(&error).await;
        if count > 0 {
            (self.on_dropped)(Dropped {
                count,
                reason: DropReason::Unreachable,
            });
        }
        self.source.reachable(false);
        Err(error)
    }

    /// Takes every pending write back, applying the rows already heard, and tells each caller still
    /// waiting that it was refused with `error`. Answers how many writes there were.
    pub(super) async fn abandon_pending(&mut self, error: &WireError) -> usize {
        if !self.queue.holding() {
            return 0;
        }
        let buffer = std::mem::take(&mut self.queue.buffer);
        let mark = self.queue.mark;
        let rows = if buffer.needs_snapshot {
            Vec::new()
        } else {
            buffer.rows
        };
        let _ = replica::settle(&self.factory, mark, &rows).await;
        // The rows applied were not run through the tracker: the next look at them is a snapshot.
        self.needs_snapshot = true;
        let items: Vec<Pending> = self.queue.pending.drain(..).collect();
        let count = items.len();
        for mut item in items {
            if let Some(fail) = item.op.fail.take() {
                fail(error.clone());
            }
            if let Some(undo) = item.op.undo.take() {
                (undo.answer)(None);
            }
        }
        for mut op in std::mem::take(&mut self.queue.parked) {
            if let Some(fail) = op.fail.take() {
                fail(error.clone());
            }
        }
        self.queue.fence = None;
        self.queue.waiting_since = None;
        if let Some(local) = self.shared.local.borrow().clone() {
            local.record_write();
        }
        count
    }

    /// The press on undo while the newest write is still unsent: cancels it on the Replica and
    /// sends nothing. `false` when it has to go to the server instead.
    async fn cancel_unsent(&mut self, op: &mut Op) -> bool {
        let Some(tail) = self.queue.pending.back() else {
            return false;
        };
        let (State::Queued, Some(range)) = (&tail.state, tail.range) else {
            return false;
        };
        let Ok(entries) = replica::cancel(&self.factory, range).await else {
            return false;
        };
        self.queue.pending.pop_back();
        let summary = StackedGesture::new(GestureId("cancelled".to_owned()), entries)
            .map(|gesture| gesture.summary());
        if let Some(undo) = op.undo.take() {
            (undo.answer)(summary);
        }
        if let Some(local) = self.shared.local.borrow().clone() {
            local.record_write();
        }
        if !self.queue.holding() {
            // Nothing is pending any more: the rows held back apply now.
            let buffer = std::mem::take(&mut self.queue.buffer);
            let mark = self.queue.mark;
            if self.apply_settled(mark, buffer).await.is_ok() {
                if let Some(local) = self.shared.local.borrow().clone() {
                    local.record_write();
                }
            }
        }
        true
    }
}

fn is_unreachable(error: &WireError) -> bool {
    error.details().and_then(|details| details.get("reason"))
        == Some(&serde_json::json!(ReadOnlyReason::ServerUnreachable))
}

#[cfg(test)]
mod tests;

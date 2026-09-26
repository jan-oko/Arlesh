//! The Expectation kind's **overlay**: what makes one derived wait differ from what it is drawn
//! from (migration 0083).
//!
//! A spawned wait is drawn from its Task's Expectation template, a delegation wait from its Task.
//! Each is an ordinary Expectation row (ADR 0008), edited in the ordinary editor, and an edit lands
//! on that one wait, here: the template stays as it is for every other wait it draws. As in every
//! overlay, a NULL column inherits, a `*_set` flag marks a column overridden **to** NULL where NULL
//! is itself a value, and a row that says nothing is deleted rather than kept. Setting a field back
//! to what the wait is drawn with clears the override, so it follows its template again.
//!
//! A spawned wait's status and archive are not here: they were its own from the start, and stay
//! in `spawned_waits` / `occurrence_spawned_waits`. A delegation wait has no state table, so its
//! archive is here; its status is its Task's to say.

use std::collections::HashMap;

use chrono::NaiveDateTime;

use super::overlay::OverlayOperator;
use crate::scopes::key::ScopeKey;
use crate::tasks::model::{DurationSpec, Expectation, ExpectationArchival, TimeScope};
use crate::tasks::waits::{instant_column, instant_from_column};

/// One derived wait's Expectation overlay. Every field inherits when empty.
#[derive(Debug, Clone, Default, PartialEq, Eq, sqlx::FromRow)]
pub struct ExpectationOverlay {
    /// Its own title.
    pub title: Option<String>,
    /// Its own window's start boundary.
    pub time_scope_start_id: Option<ScopeKey>,
    /// Its own window's end boundary.
    pub time_scope_end_id: Option<ScopeKey>,
    /// Its own window's Duration count, when set in that form.
    pub time_scope_duration_n: Option<i64>,
    /// Its own window's Duration kind, when set in that form.
    pub time_scope_duration_kind: Option<String>,
    /// Whether the window above is its own — possibly none at all.
    pub time_scope_set: bool,
    /// Its own Check every's count.
    pub check_every_n: Option<i64>,
    /// Its own Check every's kind.
    pub check_every_kind: Option<String>,
    /// Whether the Check every above is its own — possibly never.
    pub check_every_set: bool,
    /// Its own Starting: when its first check falls due.
    pub check_starting: Option<String>,
    /// Its own privacy.
    pub is_private: Option<bool>,
    /// A delegation wait's archive (a spawned wait keeps its own beside its status).
    pub archival: Option<String>,
    /// Its own agentic flag.
    pub agentic: Option<bool>,
    /// Its own agentic note.
    pub agentic_note: Option<String>,
    /// Whether the note above is its own — possibly none.
    pub agentic_note_set: bool,
    /// Its own question flag.
    pub agentic_question: Option<bool>,
    /// Its own answer.
    pub agentic_answer: Option<String>,
    /// Whether the answer above is its own — possibly none.
    pub agentic_answer_set: bool,
}

/// An Expectation overlay as read back, beside its canonical key.
#[derive(sqlx::FromRow)]
struct KeyedExpectation {
    node_key: String,
    #[sqlx(flatten)]
    overlay: ExpectationOverlay,
}

const EXPECTATION_COLUMNS: &str = "title, time_scope_start_id, time_scope_end_id, \
     time_scope_duration_n, time_scope_duration_kind, time_scope_set, check_every_n, \
     check_every_kind, check_every_set, check_starting, is_private, archival, agentic, \
     agentic_note, agentic_note_set, agentic_question, agentic_answer, agentic_answer_set";

/// Where a derived wait's overlay belongs besides its key: the Habit and occurrence its Task is,
/// when its Task is a Habit occurrence, so the overlay goes with them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WaitHome {
    /// The Habit, for a wait under an occurrence.
    pub flow_id: Option<i64>,
    /// The occurrence's canonical node key.
    pub occurrence_key: Option<String>,
}

/// `value` as an override of `drawn`: none when they agree, so the field follows what it is drawn
/// from again.
fn differing<T: PartialEq>(value: T, drawn: &T) -> Option<T> {
    (value != *drawn).then_some(value)
}

impl ExpectationOverlay {
    /// Whether the row says nothing, so the wait reads exactly as it is drawn.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Its own window, when it has one of its own — `Some(None)` for one overridden to none.
    pub fn time_scope(&self) -> Option<Option<TimeScope>> {
        if !self.time_scope_set {
            return None;
        }
        let (Some(start_id), Some(end_id)) = (self.time_scope_start_id, self.time_scope_end_id)
        else {
            return Some(None);
        };
        let duration = match (self.time_scope_duration_n, &self.time_scope_duration_kind) {
            (Some(n), Some(kind)) => Some(DurationSpec {
                n,
                kind: kind.clone(),
            }),
            _ => None,
        };
        Some(Some(TimeScope {
            start_id,
            end_id,
            duration,
        }))
    }

    /// Its own Check every, when it has one of its own — `Some(None)` for one overridden to never.
    pub fn check_every(&self) -> Option<Option<DurationSpec>> {
        if !self.check_every_set {
            return None;
        }
        Some(match (self.check_every_n, &self.check_every_kind) {
            (Some(n), Some(kind)) => Some(DurationSpec {
                n,
                kind: kind.clone(),
            }),
            _ => None,
        })
    }

    /// Its own Starting, if it has one.
    pub fn check_starting(&self) -> Option<NaiveDateTime> {
        instant_from_column(self.check_starting.clone())
    }

    /// `drawn` — the wait as it is drawn from its template or Task — with this overlay applied.
    /// The window, Check every and Starting are applied by whoever draws the wait, since its checks
    /// are scheduled from them; this sets them again so the row and its checks cannot disagree.
    pub fn apply(&self, drawn: &mut Expectation) {
        if let Some(title) = &self.title {
            drawn.title.clone_from(title);
        }
        if let Some(scope) = self.time_scope() {
            drawn.time_scope = scope;
        }
        if let Some(every) = self.check_every() {
            drawn.check_every = every;
        }
        if let Some(starting) = self.check_starting() {
            drawn.check_starting = Some(starting);
        }
        if let Some(is_private) = self.is_private {
            drawn.is_private = is_private;
        }
        if let Some(archival) = self
            .archival
            .as_deref()
            .and_then(ExpectationArchival::from_db)
        {
            drawn.archival = archival;
        }
        if let Some(agentic) = self.agentic {
            drawn.agentic = agentic;
        }
        if self.agentic_note_set {
            drawn.agentic_note.clone_from(&self.agentic_note);
        }
        if let Some(question) = self.agentic_question {
            drawn.question = question;
        }
        if self.agentic_answer_set {
            drawn.answer.clone_from(&self.agentic_answer);
        }
    }

    /// Records `title` as the wait's own unless it is the drawn one.
    pub fn set_title(&mut self, title: String, drawn: &Expectation) {
        self.title = differing(title, &drawn.title);
    }

    /// Records `scope` as the wait's own window unless it is the drawn one.
    pub fn set_time_scope(&mut self, scope: Option<TimeScope>, drawn: &Expectation) {
        let own = differing(scope, &drawn.time_scope);
        self.time_scope_set = own.is_some();
        let scope = own.flatten();
        self.time_scope_start_id = scope.as_ref().map(|scope| scope.start_id);
        self.time_scope_end_id = scope.as_ref().map(|scope| scope.end_id);
        let duration = scope.and_then(|scope| scope.duration);
        self.time_scope_duration_n = duration.as_ref().map(|spec| spec.n);
        self.time_scope_duration_kind = duration.map(|spec| spec.kind);
    }

    /// Records `every` as the wait's own Check every unless it is the drawn one.
    pub fn set_check_every(&mut self, every: Option<DurationSpec>, drawn: &Expectation) {
        let own = differing(every, &drawn.check_every);
        self.check_every_set = own.is_some();
        let every = own.flatten();
        self.check_every_n = every.as_ref().map(|spec| spec.n);
        self.check_every_kind = every.map(|spec| spec.kind);
    }

    /// Records `starting` as the wait's own Starting unless it falls on the drawn one's day. An
    /// editor names a day, not an instant, so a save that repeats the day it was shown changes
    /// nothing.
    pub fn set_check_starting(&mut self, starting: NaiveDateTime, drawn: &Expectation) {
        let same_day = drawn
            .check_starting
            .is_some_and(|drawn| drawn.date() == starting.date());
        self.check_starting = (!same_day).then(|| instant_column(starting));
    }

    /// Records `is_private` as the wait's own unless it is the drawn one.
    pub fn set_is_private(&mut self, is_private: bool, drawn: &Expectation) {
        self.is_private = differing(is_private, &drawn.is_private);
    }

    /// Records `archival` as a delegation wait's own unless it is the drawn one.
    pub fn set_archival(&mut self, archival: ExpectationArchival, drawn: &Expectation) {
        self.archival = differing(archival, &drawn.archival).map(|own| own.as_str().to_string());
    }

    /// Records the agentic flag as the wait's own unless it is the drawn one.
    pub fn set_agentic(&mut self, agentic: bool, drawn: &Expectation) {
        self.agentic = differing(agentic, &drawn.agentic);
    }

    /// Records the agentic note as the wait's own unless it is the drawn one.
    pub fn set_agentic_note(&mut self, note: Option<String>, drawn: &Expectation) {
        let own = differing(note, &drawn.agentic_note);
        self.agentic_note_set = own.is_some();
        self.agentic_note = own.flatten();
    }

    /// Records the question flag as the wait's own unless it is the drawn one.
    pub fn set_question(&mut self, question: bool, drawn: &Expectation) {
        self.agentic_question = differing(question, &drawn.question);
    }

    /// Records the answer as the wait's own unless it is the drawn one.
    pub fn set_answer(&mut self, answer: Option<String>, drawn: &Expectation) {
        let own = differing(answer, &drawn.answer);
        self.agentic_answer_set = own.is_some();
        self.agentic_answer = own.flatten();
    }
}

impl OverlayOperator<'_> {
    /// Every derived wait's Expectation overlay, by node key.
    pub async fn expectations(
        &mut self,
    ) -> Result<HashMap<String, ExpectationOverlay>, sqlx::Error> {
        let rows: Vec<KeyedExpectation> = sqlx::query_as(&format!(
            "SELECT node_key, {EXPECTATION_COLUMNS} FROM expectation_overlays"
        ))
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.node_key, row.overlay))
            .collect())
    }

    /// One derived wait's Expectation overlay, empty when it has none.
    pub async fn expectation(&mut self, node_key: &str) -> Result<ExpectationOverlay, sqlx::Error> {
        Ok(sqlx::query_as(&format!(
            "SELECT {EXPECTATION_COLUMNS} FROM expectation_overlays WHERE node_key = ?"
        ))
        .bind(node_key)
        .fetch_optional(&mut *self.connection)
        .await?
        .unwrap_or_default())
    }

    /// Replaces one derived wait's Expectation overlay; an empty one deletes the row.
    pub async fn put_expectation(
        &mut self,
        node_key: &str,
        home: &WaitHome,
        overlay: &ExpectationOverlay,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM expectation_overlays WHERE node_key = ?")
            .bind(node_key)
            .execute(&mut *self.connection)
            .await?;
        if overlay.is_empty() {
            return Ok(());
        }
        sqlx::query(&format!(
            "INSERT INTO expectation_overlays (node_key, flow_id, occurrence_key, {EXPECTATION_COLUMNS})
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(node_key)
        .bind(home.flow_id)
        .bind(&home.occurrence_key)
        .bind(&overlay.title)
        .bind(overlay.time_scope_start_id)
        .bind(overlay.time_scope_end_id)
        .bind(overlay.time_scope_duration_n)
        .bind(&overlay.time_scope_duration_kind)
        .bind(overlay.time_scope_set)
        .bind(overlay.check_every_n)
        .bind(&overlay.check_every_kind)
        .bind(overlay.check_every_set)
        .bind(&overlay.check_starting)
        .bind(overlay.is_private)
        .bind(&overlay.archival)
        .bind(overlay.agentic)
        .bind(&overlay.agentic_note)
        .bind(overlay.agentic_note_set)
        .bind(overlay.agentic_question)
        .bind(&overlay.agentic_answer)
        .bind(overlay.agentic_answer_set)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Forgets the overlays of the waits a stored Task that is going drew.
    pub async fn forget_task_waits(&mut self, task_id: i64) -> Result<(), sqlx::Error> {
        for kind in ["spawned_wait", "delegation_wait"] {
            let key = format!("{kind}:{task_id}");
            sqlx::query("DELETE FROM expectation_overlays WHERE node_key = ?")
                .bind(&key)
                .execute(&mut *self.connection)
                .await?;
            sqlx::query("DELETE FROM derived_tags WHERE node_key = ?")
                .bind(&key)
                .execute(&mut *self.connection)
                .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

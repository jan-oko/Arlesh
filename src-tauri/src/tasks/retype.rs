//! The retype **transfer plan**: what survives a node changing kind, and what cannot.
//!
//! Retyping moves a node between tables — a goal row becomes a task row, a task row becomes a
//! domain row — and the two tables never hold the same set of columns. Something is therefore
//! usually dropped, and until this module existed the frontend dropped it silently.
//!
//! Everything here is **pure**: it takes the source row, its direct children and the target kind
//! as values, and returns what would carry, which children the target cannot hold, and which
//! fields have no counterpart. No database, so the whole decision table is unit-testable and the
//! command in [`crate::commands::retype`] is left with nothing to decide — only to execute.
//!
//! The child-nesting table below mirrors `ALLOWED_CHILD_KINDS` in `src/utils/node-meta.ts`, which
//! is the same product rule read from the other end: the frontend uses it to *hide* a retype that
//! would strand a child, and this module uses it to *name* the ones it would strand anyway.

use serde::{Deserialize, Serialize};

use super::model::{GoalStatus, OnScopeExit, TaskStatus, TimeScope};

/// A kind a node can be retyped from, and to.
///
/// The five kinds that live in the `goals`, `tasks` and `domains` tables. Infos and flows are
/// child kinds only — see [`ChildKind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetypeKind {
    /// A desired state, in `goals`.
    Goal,
    /// An action item, in `tasks`.
    Task,
    /// A general-purpose container, in `domains` with subtype `domain`.
    Domain,
    /// A large domain with an optional Obsidian directory, in `domains` with subtype `project`.
    Project,
    /// A flat label, in `domains` with subtype `tag`.
    Tag,
}

impl RetypeKind {
    /// The string this kind is spelled with in a `subtype` or `parent_type` column.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Goal => "goal",
            Self::Task => "task",
            Self::Domain => "domain",
            Self::Project => "project",
            Self::Tag => "tag",
        }
    }

    /// Parses the column spelling, if it names a retypeable kind.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "goal" => Some(Self::Goal),
            "task" => Some(Self::Task),
            "domain" => Some(Self::Domain),
            "project" => Some(Self::Project),
            "tag" => Some(Self::Tag),
            _ => None,
        }
    }

    /// Whether this kind's row lives in the `domains` table, where a retype between two of them
    /// is a `subtype` update rather than a move to another table.
    pub fn is_domain_table(self) -> bool {
        matches!(self, Self::Domain | Self::Project | Self::Tag)
    }

    /// Whether this kind can hold `child` as a direct child.
    ///
    /// Mirrors `ALLOWED_CHILD_KINDS` in `src/utils/node-meta.ts`, which in turn reads off the
    /// `parent_type` CHECK constraints: goals take `project|goal|domain`, tasks add `task`, flows
    /// take `aspect|project|domain|goal`, infos nest under anything, a Project needs an Aspect or
    /// Project above it, and a Tag is a label that holds only notes.
    pub fn accepts_child(self, child: ChildKind) -> bool {
        match self {
            Self::Project => true,
            Self::Domain => child != ChildKind::Project,
            Self::Tag => child == ChildKind::Info,
            Self::Goal => matches!(
                child,
                ChildKind::Goal | ChildKind::Task | ChildKind::Info | ChildKind::Flow
            ),
            Self::Task => matches!(child, ChildKind::Task | ChildKind::Info),
        }
    }

    /// Which status vocabulary this kind's `status` column speaks, if any.
    fn status_vocabulary(self) -> Option<StatusVocabulary> {
        match self {
            Self::Goal | Self::Project => Some(StatusVocabulary::GoalLike),
            Self::Task => Some(StatusVocabulary::TaskLike),
            Self::Domain | Self::Tag => None,
        }
    }
}

/// A direct child's kind: every [`RetypeKind`], plus the two kinds that can hang off a node
/// without being retypeable themselves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChildKind {
    /// A goal child.
    Goal,
    /// A task child.
    Task,
    /// A domain child.
    Domain,
    /// A project child.
    Project,
    /// A tag child.
    Tag,
    /// A free-standing note.
    Info,
    /// A flow template rooted under this node.
    Flow,
}

impl ChildKind {
    /// The string this kind is spelled with in a `parent_type` column.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Goal => "goal",
            Self::Task => "task",
            Self::Domain => "domain",
            Self::Project => "project",
            Self::Tag => "tag",
            Self::Info => "info",
            Self::Flow => "flow",
        }
    }
}

impl From<RetypeKind> for ChildKind {
    fn from(kind: RetypeKind) -> Self {
        match kind {
            RetypeKind::Goal => Self::Goal,
            RetypeKind::Task => Self::Task,
            RetypeKind::Domain => Self::Domain,
            RetypeKind::Project => Self::Project,
            RetypeKind::Tag => Self::Tag,
        }
    }
}

/// The two status vocabularies a node's `status` column can speak.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StatusVocabulary {
    /// `active | achieved | frozen | archived` — goals and projects.
    GoalLike,
    /// `todo | in_progress | done` — tasks.
    TaskLike,
}

/// One direct child of the node being retyped, as the plan needs to see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChildNode {
    /// The child's kind.
    pub kind: ChildKind,
    /// The child row's primary key.
    pub id: i64,
    /// The child's display title, so a prompt can name it.
    pub title: String,
}

/// Everything a retype can read off the node being retyped, whichever table it lives in.
///
/// Fields a given kind does not have are simply `None` (a domain has no Time Scope, a goal has no
/// Plan). Assembling one is the command's job; deciding what happens to it is this module's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceNode {
    /// The kind being retyped away from.
    pub kind: RetypeKind,
    /// The source row's primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Sort position among siblings.
    pub position: i64,
    /// Whether the node is hidden outside Private Mode.
    pub is_private: bool,
    /// Raw status, in the source kind's vocabulary; `None` for kinds that have no status.
    pub status: Option<String>,
    /// Longer description (domain-table kinds only).
    pub description: Option<String>,
    /// Linked Obsidian directory (projects only).
    pub knowledge_base_directory: Option<String>,
    /// Relevance window (goals and tasks only).
    pub time_scope: Option<TimeScope>,
    /// What happens when the Time Scope passes; set iff `time_scope` is.
    pub on_scope_exit: Option<OnScopeExit>,
    /// Scheduling window (tasks only).
    pub plan: Option<TimeScope>,
    /// Person this task is delegated to (tasks only).
    pub delegate_to: Option<i64>,
    /// Tag domain ids attached to the node (goals and tasks only).
    pub tag_ids: Vec<i64>,
    /// Explicit block reasons (goals and tasks only).
    pub block_reasons: Vec<String>,
}

/// The field values that survive onto the new node, already translated into the target's
/// vocabulary.
///
/// A field the target has no column for is absent here and named in
/// [`TransferPlan::lost_fields`] instead — the two are complements, so nothing can fall between
/// them unnoticed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Carried {
    /// Display title — carries to every kind.
    pub title: String,
    /// Sort position — carries to every kind.
    pub position: i64,
    /// Privacy flag — carries to every kind. (`convert_flow_item`, the precedent for the rest of
    /// this design, drops its equivalent; that bug is deliberately not copied.)
    pub is_private: bool,
    /// Status in the **target's** vocabulary, when both kinds have one.
    pub status: Option<String>,
    /// Description, when the target is a domain-table kind.
    pub description: Option<String>,
    /// Linked Obsidian directory, when the target is a project.
    pub knowledge_base_directory: Option<String>,
    /// Relevance window, when the target is a goal or a task.
    pub time_scope: Option<TimeScope>,
    /// On-exit behaviour; rides with `time_scope` and is never carried without it.
    pub on_scope_exit: Option<OnScopeExit>,
    /// Scheduling window, when the target is a task.
    pub plan: Option<TimeScope>,
    /// Delegate, when the target is a task.
    pub delegate_to: Option<i64>,
    /// Tag attachments, when the target is a goal or a task.
    pub tag_ids: Vec<i64>,
    /// Explicit block reasons, when the target is a goal or a task.
    pub block_reasons: Vec<String>,
}

/// A field of the source node the target kind has no counterpart for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LostField {
    /// Stable field identifier, doubling as the i18n key suffix the frontend renders it with.
    pub field: &'static str,
    /// A short rendering of the value that would be dropped, so the prompt can say what is at
    /// stake rather than only which field is.
    pub value: String,
}

/// What retyping a node to a given kind would carry, strand and drop.
///
/// Produced by [`plan_retype`] and consumed twice: once to decide whether the caller must confirm
/// ([`TransferPlan::loses_anything`]), and once to execute the write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferPlan {
    /// The kind being retyped to.
    pub target: RetypeKind,
    /// Field values that survive, in the target's vocabulary.
    pub carried: Carried,
    /// Children the target can hold, which move onto the new node.
    pub moved_children: Vec<ChildNode>,
    /// Children the target cannot hold, which the retype would strand.
    pub lost_children: Vec<ChildNode>,
    /// Fields with no counterpart on the target.
    pub lost_fields: Vec<LostField>,
}

impl TransferPlan {
    /// Whether anything at all would be lost — a child or a field.
    ///
    /// The consent rule is deliberately **uniform**: the command refuses until the caller
    /// acknowledges, whether what is at stake is a subtree or a single dropped column. Splitting
    /// it (consent for children, a notification for fields) is the documented fallback if the
    /// prompt proves too noisy in practice.
    pub fn loses_anything(&self) -> bool {
        !self.lost_children.is_empty() || !self.lost_fields.is_empty()
    }

    /// The losses as the `details` payload of a `needs_confirmation` wire error.
    ///
    /// Shape: `{ "lost_children": [{ kind, id, title }], "lost_fields": [{ field, value }] }`.
    /// Both keys are always present, so the frontend can render each list without probing.
    pub fn details(&self) -> serde_json::Value {
        serde_json::json!({
            "lost_children": self.lost_children,
            "lost_fields": self.lost_fields,
        })
    }
}

/// Decides what retyping `source` (with these direct `children`) to `target` would do.
///
/// Pure: the caller reads the rows, this decides, the caller writes. Same-kind input is not
/// rejected here — it simply plans a retype that carries everything, and the command
/// short-circuits it.
pub fn plan_retype(source: &SourceNode, children: &[ChildNode], target: RetypeKind) -> TransferPlan {
    let (moved_children, lost_children) = children
        .iter()
        .cloned()
        .partition(|child| target.accepts_child(child.kind));

    let mut lost_fields = Vec::new();
    let carried = carry_fields(source, target, &mut lost_fields);

    TransferPlan {
        target,
        carried,
        moved_children,
        lost_children,
        lost_fields,
    }
}

/// Splits the source's fields into what the target can hold and what it cannot, appending every
/// drop to `lost_fields`.
///
/// One arm per field, in declaration order, so the mapping table is readable as a list and a new
/// column added to either table has an obvious place to be handled.
fn carry_fields(
    source: &SourceNode,
    target: RetypeKind,
    lost_fields: &mut Vec<LostField>,
) -> Carried {
    let scoped_target = matches!(target, RetypeKind::Goal | RetypeKind::Task);
    let domain_target = target.is_domain_table();

    // Status: translated when both kinds have a vocabulary, dropped when the target has none.
    // A status still at its kind's default carries no user intent, so losing it is not reported.
    let status = match (&source.status, target.status_vocabulary()) {
        (Some(status), Some(_)) => translate_status(source.kind, target, status),
        (Some(status), None) => {
            if !is_default_status(source.kind, status) {
                lost_fields.push(LostField {
                    field: "status",
                    value: status.clone(),
                });
            }
            None
        }
        (None, _) => None,
    };

    let description = keep_if(
        domain_target,
        source.description.clone(),
        "description",
        |value: &String| truncate(value),
        lost_fields,
    );

    let knowledge_base_directory = keep_if(
        target == RetypeKind::Project,
        source.knowledge_base_directory.clone(),
        "knowledge_base_directory",
        |value: &String| value.clone(),
        lost_fields,
    );

    // `on_scope_exit` is NULL exactly when `time_scope` is, so it rides with the window rather
    // than being named as a second loss for the same concept.
    let time_scope = keep_if(
        scoped_target,
        source.time_scope.clone(),
        "time_scope",
        render_time_scope,
        lost_fields,
    );
    let on_scope_exit = if time_scope.is_some() {
        source.on_scope_exit
    } else {
        None
    };

    let plan = keep_if(
        target == RetypeKind::Task,
        source.plan.clone(),
        "plan",
        render_time_scope,
        lost_fields,
    );

    let delegate_to = keep_if(
        target == RetypeKind::Task,
        source.delegate_to,
        "delegate_to",
        |value: &i64| value.to_string(),
        lost_fields,
    );

    let tag_ids = keep_list(
        scoped_target,
        &source.tag_ids,
        "tags",
        |tags| tags.len().to_string(),
        lost_fields,
    );

    let block_reasons = keep_list(
        scoped_target,
        &source.block_reasons,
        "block_reasons",
        |reasons| truncate(&reasons.join("; ")),
        lost_fields,
    );

    Carried {
        title: source.title.clone(),
        position: source.position,
        is_private: source.is_private,
        status,
        description,
        knowledge_base_directory,
        time_scope,
        on_scope_exit,
        plan,
        delegate_to,
        tag_ids,
        block_reasons,
    }
}

/// Keeps an optional field when the target has a column for it, and records the drop when it does
/// not. An absent source value is never a loss.
fn keep_if<T>(
    target_has_it: bool,
    value: Option<T>,
    field: &'static str,
    render: impl Fn(&T) -> String,
    lost_fields: &mut Vec<LostField>,
) -> Option<T> {
    match value {
        Some(value) if target_has_it => Some(value),
        Some(value) => {
            lost_fields.push(LostField {
                field,
                value: render(&value),
            });
            None
        }
        None => None,
    }
}

/// [`keep_if`] for a collection field, where "absent" means empty rather than `None`.
fn keep_list<T: Clone>(
    target_has_it: bool,
    values: &[T],
    field: &'static str,
    render: impl Fn(&[T]) -> String,
    lost_fields: &mut Vec<LostField>,
) -> Vec<T> {
    if values.is_empty() {
        return Vec::new();
    }
    if target_has_it {
        return values.to_vec();
    }
    lost_fields.push(LostField {
        field,
        value: render(values),
    });
    Vec::new()
}

/// Translates a status between the two vocabularies, per SPEC's type-cycling rules. Mirrors
/// `goalStatusToTaskStatus`/`taskStatusToGoalStatus` in `src/utils/status-mapping.ts`, which the
/// frontend still uses to preview the remap in a toast before the call.
fn translate_status(source: RetypeKind, target: RetypeKind, status: &str) -> Option<String> {
    match (source.status_vocabulary()?, target.status_vocabulary()?) {
        (StatusVocabulary::GoalLike, StatusVocabulary::TaskLike) => {
            Some(goal_status_to_task_status(status).as_str().to_string())
        }
        (StatusVocabulary::TaskLike, StatusVocabulary::GoalLike) => {
            Some(task_status_to_goal_status(status).as_str().to_string())
        }
        // Goal↔Project and Task↔Task speak the same vocabulary, so the value passes through.
        _ => Some(status.to_string()),
    }
}

/// A goal/project status as the nearest task status: only an achieved goal is a done task.
fn goal_status_to_task_status(status: &str) -> TaskStatus {
    if status == GoalStatus::Achieved.as_str() {
        TaskStatus::Done
    } else {
        TaskStatus::Todo
    }
}

/// A task status as the nearest goal/project status.
fn task_status_to_goal_status(status: &str) -> GoalStatus {
    if status == TaskStatus::Done.as_str() {
        return GoalStatus::Achieved;
    }
    // `blocked` is not one of the three statuses the `tasks` CHECK constraint allows, so this arm
    // is unreachable from stored data. It is kept because `status-mapping.ts` has it, and the two
    // must agree for the frontend's preview toast to match what the backend then writes.
    if status == "blocked" {
        return GoalStatus::Frozen;
    }
    GoalStatus::Active
}

/// Whether a status is the value its kind takes when nobody has chosen one.
fn is_default_status(kind: RetypeKind, status: &str) -> bool {
    match kind.status_vocabulary() {
        Some(StatusVocabulary::GoalLike) => status == GoalStatus::Active.as_str(),
        Some(StatusVocabulary::TaskLike) => status == TaskStatus::Todo.as_str(),
        None => false,
    }
}

/// A Time Scope as a short phrase for a confirmation prompt: its Duration form when it has one,
/// otherwise its boundary scope ids.
fn render_time_scope(scope: &TimeScope) -> String {
    match &scope.duration {
        Some(duration) => format!("{} {}", duration.n, duration.kind),
        None if scope.start_id == scope.end_id => scope.start_id.to_string(),
        None => format!("{}–{}", scope.start_id, scope.end_id),
    }
}

/// Clips a free-text value to a length a prompt can show on one line.
fn truncate(value: &str) -> String {
    const LIMIT: usize = 40;
    if value.chars().count() <= LIMIT {
        return value.to_string();
    }
    let head: String = value.chars().take(LIMIT).collect();
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::model::DurationSpec;

    fn goal(id: i64) -> SourceNode {
        SourceNode {
            kind: RetypeKind::Goal,
            id,
            title: "Ship it".into(),
            position: 17,
            is_private: true,
            status: Some("active".into()),
            description: None,
            knowledge_base_directory: None,
            time_scope: None,
            on_scope_exit: None,
            plan: None,
            delegate_to: None,
            tag_ids: vec![],
            block_reasons: vec![],
        }
    }

    fn task(id: i64) -> SourceNode {
        SourceNode {
            kind: RetypeKind::Task,
            status: Some("todo".into()),
            ..goal(id)
        }
    }

    fn project(id: i64) -> SourceNode {
        SourceNode {
            kind: RetypeKind::Project,
            status: Some("active".into()),
            description: Some("The big one".into()),
            ..goal(id)
        }
    }

    fn window(start_id: i64, end_id: i64) -> TimeScope {
        TimeScope {
            start_id,
            end_id,
            duration: None,
        }
    }

    fn child(kind: ChildKind, id: i64) -> ChildNode {
        ChildNode {
            kind,
            id,
            title: format!("{} {id}", kind.as_str()),
        }
    }

    fn lost_field_names(plan: &TransferPlan) -> Vec<&'static str> {
        plan.lost_fields.iter().map(|lost| lost.field).collect()
    }

    fn lost_child_kinds(plan: &TransferPlan) -> Vec<ChildKind> {
        plan.lost_children.iter().map(|child| child.kind).collect()
    }

    // --- goal → task ---

    #[test]
    fn a_goal_becoming_a_task_carries_scope_exit_behaviour_tags_reasons_privacy_and_position() {
        let source = SourceNode {
            time_scope: Some(window(3, 5)),
            on_scope_exit: Some(OnScopeExit::Archive),
            tag_ids: vec![7, 9],
            block_reasons: vec!["waiting on Ana".into()],
            ..goal(1)
        };

        let plan = plan_retype(&source, &[], RetypeKind::Task);

        assert_eq!(plan.carried.time_scope, Some(window(3, 5)));
        assert_eq!(plan.carried.on_scope_exit, Some(OnScopeExit::Archive));
        assert_eq!(plan.carried.tag_ids, vec![7, 9]);
        assert_eq!(plan.carried.block_reasons, vec!["waiting on Ana".to_string()]);
        assert!(plan.carried.is_private, "privacy carries");
        assert_eq!(plan.carried.position, 17);
        assert_eq!(plan.carried.title, "Ship it");
        assert!(!plan.loses_anything(), "nothing on a goal is foreign to a task");
    }

    #[test]
    fn a_goal_becoming_a_task_maps_achieved_to_done() {
        let source = SourceNode {
            status: Some("achieved".into()),
            ..goal(1)
        };
        let plan = plan_retype(&source, &[], RetypeKind::Task);
        assert_eq!(plan.carried.status, Some("done".to_string()));
    }

    #[test]
    fn a_goal_becoming_a_task_maps_every_unachieved_status_to_todo() {
        for status in ["active", "frozen", "archived"] {
            let source = SourceNode {
                status: Some(status.into()),
                ..goal(1)
            };
            let plan = plan_retype(&source, &[], RetypeKind::Task);
            assert_eq!(plan.carried.status, Some("todo".to_string()), "from {status}");
        }
    }

    #[test]
    fn a_goal_becoming_a_task_strands_its_goal_children_and_keeps_the_rest() {
        let children = [
            child(ChildKind::Goal, 2),
            child(ChildKind::Task, 3),
            child(ChildKind::Info, 4),
            child(ChildKind::Flow, 5),
        ];

        let plan = plan_retype(&goal(1), &children, RetypeKind::Task);

        assert_eq!(
            lost_child_kinds(&plan),
            vec![ChildKind::Goal, ChildKind::Flow],
            "a task can hold neither a sub-goal nor a flow"
        );
        assert_eq!(
            plan.moved_children.iter().map(|c| c.kind).collect::<Vec<_>>(),
            vec![ChildKind::Task, ChildKind::Info]
        );
        assert!(plan.loses_anything());
    }

    // --- task → goal ---

    #[test]
    fn a_task_becoming_a_goal_maps_done_to_achieved() {
        let source = SourceNode {
            status: Some("done".into()),
            ..task(1)
        };
        let plan = plan_retype(&source, &[], RetypeKind::Goal);
        assert_eq!(plan.carried.status, Some("achieved".to_string()));
    }

    #[test]
    fn a_task_becoming_a_goal_maps_todo_and_in_progress_to_active() {
        for status in ["todo", "in_progress"] {
            let source = SourceNode {
                status: Some(status.into()),
                ..task(1)
            };
            let plan = plan_retype(&source, &[], RetypeKind::Goal);
            assert_eq!(plan.carried.status, Some("active".to_string()), "from {status}");
        }
    }

    #[test]
    fn a_task_becoming_a_goal_loses_its_plan_and_its_delegate() {
        let source = SourceNode {
            time_scope: Some(window(3, 5)),
            on_scope_exit: Some(OnScopeExit::Keep),
            plan: Some(window(4, 4)),
            delegate_to: Some(12),
            ..task(1)
        };

        let plan = plan_retype(&source, &[], RetypeKind::Goal);

        assert_eq!(lost_field_names(&plan), vec!["plan", "delegate_to"]);
        assert_eq!(plan.carried.plan, None);
        assert_eq!(plan.carried.delegate_to, None);
        assert_eq!(
            plan.carried.time_scope,
            Some(window(3, 5)),
            "the Time Scope is not the Plan and does carry"
        );
        assert_eq!(plan.carried.on_scope_exit, Some(OnScopeExit::Keep));
    }

    #[test]
    fn a_task_with_no_plan_and_no_delegate_becoming_a_goal_loses_nothing() {
        let plan = plan_retype(&task(1), &[child(ChildKind::Task, 2)], RetypeKind::Goal);
        assert!(!plan.loses_anything());
        assert_eq!(plan.lost_fields, Vec::<LostField>::new());
    }

    #[test]
    fn a_task_becoming_a_goal_keeps_a_flow_child_a_task_could_not_hold() {
        let plan = plan_retype(&task(1), &[child(ChildKind::Flow, 2)], RetypeKind::Goal);
        assert_eq!(lost_child_kinds(&plan), Vec::<ChildKind>::new());
    }

    // --- the domain-table pairs ---

    #[test]
    fn a_project_becoming_a_domain_loses_its_obsidian_directory() {
        let source = SourceNode {
            knowledge_base_directory: Some("Projects/Arlesh".into()),
            ..project(1)
        };

        let plan = plan_retype(&source, &[], RetypeKind::Domain);

        assert_eq!(lost_field_names(&plan), vec!["knowledge_base_directory"]);
        assert_eq!(plan.carried.description, Some("The big one".to_string()));
    }

    #[test]
    fn a_project_becoming_a_domain_strands_a_project_child() {
        let children = [child(ChildKind::Project, 2), child(ChildKind::Domain, 3)];
        let plan = plan_retype(&project(1), &children, RetypeKind::Domain);
        assert_eq!(
            lost_child_kinds(&plan),
            vec![ChildKind::Project],
            "a Project needs an Aspect or Project above it"
        );
    }

    #[test]
    fn a_domain_becoming_a_project_carries_its_description_and_loses_nothing() {
        let source = SourceNode {
            kind: RetypeKind::Domain,
            status: None,
            description: Some("Notes".into()),
            ..goal(1)
        };

        let plan = plan_retype(&source, &[child(ChildKind::Tag, 2)], RetypeKind::Project);

        assert_eq!(plan.carried.description, Some("Notes".to_string()));
        assert!(!plan.loses_anything());
    }

    #[test]
    fn a_domain_becoming_a_goal_loses_its_description_and_strands_its_domain_children() {
        let source = SourceNode {
            kind: RetypeKind::Domain,
            status: None,
            description: Some("Notes".into()),
            ..goal(1)
        };
        let children = [
            child(ChildKind::Domain, 2),
            child(ChildKind::Tag, 3),
            child(ChildKind::Goal, 4),
        ];

        let plan = plan_retype(&source, &children, RetypeKind::Goal);

        assert_eq!(lost_field_names(&plan), vec!["description"]);
        assert_eq!(
            lost_child_kinds(&plan),
            vec![ChildKind::Domain, ChildKind::Tag],
            "the console.warn(… orphaned) case, now named instead of logged"
        );
    }

    #[test]
    fn a_goal_becoming_a_project_keeps_its_status_and_loses_scope_tags_and_reasons() {
        let source = SourceNode {
            status: Some("frozen".into()),
            time_scope: Some(window(3, 5)),
            on_scope_exit: Some(OnScopeExit::Keep),
            tag_ids: vec![7],
            block_reasons: vec!["waiting".into()],
            ..goal(1)
        };

        let plan = plan_retype(&source, &[], RetypeKind::Project);

        assert_eq!(
            plan.carried.status,
            Some("frozen".to_string()),
            "a project speaks the same status vocabulary as a goal"
        );
        assert_eq!(
            lost_field_names(&plan),
            vec!["time_scope", "tags", "block_reasons"]
        );
        assert_eq!(plan.carried.on_scope_exit, None, "the exit behaviour goes with the window");
    }

    #[test]
    fn a_goal_becoming_a_tag_strands_every_child_that_is_not_a_note() {
        let children = [
            child(ChildKind::Goal, 2),
            child(ChildKind::Task, 3),
            child(ChildKind::Info, 4),
        ];

        let plan = plan_retype(&goal(1), &children, RetypeKind::Tag);

        assert_eq!(lost_child_kinds(&plan), vec![ChildKind::Goal, ChildKind::Task]);
        assert_eq!(
            plan.moved_children.iter().map(|c| c.kind).collect::<Vec<_>>(),
            vec![ChildKind::Info]
        );
    }

    #[test]
    fn a_tag_becoming_a_domain_carries_its_description() {
        let source = SourceNode {
            kind: RetypeKind::Tag,
            status: None,
            description: Some("Reading".into()),
            ..goal(1)
        };
        let plan = plan_retype(&source, &[], RetypeKind::Domain);
        assert_eq!(plan.carried.description, Some("Reading".to_string()));
        assert!(!plan.loses_anything());
    }

    // --- the loss rule itself ---

    #[test]
    fn a_status_still_at_its_default_is_not_reported_as_lost() {
        let plan = plan_retype(&goal(1), &[], RetypeKind::Domain);
        assert_eq!(lost_field_names(&plan), Vec::<&str>::new(), "an untouched `active` says nothing");

        let chosen = SourceNode {
            status: Some("archived".into()),
            ..goal(1)
        };
        let plan = plan_retype(&chosen, &[], RetypeKind::Domain);
        assert_eq!(lost_field_names(&plan), vec!["status"]);
    }

    #[test]
    fn an_empty_tag_list_is_not_reported_as_lost() {
        let source = SourceNode {
            tag_ids: vec![],
            block_reasons: vec![],
            ..goal(1)
        };
        let plan = plan_retype(&source, &[], RetypeKind::Domain);
        assert!(!plan.loses_anything());
    }

    #[test]
    fn the_details_payload_names_every_lost_child_and_field() {
        let source = SourceNode {
            plan: Some(window(4, 4)),
            ..task(1)
        };
        let plan = plan_retype(&source, &[child(ChildKind::Info, 2)], RetypeKind::Goal);

        assert_eq!(
            plan.details(),
            serde_json::json!({
                "lost_children": [],
                "lost_fields": [{ "field": "plan", "value": "4" }],
            })
        );
    }

    #[test]
    fn a_duration_shaped_window_is_rendered_in_duration_form() {
        let source = SourceNode {
            plan: Some(TimeScope {
                start_id: 4,
                end_id: 6,
                duration: Some(DurationSpec {
                    n: 3,
                    kind: "week".into(),
                }),
            }),
            ..task(1)
        };
        let plan = plan_retype(&source, &[], RetypeKind::Goal);
        assert_eq!(plan.lost_fields[0].value, "3 week");
    }

    #[test]
    fn a_long_block_reason_list_is_clipped_for_the_prompt() {
        let source = SourceNode {
            block_reasons: vec!["a".repeat(60)],
            ..goal(1)
        };
        let plan = plan_retype(&source, &[], RetypeKind::Domain);
        assert_eq!(plan.lost_fields[0].value, format!("{}…", "a".repeat(40)));
    }

    #[test]
    fn retyping_to_the_same_kind_carries_everything() {
        let source = SourceNode {
            time_scope: Some(window(3, 5)),
            plan: Some(window(4, 4)),
            delegate_to: Some(2),
            tag_ids: vec![7],
            ..task(1)
        };
        let plan = plan_retype(&source, &[child(ChildKind::Task, 2)], RetypeKind::Task);
        assert!(!plan.loses_anything());
    }

    #[test]
    fn every_kind_spelling_round_trips() {
        for kind in [
            RetypeKind::Goal,
            RetypeKind::Task,
            RetypeKind::Domain,
            RetypeKind::Project,
            RetypeKind::Tag,
        ] {
            assert_eq!(RetypeKind::from_db(kind.as_str()), Some(kind));
            assert_eq!(ChildKind::from(kind).as_str(), kind.as_str());
        }
        assert_eq!(RetypeKind::from_db("info"), None);
        assert_eq!(RetypeKind::from_db("flow"), None);
    }
}

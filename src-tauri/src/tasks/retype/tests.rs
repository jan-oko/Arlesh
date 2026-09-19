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
        verdict: None,
        verdict_window: None,
        description: None,
        knowledge_base_directory: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        archival: None,
        delegate_to: None,
        tag_ids: vec![],
        block_reasons: vec![],
        dependents: 0,
        depends_on: 0,
        beads_id: None,
    }
}

fn task(id: i64) -> SourceNode {
    SourceNode {
        kind: RetypeKind::Task,
        status: Some("todo".into()),
        // Every stored Task has one; `Live` is the one nobody chose.
        archival: Some(TaskArchival::Live),
        ..goal(id)
    }
}

/// An unresolved commitment with no Verdict Window — the shape a freshly created one has.
fn commitment(id: i64) -> SourceNode {
    SourceNode {
        kind: RetypeKind::Commitment,
        status: None,
        verdict: Some(Verdict::Unresolved),
        ..goal(id)
    }
}

/// A Task somebody deliberately set aside.
fn backlogged_task(id: i64) -> SourceNode {
    SourceNode {
        archival: Some(TaskArchival::Backlog),
        ..task(id)
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

// --- A window supplied after the plan was made ---

#[test]
fn a_window_supplied_after_the_plan_is_what_the_new_commitment_is_written_with() {
    // The answer to the unscoped refusal: the user picks a window, and it joins this plan
    // rather than being written to the source node in a separate call beforehand.
    let mut plan = plan_retype(&task(1), &[], RetypeKind::Commitment);
    assert_eq!(plan.carried.time_scope, None);
    plan.set_time_scope(window(4, 4));
    assert_eq!(plan.carried.time_scope, Some(window(4, 4)));
}

#[test]
fn a_window_supplied_for_a_target_that_has_no_window_is_ignored() {
    // A domain has no Time Scope column, so accepting one here would promise a write that
    // cannot happen.
    let mut plan = plan_retype(&task(1), &[], RetypeKind::Domain);
    plan.set_time_scope(window(4, 4));
    assert_eq!(plan.carried.time_scope, None);
}

#[test]
fn a_window_supplied_after_the_plan_replaces_the_one_the_node_already_had() {
    let mut source = task(1);
    source.time_scope = Some(window(1, 1));
    let mut plan = plan_retype(&source, &[], RetypeKind::Commitment);
    assert_eq!(plan.carried.time_scope, Some(window(1, 1)));
    plan.set_time_scope(window(9, 9));
    assert_eq!(plan.carried.time_scope, Some(window(9, 9)));
}

fn lost_field_names(plan: &TransferPlan) -> Vec<&'static str> {
    plan.lost_fields.iter().map(|lost| lost.field).collect()
}

fn lost_child_kinds(plan: &TransferPlan) -> Vec<ChildKind> {
    plan.lost_children.iter().map(|child| child.kind).collect()
}

// --- task ↔ commitment ---

#[test]
fn a_task_becoming_a_commitment_carries_its_window_tags_privacy_and_position() {
    let source = SourceNode {
        time_scope: Some(window(3, 5)),
        on_scope_exit: Some(OnScopeExit::Archive),
        tag_ids: vec![7, 9],
        ..task(1)
    };

    let plan = plan_retype(&source, &[], RetypeKind::Commitment);

    assert_eq!(plan.carried.time_scope, Some(window(3, 5)));
    assert_eq!(plan.carried.tag_ids, vec![7, 9]);
    assert!(plan.carried.is_private, "privacy carries");
    assert_eq!(plan.carried.position, 17);
    assert_eq!(plan.carried.title, "Ship it");
}

#[test]
fn a_task_becoming_a_commitment_loses_its_plan_delegate_and_block_reasons() {
    let source = SourceNode {
        time_scope: Some(window(3, 9)),
        plan: Some(window(4, 4)),
        delegate_to: Some(12),
        block_reasons: vec!["waiting on Ana".into()],
        dependents: 2,
        depends_on: 1,
        ..task(1)
    };

    let plan = plan_retype(&source, &[], RetypeKind::Commitment);

    // The window *is* the commitment, so a Plan has nothing to mean; and a rule you hold is
    // not a unit of work in a graph, so nothing gates it and it gates nothing.
    assert_eq!(
        lost_field_names(&plan),
        vec!["plan", "delegate_to", "block_reasons", "dependents", "dependencies"],
    );
    assert_eq!(plan.carried.plan, None);
    assert_eq!(plan.carried.delegate_to, None);
    assert!(plan.carried.block_reasons.is_empty());
    assert!(plan.loses_anything(), "the caller must be told before any of that goes");
}

#[test]
fn a_task_becoming_a_commitment_never_arrives_with_a_verdict() {
    // `done` is not `kept`. A task that was finished says nothing about whether a rule was
    // held to, and inventing that equivalence is the inference this kind exists to avoid.
    for status in ["todo", "in_progress", "done"] {
        let source = SourceNode { status: Some(status.into()), ..task(1) };
        let plan = plan_retype(&source, &[], RetypeKind::Commitment);
        assert_eq!(plan.carried.verdict, None, "from {status}");
        assert_eq!(plan.carried.status, None, "a commitment has no status column");
    }
}

#[test]
fn a_finished_task_becoming_a_commitment_is_told_its_status_is_going() {
    // A non-default status is real intent, and it has nowhere to go.
    let source = SourceNode { status: Some("done".into()), ..task(1) };
    let plan = plan_retype(&source, &[], RetypeKind::Commitment);
    assert_eq!(lost_field_names(&plan), vec!["status"]);
}

#[test]
fn an_untouched_task_becoming_a_commitment_is_not_told_about_a_status_nobody_chose() {
    let plan = plan_retype(&task(1), &[], RetypeKind::Commitment);
    assert!(lost_field_names(&plan).is_empty());
    assert!(!plan.loses_anything());
}

#[test]
fn a_commitment_becoming_a_task_loses_its_verdict_and_verdict_window() {
    let source = SourceNode {
        verdict: Some(Verdict::Broken),
        verdict_window: Some(DurationSpec { n: 2, kind: "day".into() }),
        ..commitment(1)
    };

    let plan = plan_retype(&source, &[], RetypeKind::Task);

    assert_eq!(lost_field_names(&plan), vec!["verdict", "verdict_window"]);
    let values: Vec<&str> = plan.lost_fields.iter().map(|lost| lost.value.as_str()).collect();
    assert_eq!(values, vec!["broken", "2 day"], "the prompt says what is at stake, not only which field");
    assert_eq!(plan.carried.status, None, "no verdict is translated into a status");
}

#[test]
fn an_unjudged_commitment_becoming_a_task_loses_nothing() {
    // `unresolved` is the absence of a judgement, exactly as `todo` is the absence of a
    // chosen status — reporting it as a loss would be reporting the loss of nothing.
    let plan = plan_retype(&commitment(1), &[], RetypeKind::Task);
    assert!(lost_field_names(&plan).is_empty());
    assert!(!plan.loses_anything());
}

#[test]
fn a_commitment_keeps_its_issue_link_in_both_directions() {
    let tracked = SourceNode { beads_id: Some("Arlesh-cyo".into()), ..commitment(1) };
    assert_eq!(
        plan_retype(&tracked, &[], RetypeKind::Task).carried.beads_id,
        Some("Arlesh-cyo".to_string()),
    );
    let tracked_task = SourceNode { beads_id: Some("Arlesh-cyo".into()), ..task(1) };
    assert_eq!(
        plan_retype(&tracked_task, &[], RetypeKind::Commitment).carried.beads_id,
        Some("Arlesh-cyo".to_string()),
    );
}

#[test]
fn a_commitment_keeps_task_and_commitment_children_and_strands_the_rest() {
    let children = [
        child(ChildKind::Goal, 2),
        child(ChildKind::Task, 3),
        child(ChildKind::Commitment, 4),
        child(ChildKind::Info, 5),
        child(ChildKind::Flow, 6),
    ];

    let plan = plan_retype(&task(1), &children, RetypeKind::Commitment);

    assert_eq!(
        lost_child_kinds(&plan),
        vec![ChildKind::Goal, ChildKind::Flow],
        "supporting steps and finer-grained rules stay; a desired state and a template do not",
    );
}

#[test]
fn every_kind_that_can_hold_a_task_can_hold_a_commitment_except_a_goals_own_refusals() {
    // A Commitment lives anywhere a Task can, plus inside another Commitment.
    for holder in [RetypeKind::Project, RetypeKind::Domain, RetypeKind::Goal, RetypeKind::Task] {
        assert!(
            holder.accepts_child(ChildKind::Commitment),
            "{} should hold a commitment",
            holder.as_str(),
        );
    }
    assert!(!RetypeKind::Tag.accepts_child(ChildKind::Commitment));
    assert!(!RetypeKind::Info.accepts_child(ChildKind::Commitment));
}

#[test]
fn a_commitment_refuses_a_goal_child() {
    assert!(!RetypeKind::Commitment.accepts_child(ChildKind::Goal));
    assert!(!RetypeKind::Commitment.accepts_child(ChildKind::Flow));
    assert!(!RetypeKind::Commitment.accepts_child(ChildKind::Project));
}

#[test]
fn commitment_is_a_retypeable_kind_on_the_wire() {
    assert_eq!(RetypeKind::Commitment.as_str(), "commitment");
    assert_eq!(RetypeKind::from_db("commitment"), Some(RetypeKind::Commitment));
    assert_eq!(ChildKind::from(RetypeKind::Commitment), ChildKind::Commitment);
    assert_eq!(ChildKind::Commitment.as_str(), "commitment");
}

#[test]
fn a_commitment_parent_is_acceptable_to_a_task_and_a_commitment_but_not_a_goal() {
    // Which is what makes `climb_to_acceptable_parent` move a commitment's child further up
    // when it becomes a Goal, rather than writing a parent link the CHECK would refuse.
    assert!(accepts_category(RetypeKind::Task, ParentCategory::Commitment));
    assert!(accepts_category(RetypeKind::Commitment, ParentCategory::Commitment));
    assert!(!accepts_category(RetypeKind::Goal, ParentCategory::Commitment));
    assert!(!accepts_category(RetypeKind::Project, ParentCategory::Commitment));
    assert_eq!(category_of("commitment"), ParentCategory::Commitment);
    assert_eq!(goal_task_parent_type("commitment"), "commitment");
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
fn a_project_becoming_a_domain_keeps_every_field_because_no_row_is_rewritten() {
    let source = SourceNode {
        knowledge_base_directory: Some("Projects/Arlesh".into()),
        ..project(1)
    };

    let plan = plan_retype(&source, &[], RetypeKind::Domain);

    assert_eq!(
        lost_field_names(&plan),
        Vec::<&str>::new(),
        "a subtype change deletes nothing; the directory column keeps its value"
    );
    assert_eq!(plan.carried.description, Some("The big one".to_string()));
    assert_eq!(
        plan.carried.knowledge_base_directory,
        Some("Projects/Arlesh".to_string())
    );
}

#[test]
fn a_project_becoming_a_goal_does_lose_its_obsidian_directory() {
    let source = SourceNode {
        knowledge_base_directory: Some("Projects/Arlesh".into()),
        ..project(1)
    };

    let plan = plan_retype(&source, &[], RetypeKind::Goal);

    assert_eq!(
        lost_field_names(&plan),
        vec!["description", "knowledge_base_directory"],
        "here the domains row really is deleted"
    );
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
fn inbound_dependencies_are_lost_when_the_target_cannot_be_depended_on() {
    let source = SourceNode {
        dependents: 2,
        ..goal(1)
    };

    assert_eq!(
        lost_field_names(&plan_retype(&source, &[], RetypeKind::Task)),
        Vec::<&str>::new(),
        "a task can be depended on, so the edges move rather than end"
    );
    assert_eq!(
        plan_retype(&source, &[], RetypeKind::Project).lost_fields,
        vec![LostField {
            field: "dependents",
            value: "2".into()
        }]
    );
}

#[test]
fn outgoing_dependencies_are_lost_by_anything_that_is_not_a_task() {
    let source = SourceNode {
        depends_on: 3,
        ..task(1)
    };

    assert_eq!(
        lost_field_names(&plan_retype(&source, &[], RetypeKind::Goal)),
        vec!["dependencies"],
        "only a task can depend on things"
    );
    assert_eq!(
        plan_retype(&source, &[], RetypeKind::Task).lost_fields,
        Vec::<LostField>::new()
    );
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
            "parent_climb": null,
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
        RetypeKind::Info,
    ] {
        assert_eq!(RetypeKind::from_db(kind.as_str()), Some(kind));
        assert_eq!(ChildKind::from(kind).as_str(), kind.as_str());
    }
    assert_eq!(RetypeKind::from_db("flow"), None);
}

// --- info, as a sixth retypeable kind ---

fn info(id: i64) -> SourceNode {
    SourceNode {
        kind: RetypeKind::Info,
        status: None,
        description: None,
        ..goal(id)
    }
}

#[test]
fn an_info_accepts_only_an_info_child() {
    assert!(RetypeKind::Info.accepts_child(ChildKind::Info));
    for other in [ChildKind::Goal, ChildKind::Task, ChildKind::Domain, ChildKind::Project, ChildKind::Tag, ChildKind::Flow] {
        assert!(!RetypeKind::Info.accepts_child(other), "an info cannot hold a {other:?}");
    }
}

#[test]
fn every_target_kind_accepts_an_info_child() {
    for target in [
        RetypeKind::Goal,
        RetypeKind::Task,
        RetypeKind::Domain,
        RetypeKind::Project,
        RetypeKind::Tag,
        RetypeKind::Info,
    ] {
        assert!(target.accepts_child(ChildKind::Info), "{target:?} should accept an info child");
    }
}

#[test]
fn an_info_target_has_no_status_vocabulary_so_a_non_default_status_is_lost() {
    let source = SourceNode { status: Some("achieved".into()), ..task(1) };
    let plan = plan_retype(&source, &[], RetypeKind::Info);
    assert_eq!(
        lost_field_names(&plan),
        vec!["status"],
        "a task's non-default status has nowhere to go on an info"
    );
}

#[test]
fn an_info_source_carries_no_status_since_it_never_had_one() {
    let plan = plan_retype(&info(1), &[], RetypeKind::Task);
    assert_eq!(plan.carried.status, None);
    assert!(!lost_field_names(&plan).contains(&"status"), "an info never had a status to lose");
}

#[test]
fn an_info_becoming_a_project_carries_its_details_into_description() {
    let source = SourceNode {
        description: Some("Longer text".into()),
        ..info(1)
    };
    let plan = plan_retype(&source, &[], RetypeKind::Project);
    assert_eq!(plan.carried.description, Some("Longer text".to_string()));
    assert!(!plan.loses_anything());
}

#[test]
fn a_project_becoming_an_info_carries_its_description_into_details() {
    let plan = plan_retype(&project(1), &[], RetypeKind::Info);
    assert_eq!(plan.carried.description, Some("The big one".to_string()));
}

#[test]
fn an_info_becoming_a_task_loses_its_details_since_a_task_has_no_such_column() {
    let source = SourceNode {
        description: Some("Longer text".into()),
        ..info(1)
    };
    let plan = plan_retype(&source, &[], RetypeKind::Task);
    assert_eq!(lost_field_names(&plan), vec!["description"]);
    assert_eq!(plan.carried.description, None);
}

#[test]
fn a_task_becoming_an_info_has_nothing_to_carry_into_details_and_loses_nothing_there() {
    let plan = plan_retype(&task(1), &[], RetypeKind::Info);
    assert!(
        !lost_field_names(&plan).contains(&"description"),
        "a task never had a description, so there is nothing to report losing"
    );
}

#[test]
fn an_info_becoming_a_task_keeps_its_privacy_and_position() {
    let source = SourceNode {
        is_private: true,
        position: 4,
        ..info(1)
    };
    let plan = plan_retype(&source, &[], RetypeKind::Task);
    assert!(plan.carried.is_private, "privacy carries from an info to a task");
    assert_eq!(plan.carried.position, 4);
}

#[test]
fn a_pending_parent_climb_alone_still_requires_confirmation() {
    let mut plan = plan_retype(&task(1), &[], RetypeKind::Goal);
    assert!(!plan.loses_anything(), "no climb yet — plan_retype never sets one");

    plan.parent_climb = Some(ParentClimb {
        from: NamedParent { kind: "info".into(), id: 2, title: "Note".into() },
        to: NamedParent { kind: "project".into(), id: 3, title: "Ops".into() },
    });

    assert!(plan.loses_anything(), "leaving the current parent needs the same consent as a loss");
    assert_eq!(
        plan.details()["parent_climb"],
        serde_json::json!({
            "from": { "kind": "info", "id": 2, "title": "Note" },
            "to": { "kind": "project", "id": 3, "title": "Ops" },
        })
    );
}

#[test]
fn domains_table_parents_are_accepted_by_every_target() {
    for target in [
        RetypeKind::Goal,
        RetypeKind::Task,
        RetypeKind::Domain,
        RetypeKind::Project,
        RetypeKind::Tag,
        RetypeKind::Info,
    ] {
        assert!(accepts_category(target, ParentCategory::DomainsTable));
    }
}

#[test]
fn only_a_task_or_task_like_target_accepts_a_task_shaped_parent() {
    assert!(!accepts_category(RetypeKind::Goal, ParentCategory::Task));
    assert!(accepts_category(RetypeKind::Task, ParentCategory::Task));
    assert!(!accepts_category(RetypeKind::Domain, ParentCategory::Task));
    assert!(accepts_category(RetypeKind::Info, ParentCategory::Task));
}

#[test]
fn only_an_info_target_accepts_an_info_shaped_parent() {
    for target in [
        RetypeKind::Goal,
        RetypeKind::Task,
        RetypeKind::Domain,
        RetypeKind::Project,
        RetypeKind::Tag,
    ] {
        assert!(!accepts_category(target, ParentCategory::Info), "{target:?} CHECK never spells \"info\"");
    }
    assert!(accepts_category(RetypeKind::Info, ParentCategory::Info));
}

#[test]
fn category_of_reads_the_raw_kind_spelling() {
    assert_eq!(category_of("goal"), ParentCategory::Goal);
    assert_eq!(category_of("task"), ParentCategory::Task);
    assert_eq!(category_of("info"), ParentCategory::Info);
    for domains_table_kind in ["aspect", "project", "domain", "tag"] {
        assert_eq!(category_of(domains_table_kind), ParentCategory::DomainsTable);
    }
}

/// A task carrying a `bd` issue link.
fn linked_task(id: i64) -> SourceNode {
    SourceNode {
        beads_id: Some("Arlesh-3gk".into()),
        ..task(id)
    }
}

#[test]
fn an_issue_link_carries_to_every_kind_with_a_column_for_it() {
    // tasks, goals and domains all have the column, so a retype between them keeps the link.
    // Domain and Tag do not display it, but the value survives and reappears if the node is
    // made a Project again — the same reasoning knowledge_base_directory already gets.
    for target in [
        RetypeKind::Goal,
        RetypeKind::Project,
        RetypeKind::Domain,
        RetypeKind::Tag,
    ] {
        let plan = plan_retype(&linked_task(1), &[], target);
        assert_eq!(
            plan.carried.beads_id.as_deref(),
            Some("Arlesh-3gk"),
            "{target:?} should carry the issue link"
        );
        assert!(
            !lost_field_names(&plan).contains(&"beads_id"),
            "{target:?} should not report the issue link as lost"
        );
    }
}

#[test]
fn an_issue_link_is_lost_when_the_node_becomes_a_note() {
    // `infos` has no beads_id column, so this one is a real loss and has to be confirmed.
    let plan = plan_retype(&linked_task(1), &[], RetypeKind::Info);

    assert_eq!(plan.carried.beads_id, None);
    assert!(lost_field_names(&plan).contains(&"beads_id"));
    assert!(
        plan.loses_anything(),
        "losing an issue link must make the retype ask first"
    );
}

#[test]
fn the_lost_issue_link_names_the_id_that_would_go() {
    // The prompt says what is at stake, not merely which field.
    let plan = plan_retype(&linked_task(1), &[], RetypeKind::Info);
    let lost = plan
        .lost_fields
        .iter()
        .find(|lost| lost.field == "beads_id")
        .expect("beads_id should be reported lost");
    assert_eq!(lost.value, "Arlesh-3gk");
}

#[test]
fn an_unlinked_node_never_reports_a_lost_issue_link() {
    let plan = plan_retype(&task(1), &[], RetypeKind::Info);
    assert_eq!(plan.carried.beads_id, None);
    assert!(!lost_field_names(&plan).contains(&"beads_id"));
}

#[test]
fn an_issue_link_survives_a_retype_within_the_domains_table() {
    // A domain-table retype is a subtype update on one row: nothing is deleted, so the link
    // cannot be lost regardless of which subtype it lands on.
    let linked_project = SourceNode {
        beads_id: Some("Arlesh-e8d".into()),
        ..project(1)
    };
    for target in [RetypeKind::Domain, RetypeKind::Tag, RetypeKind::Project] {
        let plan = plan_retype(&linked_project, &[], target);
        assert_eq!(
            plan.carried.beads_id.as_deref(),
            Some("Arlesh-e8d"),
            "{target:?} within the domains table keeps the link"
        );
    }
}

// --- the backlog, a Task-only state ---

#[test]
fn a_backlogged_task_becoming_a_goal_names_the_backlog_among_its_losses() {
    // A Goal has no backlog and SPEC rules out mapping it onto Frozen, so the state goes —
    // and the prompt has to say so rather than let one stored state vanish quietly.
    let plan = plan_retype(&backlogged_task(1), &[], RetypeKind::Goal);

    assert_eq!(plan.carried.archival, None, "the new goal is simply in play");
    assert_eq!(
        plan.lost_fields,
        vec![LostField {
            field: "archival",
            value: "backlog".into()
        }]
    );
    assert!(
        plan.loses_anything(),
        "losing the backlog must make the retype ask first"
    );
}

#[test]
fn a_backlogged_task_loses_its_backlog_to_every_kind_that_is_not_a_task() {
    for target in [
        RetypeKind::Goal,
        // A Commitment is not a Task and has no Backlog either: its own Archival is derived
        // from its Verdict Window, and the Task-only state has nowhere to land.
        RetypeKind::Commitment,
        RetypeKind::Project,
        RetypeKind::Domain,
        RetypeKind::Tag,
        RetypeKind::Info,
    ] {
        let plan = plan_retype(&backlogged_task(1), &[], target);
        assert!(
            lost_field_names(&plan).contains(&"archival"),
            "{target:?} has no backlog, so it should report one lost"
        );
        assert_eq!(plan.carried.archival, None, "{target:?} carries no backlog");
    }
}

#[test]
fn a_commitment_has_no_backlog_to_lose_in_either_direction() {
    // Nothing to carry on the way out — a Commitment's row has no archival column — and
    // nothing to report on the way in, since there was never a decision to drop.
    let to_task = plan_retype(&commitment(1), &[], RetypeKind::Task);
    assert_eq!(to_task.carried.archival, None);
    assert!(!lost_field_names(&to_task).contains(&"archival"));

    let to_goal = plan_retype(&commitment(1), &[], RetypeKind::Goal);
    assert!(!lost_field_names(&to_goal).contains(&"archival"));
}

#[test]
fn a_task_nobody_set_aside_never_reports_a_lost_backlog() {
    // `Live` is the state a Task is in when nobody chose anything, so — like a status still
    // at its default — it is not a loss and must not drag up a prompt on its own.
    let plan = plan_retype(&task(1), &[], RetypeKind::Goal);

    assert!(!lost_field_names(&plan).contains(&"archival"));
    assert!(!plan.loses_anything());
}

#[test]
fn a_node_with_no_archival_column_at_all_reports_nothing() {
    // A goal has no archival state to begin with, so retyping it names none.
    let plan = plan_retype(&goal(1), &[], RetypeKind::Task);
    assert_eq!(plan.carried.archival, None);
    assert!(!lost_field_names(&plan).contains(&"archival"));
}

#[test]
fn a_backlogged_task_retyped_to_a_task_keeps_its_backlog() {
    // The same-kind plan carries everything; the command short-circuits it before any write.
    let plan = plan_retype(&backlogged_task(1), &[], RetypeKind::Task);
    assert_eq!(plan.carried.archival, Some(TaskArchival::Backlog));
    assert!(!lost_field_names(&plan).contains(&"archival"));
}

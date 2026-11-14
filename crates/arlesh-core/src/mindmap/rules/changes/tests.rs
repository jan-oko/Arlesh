//! The board's entries, its diff and its digests (ADR 0020): the cases the frontend replays from
//! `conformance/board-changes.json`.

use super::*;
use serde_json::{json, Value};

const CORPUS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../conformance/board-changes.json"
);

/// A hand-built board holding one row of every collection, with the awkward strings the digest
/// must agree on across languages.
fn base() -> Value {
    json!({
        "domains": [
            {"id": 1, "title": "Aspect \"quoted\" \\ back / slash", "description": null,
             "subtype": "aspect", "parent_id": null, "color": null, "status": null,
             "knowledge_base_directory": null, "position": 1, "is_private": false},
            {"id": 2, "title": "Project é \u{1F600} \u{2028}\u{2029}", "description": "tab\tand\u{1}\u{1f}\u{7f}",
             "subtype": "project", "parent_id": 1, "color": null, "status": "active",
             "knowledge_base_directory": null, "position": 1, "is_private": false}
        ],
        "goals": [
            {"id": 3, "title": "Goal", "parent_type": "project", "parent_id": 2, "status": "active",
             "time_scope": null, "on_scope_exit": null, "tag_ids": [], "position": 1, "is_private": false}
        ],
        "tasks": [
            task(10, "Step one", "todo", 1),
            task(11, "", "todo", 2),
            task_habit_occurrence(),
            extreme_position("6f1d2c1e-8e0a-5b7e-9d57-3a1f0e6f7a11", i64::MIN),
            extreme_position("6f1d2c1e-8e0a-5b7e-9d57-3a1f0e6f7a12", i64::MAX),
        ],
        "commitments": [
            {"id": 4, "title": "Commitment", "parent_type": "project", "parent_id": 2, "verdict": "unresolved",
             "time_scope": null, "tag_ids": [], "position": 3, "is_private": false}
        ],
        "expectations": [
            {"id": 5, "title": "Wait", "parent_type": "task", "parent_id": 10, "status": "pending",
             "archival": "live", "time_scope": null, "tag_ids": [], "position": 1, "is_private": false}
        ],
        "infos": [
            {"id": 6, "body": "Note", "details": null, "parent_type": "task", "parent_id": 10,
             "position": 1, "is_private": false}
        ],
        "flows": [
            {"id": 7, "title": "Flow", "instance_type": "task", "parent_type": "project", "parent_id": 2,
             "target_type": null, "target_id": null, "flow_duration_n": null, "flow_duration_kind": null,
             "flow_window_part": null, "flow_window_time_start": null, "flow_window_time_end": null,
             "root_plan_kind": null, "root_plan_start": null, "root_plan_end": null,
             "verdict_window_n": null, "verdict_window_kind": null, "is_habit": true,
             "position": 1, "is_private": false}
        ],
        "flow_goals": [
            {"id": 8, "flow_id": 7, "title": "Flow goal", "parent_type": "flow", "parent_id": 7,
             "position": 1, "is_private": false}
        ],
        "flow_tasks": [
            {"id": 9, "flow_id": 7, "title": "Flow task", "parent_type": "flow", "parent_id": 7,
             "position": 2, "is_private": false}
        ],
        "flow_commitments": [
            {"id": 12, "flow_id": 7, "title": "Flow commitment", "parent_type": "flow", "parent_id": 7,
             "position": 3, "is_private": false, "verdict_window": null}
        ],
        "flow_expectations": [
            {"id": 13, "flow_id": 7, "title": "Flow wait", "parent_type": "flow", "parent_id": 7,
             "position": 4, "is_private": false, "check_every": null, "first_check": null}
        ],
        "flow_cycles": [
            {"id": 14, "flow_id": 7, "item_type": "task", "item_id": 9, "scope_kind": null,
             "scope_index": null, "plan_kind": null, "plan_start": null, "plan_end": null, "position": 1}
        ],
        "flow_dependencies": [
            {"id": 15, "flow_id": 7, "dependent_type": "task", "dependent_id": 9,
             "depends_on_type": "goal", "depends_on_id": 8}
        ],
        "block_reasons": [
            {"owner_type": "task", "owner_id": 11, "reason": "first", "position": 1},
            {"owner_type": "task", "owner_id": 11, "reason": "second", "position": 2},
            {"owner_type": "task", "owner_id": 10, "reason": "other", "position": 1}
        ],
        "task_dependencies": [
            {"task_id": 11, "dependency_type": "task", "dependency_id": 10},
            {"task_id": 11, "dependency_type": "goal", "dependency_id": 3}
        ],
        "flow_instance_nodes": [{"node_type": "task", "node_id": 10}],
        "lifecycles": [
            lifecycle("task", json!(10), "active", false),
            lifecycle("task", json!(11), "active", false),
            lifecycle("task", json!("6f1d2c1e-8e0a-5b7e-9d57-3a1f0e6f7a10"), "pending", false)
        ],
        "habits": [{"flow_id": 7, "flow_title": "Flow", "result": {"outcome": "loaded"}}],
        "short_ids": {"task-10": "a1", "task-11": "a2", "goal-3": "b1"},
        "facts": {"task-11": {"dependency_blocks": [{"kind": "task", "id": 10, "short_id": "a1", "title": "Step one"}]}},
        "agent_activity": {"review": 0, "waits": 0, "on_agent": 1}
    })
}

fn task(id: i64, title: &str, status: &str, position: i64) -> Value {
    json!({"id": id, "title": title, "parent_type": "project", "parent_id": 2,
           "status": {"kind": "ordinary", "status": status}, "tag_ids": [],
           "position": position, "is_private": false})
}

/// A derived Task sorted first or last, as a check Task is: its position is the least or the
/// greatest `i64`, which JavaScript cannot hold (it rounds them, and prints another number).
fn extreme_position(id: &str, position: i64) -> Value {
    let mut row = task(0, "Check", "todo", 0);
    row["id"] = json!(id);
    row["position"] = json!(position);
    row
}

fn task_habit_occurrence() -> Value {
    let mut occurrence = task(0, "Habit run", "todo", 3);
    occurrence["id"] = json!("6f1d2c1e-8e0a-5b7e-9d57-3a1f0e6f7a10");
    occurrence
}

fn lifecycle(kind: &str, id: Value, timing: &str, overdue: bool) -> Value {
    json!({"node_type": kind, "node_id": id, "timing": timing, "overdue": overdue,
           "archival": "live", "archival_conflict": false})
}

fn load(value: &Value) -> MindmapLoad {
    serde_json::from_value(value.clone()).expect("the fixture is a board")
}

fn changes_between(before: &Value, after: &Value) -> BoardChanges {
    diff(&load(before), &load(after)).expect("serialises")
}

fn keys(changes: &BoardChanges, collection: Collection) -> (Vec<String>, Vec<String>) {
    let Some(found) = changes.by_collection.get(&collection) else {
        return (Vec::new(), Vec::new());
    };
    let mut set: Vec<String> = found.set.iter().map(|(key, _)| key.clone()).collect();
    let mut del = found.del.clone();
    set.sort();
    del.sort();
    (set, del)
}

fn touched(changes: &BoardChanges) -> Vec<&'static str> {
    changes
        .by_collection
        .iter()
        .filter(|(_, changes)| !changes.is_empty())
        .map(|(collection, _)| collection.as_str())
        .collect()
}

/// The named cases: `(name, before, after)`, edited from the base board.
fn cases() -> Vec<(&'static str, Value, Value)> {
    let before = base();
    let edited = |edit: &dyn Fn(&mut Value)| {
        let mut after = before.clone();
        edit(&mut after);
        after
    };
    vec![
        (
            "a status step",
            before.clone(),
            edited(&|b| {
                b["tasks"][0]["status"]["status"] = json!("done");
                b["lifecycles"][0]["timing"] = json!("lapsed");
                b["facts"]["task-11"] = json!({});
            }),
        ),
        (
            "a create",
            before.clone(),
            edited(&|b| {
                b["tasks"]
                    .as_array_mut()
                    .unwrap()
                    .push(task(12, "New", "todo", 4));
                b["lifecycles"].as_array_mut().unwrap().push(lifecycle(
                    "task",
                    json!(12),
                    "active",
                    false,
                ));
                b["short_ids"]["task-12"] = json!("a3");
            }),
        ),
        (
            "a move",
            before.clone(),
            edited(&|b| {
                b["tasks"][0]["parent_type"] = json!("goal");
                b["tasks"][0]["parent_id"] = json!(3);
                b["tasks"][0]["position"] = json!(1);
                b["tasks"][1]["position"] = json!(1);
            }),
        ),
        (
            "a delete of a two-level subtree",
            before.clone(),
            edited(&|b| {
                b["tasks"].as_array_mut().unwrap().remove(0);
                b["expectations"] = json!([]);
                b["infos"] = json!([]);
                b["lifecycles"].as_array_mut().unwrap().remove(0);
                b["block_reasons"].as_array_mut().unwrap().remove(2);
                b["short_ids"].as_object_mut().unwrap().remove("task-10");
            }),
        ),
        (
            "a block reason edit",
            before.clone(),
            edited(&|b| {
                b["block_reasons"][1]["reason"] = json!("second, reworded");
            }),
        ),
        (
            "a dependency added",
            before.clone(),
            edited(&|b| {
                b["task_dependencies"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"task_id": 10, "dependency_type": "goal", "dependency_id": 3}));
            }),
        ),
        (
            "a short id lengthened by a new node",
            before.clone(),
            edited(&|b| {
                b["short_ids"]["task-10"] = json!("a10");
                b["short_ids"]["task-11"] = json!("a11");
            }),
        ),
        (
            "the agent activity changing",
            before.clone(),
            edited(&|b| {
                b["agent_activity"]["review"] = json!(2);
            }),
        ),
        (
            "a tick turning a Task overdue",
            before.clone(),
            edited(&|b| {
                b["lifecycles"][1]["overdue"] = json!(true);
            }),
        ),
        (
            "agent activity going away",
            before.clone(),
            edited(&|b| {
                b.as_object_mut().unwrap().remove("agent_activity");
            }),
        ),
    ]
}

#[test]
fn the_same_board_diffs_to_nothing() {
    let changes = changes_between(&base(), &base());

    assert!(changes.is_empty());
    assert_eq!(changes.to_json().unwrap(), "{}");
}

#[test]
fn a_status_step_changes_the_row_its_lifecycle_and_its_facts_and_nothing_else() {
    let (_, before, after) = cases().remove(0);

    let changes = changes_between(&before, &after);

    assert_eq!(touched(&changes), ["tasks", "lifecycles", "facts"]);
    assert_eq!(keys(&changes, Collection::Tasks).0, ["task-10"]);
    assert_eq!(keys(&changes, Collection::Lifecycles).0, ["task-10"]);
    assert_eq!(
        keys(&changes, Collection::Facts),
        (vec!["task-11".to_string()], Vec::new())
    );
}

#[test]
fn a_move_gives_the_moved_row_and_the_sibling_whose_position_changed() {
    let (_, before, after) = cases().remove(2);

    let changes = changes_between(&before, &after);

    assert_eq!(touched(&changes), ["tasks"]);
    assert_eq!(keys(&changes, Collection::Tasks).0, ["task-10", "task-11"]);
}

#[test]
fn a_delete_gives_a_key_for_every_entry_of_the_subtree() {
    let (_, before, after) = cases().remove(3);

    let changes = changes_between(&before, &after);

    assert_eq!(keys(&changes, Collection::Tasks).1, ["task-10"]);
    assert_eq!(
        keys(&changes, Collection::Expectations).1,
        ["expectation-5"]
    );
    assert_eq!(keys(&changes, Collection::Infos).1, ["6"]);
    assert_eq!(keys(&changes, Collection::Lifecycles).1, ["task-10"]);
    assert_eq!(keys(&changes, Collection::BlockReasons).1, ["task-10"]);
    assert_eq!(keys(&changes, Collection::ShortIds).1, ["task-10"]);
}

#[test]
fn an_edited_block_reason_replaces_its_owners_whole_group() {
    let (_, before, after) = cases().remove(4);

    let changes = changes_between(&before, &after);

    let group = &changes.by_collection[&Collection::BlockReasons];
    assert_eq!(group.set.len(), 1);
    assert_eq!(group.set[0].0, "task-11");
    let reasons: Value = serde_json::from_str(&group.set[0].1).unwrap();
    assert_eq!(reasons.as_array().unwrap().len(), 2);
    assert!(group.del.is_empty());
}

#[test]
fn an_added_dependency_replaces_its_tasks_group() {
    let (_, before, after) = cases().remove(5);

    let changes = changes_between(&before, &after);

    assert_eq!(keys(&changes, Collection::TaskDependencies).0, ["task-10"]);
}

#[test]
fn going_without_agent_activity_deletes_the_value() {
    let (_, before, after) = cases().remove(9);

    let changes = changes_between(&before, &after);

    assert_eq!(
        keys(&changes, Collection::AgentActivity).1,
        ["agent_activity"]
    );
}

#[test]
fn changes_are_written_with_their_values_raw() {
    let (_, before, after) = cases().remove(7);

    let json = changes_between(&before, &after).to_json().unwrap();

    assert_eq!(
        json,
        r#"{"agent_activity":{"set":[["agent_activity",{"review":2,"waits":0,"on_agent":1}]],"del":[]}}"#
    );
}

#[test]
fn applying_the_changes_to_the_digests_of_before_gives_the_digests_of_after() {
    for (name, before, after) in cases() {
        let mut digests = BoardDigests::seed(&load(&before)).unwrap();

        digests.apply(&changes_between(&before, &after));

        let fresh = BoardDigests::seed(&load(&after)).unwrap();
        assert_eq!(digests.total(), fresh.total(), "{name}: total");
        assert_eq!(digests.by_entry, fresh.by_entry, "{name}: entries");
        let nonzero = |digests: &BoardDigests| {
            digests
                .sums
                .iter()
                .filter(|(_, sum)| **sum != 0)
                .map(|(collection, sum)| (*collection, *sum))
                .collect::<BTreeMap<_, _>>()
        };
        assert_eq!(nonzero(&digests), nonzero(&fresh), "{name}: sums");
    }
}

#[test]
fn the_digest_is_fnv_1a_over_collection_key_and_json_split_by_zero_bytes() {
    // FNV-1a 32 of "a" is 0xe40c292c, of the empty string its offset basis.
    assert_eq!(fnv(FNV_OFFSET_BASIS, b""), 0x811c_9dc5);
    assert_eq!(fnv(FNV_OFFSET_BASIS, b"a"), 0xe40c_292c);
    assert_eq!(
        digest(Collection::Tasks, "task-1", "{}"),
        fnv(FNV_OFFSET_BASIS, b"tasks\0task-1\0{}")
    );
}

#[test]
fn a_collections_name_is_its_fields_name() {
    for collection in Collection::ALL {
        assert_eq!(Collection::from_name(collection.as_str()), Some(collection));
    }
    let board = serde_json::to_value(load(&base())).unwrap();
    for collection in Collection::ALL {
        assert!(
            board.get(collection.as_str()).is_some(),
            "{}",
            collection.as_str()
        );
    }
}

/// Every entry's JSON, deserialised into its Rust type and written back as text.
fn written_back(collection: Collection, json: &str) -> String {
    fn through<T: serde::de::DeserializeOwned + Serialize>(json: &str) -> String {
        let parsed: T = serde_json::from_str(json).expect("an entry deserialises");
        serde_json::to_string(&parsed).expect("an entry serialises")
    }
    match collection {
        Collection::Domains => through::<Domain>(json),
        Collection::Goals => through::<Goal>(json),
        Collection::Tasks => through::<Task>(json),
        Collection::Commitments => through::<Commitment>(json),
        Collection::Expectations => through::<Expectation>(json),
        Collection::Infos => through::<Info>(json),
        Collection::Flows => through::<Flow>(json),
        Collection::FlowGoals => through::<FlowGoal>(json),
        Collection::FlowTasks => through::<FlowTask>(json),
        Collection::FlowCommitments => through::<FlowCommitment>(json),
        Collection::FlowExpectations => through::<FlowExpectation>(json),
        Collection::FlowCycles => through::<FlowItemCycle>(json),
        Collection::FlowDependencies => through::<FlowDependency>(json),
        Collection::BlockReasons => through::<Vec<BlockReason>>(json),
        Collection::TaskDependencies => through::<Vec<TaskDependencyEdge>>(json),
        Collection::FlowInstanceNodes => through::<TargetRef>(json),
        Collection::Lifecycles => through::<ItemLifecycle>(json),
        Collection::Habits => through::<FlowHabitEntry>(json),
        Collection::ShortIds => through::<String>(json),
        Collection::Facts => through::<NodeFacts>(json),
        Collection::AgentActivity => through::<AgentActivity>(json),
    }
}

/// The corpus the frontend replays, written from the cases above and the base board's entries.
///
/// Boards and changes are kept as the exact text the core serialises: `serde_json::Value` sorts
/// its keys, which is not the order the digest is taken over.
fn corpus() -> Value {
    let base_load = load(&base());
    let entries: Vec<Value> = entries(&base_load)
        .iter()
        .map(|entry| {
            let json = entry.json().unwrap();
            json!({
                "collection": entry.collection.as_str(),
                "key": entry.key,
                "json": json,
                "digest": digest(entry.collection, &entry.key, &json),
            })
        })
        .collect();
    let cases: Vec<Value> = cases()
        .into_iter()
        .map(|(name, before, after)| {
            let (before, after) = (load(&before), load(&after));
            let changes = diff(&before, &after).unwrap();
            json!({
                "name": name,
                "before_json": serde_json::to_string(&before).unwrap(),
                "after_json": serde_json::to_string(&after).unwrap(),
                "changes_json": changes.to_json().unwrap(),
                "hash_before": BoardDigests::seed(&before).unwrap().total(),
                "hash_after": BoardDigests::seed(&after).unwrap().total(),
            })
        })
        .collect();
    json!({
        "about": [
            "Entries and changes of the board, as ADR 0020 defines them: every collection's key, the",
            "compact JSON of its value and its FNV-1a 32 digest, then cases of a board before and after",
            "with the changes between and the board hash of each side. Boards and changes are text, as",
            "the core writes them, because the digest is taken over that text.",
            "`crates/arlesh-core/src/mindmap/rules/changes/tests.rs` replays it (and rewrites it when",
            "`BOARD_CHANGES_REGEN=1`); `src/utils/board-changes-conformance.test.ts` replays it",
            "against the frontend's apply path and digest."
        ],
        "entries": entries,
        "cases": cases,
    })
}

#[test]
fn the_corpus_is_what_the_rust_side_produces() {
    let expected = corpus();
    if std::env::var("BOARD_CHANGES_REGEN").is_ok() {
        std::fs::write(
            CORPUS,
            serde_json::to_string_pretty(&expected).unwrap() + "\n",
        )
        .unwrap();
    }
    let written: Value = serde_json::from_str(&std::fs::read_to_string(CORPUS).unwrap())
        .expect("the corpus is JSON");
    assert_eq!(
        written, expected,
        "rerun with BOARD_CHANGES_REGEN=1 to rewrite it"
    );
}

#[test]
fn every_corpus_entry_round_trips_through_its_type_and_matches_its_digest() {
    let written: Value = serde_json::from_str(&std::fs::read_to_string(CORPUS).unwrap()).unwrap();
    let mut seen = HashSet::new();
    for entry in written["entries"].as_array().unwrap() {
        let collection = Collection::from_name(entry["collection"].as_str().unwrap()).unwrap();
        let json = entry["json"].as_str().unwrap();
        seen.insert(collection);
        assert_eq!(written_back(collection, json), json);
        let key = entry["key"].as_str().unwrap();
        assert_eq!(
            u64::from(digest(collection, key, json)),
            entry["digest"].as_u64().unwrap()
        );
    }
    assert_eq!(
        seen.len(),
        Collection::ALL.len(),
        "the corpus covers every collection"
    );
}

#[test]
fn every_corpus_case_diffs_to_its_changes_and_hashes_to_its_totals() {
    let written: Value = serde_json::from_str(&std::fs::read_to_string(CORPUS).unwrap()).unwrap();
    for case in written["cases"].as_array().unwrap() {
        let parse = |field: &str| -> MindmapLoad {
            serde_json::from_str(case[field].as_str().unwrap()).unwrap()
        };
        let (before, after) = (parse("before_json"), parse("after_json"));
        let changes = diff(&before, &after).unwrap();
        assert_eq!(
            changes.to_json().unwrap(),
            case["changes_json"].as_str().unwrap(),
            "{}",
            case["name"]
        );
        let hash = |board: &MindmapLoad| u64::from(BoardDigests::seed(board).unwrap().total());
        assert_eq!(hash(&before), case["hash_before"].as_u64().unwrap());
        assert_eq!(hash(&after), case["hash_after"].as_u64().unwrap());
    }
}

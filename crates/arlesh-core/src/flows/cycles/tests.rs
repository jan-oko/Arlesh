use super::*;

fn stored(id: i64, scope_index: i64, plan_start: Option<i64>) -> FlowItemCycle {
    FlowItemCycle {
        id,
        flow_id: 1,
        item_type: "flow_task".into(),
        item_id: 2,
        scope_kind: Some("day".into()),
        scope_index: Some(scope_index),
        plan_kind: plan_start.map(|_| "part_of_day".into()),
        plan_start,
        plan_end: plan_start,
        position: 0,
    }
}

fn asked(scope_index: i64, plan_start: Option<i64>) -> FlowCycleInput {
    FlowCycleInput {
        scope_kind: Some("day".into()),
        scope_index: Some(scope_index),
        plan_kind: plan_start.map(|_| "part_of_day".into()),
        plan_start,
        plan_end: plan_start,
    }
}

#[test]
fn asking_for_the_same_pairs_keeps_every_id_and_orphans_nothing() {
    let existing = [stored(10, 1, None), stored(11, 3, Some(2))];
    let wanted = [asked(1, None), asked(3, Some(2))];
    let diff = diff_cycles(&existing, &wanted);
    assert_eq!(
        diff.kept,
        vec![
            KeptPair {
                id: 10,
                position: 0
            },
            KeptPair {
                id: 11,
                position: 1
            }
        ]
    );
    assert!(diff.added.is_empty() && diff.removed.is_empty());
    assert!(orphaned_cycle_ids(&existing, &wanted, &diff).is_empty());
}

#[test]
fn a_plan_only_change_keeps_the_pair() {
    let existing = [stored(10, 1, Some(1))];
    let diff = diff_cycles(&existing, &[asked(1, Some(4))]);
    assert_eq!(
        diff.kept,
        vec![KeptPair {
            id: 10,
            position: 0
        }]
    );
    assert!(diff.removed.is_empty());
}

#[test]
fn a_moved_cycle_scope_is_a_new_pair_and_orphans_the_old_one() {
    let existing = [stored(10, 1, None)];
    let wanted = [asked(2, None)];
    let diff = diff_cycles(&existing, &wanted);
    assert_eq!(diff.added, vec![0]);
    assert_eq!(diff.removed, vec![10]);
    assert_eq!(orphaned_cycle_ids(&existing, &wanted, &diff), vec![10]);
}

#[test]
fn reordered_pairs_keep_their_ids_at_their_new_positions() {
    let existing = [stored(10, 1, None), stored(11, 3, None)];
    let diff = diff_cycles(&existing, &[asked(3, None), asked(1, None)]);
    assert_eq!(
        diff.kept,
        vec![
            KeptPair {
                id: 11,
                position: 0
            },
            KeptPair {
                id: 10,
                position: 1
            }
        ]
    );
}

#[test]
fn giving_an_unpaired_item_its_first_pair_orphans_the_no_pair_occurrence() {
    let wanted = [asked(1, None)];
    let diff = diff_cycles(&[], &wanted);
    assert_eq!(orphaned_cycle_ids(&[], &wanted, &diff), vec![NO_CYCLE]);
}

#[test]
fn taking_every_pair_away_orphans_each_of_them() {
    let existing = [stored(10, 1, None), stored(11, 3, None)];
    let diff = diff_cycles(&existing, &[]);
    assert_eq!(orphaned_cycle_ids(&existing, &[], &diff), vec![10, 11]);
}

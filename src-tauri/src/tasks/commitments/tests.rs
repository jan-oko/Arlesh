use super::*;

fn stored() -> Commitment {
    Commitment {
        id: 1.into(),
        title: "Asleep by 23:00".to_string(),
        parent_type: "project".to_string(),
        parent_id: 7.into(),
        verdict: Verdict::Unresolved,
        time_scope: Some(TimeScope {
            start_id: 10,
            end_id: 10,
            duration: None,
        }),
        verdict_window: Some(DurationSpec {
            n: 2,
            kind: "day".to_string(),
        }),
        tag_ids: vec![3],
        position: 100,
        is_private: false,
        // Tracked in `bd`. `CommitmentWrite` has no counterpart field, so the merge cannot
        // carry it either way — which is the write-path constraint, stated in the type.
        beads_id: Some("Arlesh-cyo".to_string()),
        origin: Default::default(),
    }
}

#[test]
fn an_empty_request_writes_the_stored_row_back_unchanged() {
    let write = CommitmentWrite::merge(stored(), UpdateCommitmentRequest::default()).unwrap();
    assert!(write.reparent.is_none());
    assert_eq!(write.parent_type, "project");
    assert_eq!(write.parent_id, 7);
    assert_eq!(write.title, "Asleep by 23:00");
    assert_eq!(write.verdict, Verdict::Unresolved);
    assert_eq!(write.position, 100);
    assert!(!write.is_private);
}

#[test]
fn recording_a_verdict_changes_nothing_else() {
    for verdict in [Verdict::Kept, Verdict::Broken] {
        let write = CommitmentWrite::merge(
            stored(),
            UpdateCommitmentRequest {
                verdict: Some(verdict),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(write.verdict, verdict);
        assert_eq!(write.time_scope, stored().time_scope);
        assert_eq!(write.verdict_window, stored().verdict_window);
    }
}

#[test]
fn a_verdict_can_be_taken_back_to_unresolved() {
    // A misclick has to be recoverable, and the way back is an ordinary write of the value
    // that means "you have not said" — not a separate clearing operation.
    let kept = Commitment {
        verdict: Verdict::Kept,
        ..stored()
    };
    let write = CommitmentWrite::merge(
        kept,
        UpdateCommitmentRequest {
            verdict: Some(Verdict::Unresolved),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(write.verdict, Verdict::Unresolved);
}

#[test]
fn clearing_the_time_scope_clears_it_rather_than_keeping_the_stored_one() {
    let write = CommitmentWrite::merge(
        stored(),
        UpdateCommitmentRequest {
            time_scope: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(write.time_scope, None);
}

#[test]
fn clearing_the_verdict_window_returns_it_to_inheriting() {
    // `Some(None)` is "stop setting one of my own", not "never expire": what happens next is
    // whatever the nearest ancestor Commitment says.
    let write = CommitmentWrite::merge(
        stored(),
        UpdateCommitmentRequest {
            verdict_window: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(write.verdict_window, None);
}

#[test]
fn setting_a_verdict_window_replaces_the_stored_one() {
    let week = DurationSpec {
        n: 1,
        kind: "week".to_string(),
    };
    let write = CommitmentWrite::merge(
        stored(),
        UpdateCommitmentRequest {
            verdict_window: Some(Some(week.clone())),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(write.verdict_window, Some(week));
}

#[test]
fn a_reparent_needs_both_halves_and_becomes_the_validated_parent() {
    let half = CommitmentWrite::merge(
        stored(),
        UpdateCommitmentRequest {
            parent_type: Some("commitment".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        half.reparent.is_none(),
        "a parent type without an id is not a move"
    );
    assert_eq!(half.parent_type, "project");

    let full = CommitmentWrite::merge(
        stored(),
        UpdateCommitmentRequest {
            parent_type: Some("commitment".into()),
            parent_id: Some(42),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(full.reparent, Some(("commitment".to_string(), 42)));
    assert_eq!(full.parent_type, "commitment");
    assert_eq!(full.parent_id, 42);
}

#[test]
fn a_verdict_window_travels_to_the_database_as_a_pair_or_not_at_all() {
    let (n, kind) = verdict_window_columns(&Some(DurationSpec {
        n: 3,
        kind: "week".into(),
    }));
    assert_eq!((n, kind), (Some(3), Some("week".to_string())));
    assert_eq!(verdict_window_columns(&None), (None, None));
}

#[test]
fn half_a_stored_verdict_window_reads_as_none_rather_than_as_a_guess() {
    assert_eq!(
        verdict_window_from_row(Some(2), Some("day".into())),
        Some(DurationSpec {
            n: 2,
            kind: "day".to_string()
        }),
    );
    assert_eq!(verdict_window_from_row(Some(2), None), None);
    assert_eq!(verdict_window_from_row(None, Some("day".into())), None);
    assert_eq!(verdict_window_from_row(None, None), None);
}

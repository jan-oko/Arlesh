//! The composite operations against a migrated in-memory board.
//!
//! The board:
//!
//! ```text
//! Growth (domain 1, opened to the MCP as a root)
//! ├── Arlesh (domain 2)
//! │   ├── Ship (goal 10)
//! │   │   └── Docs (task 100, Agentic)
//! │   └── Launch (goal 11)
//! │       └── Announce (task 101, Agentic)
//! └── Body (domain 3)
//! Elsewhere (domain 4, not opened)
//! ```

use super::*;
use crate::access::model::NodeTable;
use crate::database::session::{Db, Transactional};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

fn at(text: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(text, TIME_FORMAT).unwrap()
}

fn node(kind: NodeTable, id: i64) -> NodeKey {
    NodeKey::new(kind, id)
}

struct Board {
    pool: SqlitePool,
    factory: SessionFactory,
}

async fn board() -> Board {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::database::run_migrations(&pool).await.unwrap();
    for sql in [
        "INSERT INTO domains (id, title, subtype) VALUES (901, 'Growth', 'aspect')",
        "INSERT INTO domains (id, title, subtype, parent_id, status) VALUES (902, 'Arlesh', 'project', 901, 'active')",
        "INSERT INTO domains (id, title, subtype, parent_id, status) VALUES (903, 'Body', 'project', 901, 'active')",
        "INSERT INTO domains (id, title, subtype) VALUES (904, 'Elsewhere', 'aspect')",
        "INSERT INTO goals (id, title, parent_type, parent_id, status) VALUES (10, 'Ship', 'domain', 902, 'active')",
        "INSERT INTO goals (id, title, parent_type, parent_id, status) VALUES (11, 'Launch', 'domain', 902, 'active')",
        "INSERT INTO tasks (id, title, parent_type, parent_id, status, agentic) VALUES (100, 'Docs', 'goal', 10, 'agentic_todo', 1)",
        "INSERT INTO tasks (id, title, parent_type, parent_id, status, agentic) VALUES (101, 'Announce', 'goal', 11, 'agentic_todo', 1)",
        "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', 901)",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    let factory = SessionFactory::new(pool.clone());
    Board { pool, factory }
}

impl Board {
    async fn db(&self) -> Db<Transactional> {
        self.factory.begin().await.unwrap()
    }

    async fn pin(&self, now: &str) -> String {
        let mut db = self.db().await;
        let issued = issue_pin(&mut db, at(now)).await.unwrap();
        db.commit().await.unwrap();
        issued.pin
    }

    async fn attach(&self, name: &str, account: &str, now: &str) -> Attached {
        let pin = self.pin(now).await;
        attach(
            &self.factory,
            at(now),
            AttachRequest {
                credential: Credential::Pin(pin),
                session_uuid: format!("session-{name}"),
                name: Some(name.to_owned()),
                account: Some(account.to_owned()),
            },
        )
        .await
        .unwrap()
    }

    async fn claim(&self, agent: AgentId, root: NodeKey, now: &str) -> Result<Agent, AgentError> {
        let mut db = self.db().await;
        let claimed = claim(&mut db, agent, root, at(now)).await?;
        db.commit().await.unwrap();
        Ok(claimed)
    }

    async fn act(&self, agent: AgentId, action: AgentAction) -> Result<(), AgentError> {
        let mut db = self.db().await;
        act(&mut db, agent, action).await?;
        db.commit().await.unwrap();
        Ok(())
    }

    async fn view(&self, agent: AgentId) -> AgentView {
        let mut db = self.db().await;
        view(&mut db, agent).await.unwrap().unwrap()
    }

    async fn blocking(&self, now: &str) -> Blocking {
        let mut db = self.db().await;
        blocking(&mut db, at(now)).await.unwrap()
    }

    async fn report(&self, agent: AgentId, kind: &str, percent: f64, resets: &str, now: &str) {
        let mut db = self.db().await;
        report_usage(
            &mut db,
            agent,
            &[UsageWindow {
                kind: kind.to_owned(),
                percent_used: percent,
                resets_at: resets.to_owned(),
            }],
            at(now),
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
    }
}

const NOW: &str = "2026-11-07T10:00:00";

#[tokio::test]
async fn a_pin_makes_an_agent_with_a_token_and_is_spent_by_it() {
    let board = board().await;
    let pin = board.pin(NOW).await;
    let request = |pin: &str| AttachRequest {
        credential: Credential::Pin(pin.to_owned()),
        session_uuid: "session-1".to_owned(),
        name: Some("writer".to_owned()),
        account: Some("work".to_owned()),
    };

    let attached = attach(&board.factory, at(NOW), request(&pin))
        .await
        .unwrap();
    let again = attach(&board.factory, at(NOW), request(&pin)).await;

    assert_eq!(attached.agent.name, "writer");
    assert_eq!(attached.agent.account, "work");
    assert!(attached.token.is_some());
    assert!(matches!(again, Err(AgentError::PinInvalid)));
}

#[tokio::test]
async fn a_pin_lapses() {
    let board = board().await;
    let pin = board.pin(NOW).await;

    let late = attach(
        &board.factory,
        at("2026-11-07T10:05:00"),
        AttachRequest {
            credential: Credential::Pin(pin),
            session_uuid: "s".to_owned(),
            name: None,
            account: None,
        },
    )
    .await;

    assert!(matches!(late, Err(AgentError::PinInvalid)));
}

#[tokio::test]
async fn five_wrong_pins_shut_the_door_even_to_the_right_one() {
    let board = board().await;
    let good = board.pin(NOW).await;
    let wrong = |pin: &str| AttachRequest {
        credential: Credential::Pin(pin.to_owned()),
        session_uuid: "s".to_owned(),
        name: None,
        account: None,
    };

    for _ in 0..5 {
        let outcome = attach(&board.factory, at(NOW), wrong("00000000")).await;
        assert!(matches!(
            outcome,
            Err(AgentError::PinInvalid | AgentError::PinLockedOut)
        ));
    }
    let outcome = attach(&board.factory, at(NOW), wrong(&good)).await;

    assert!(
        matches!(outcome, Err(AgentError::PinLockedOut)),
        "{outcome:?}"
    );
}

#[tokio::test]
async fn the_token_brings_the_same_agent_back_with_a_new_session() {
    let board = board().await;
    let first = board.attach("writer", "work", NOW).await;

    let again = attach(
        &board.factory,
        at("2026-11-07T11:00:00"),
        AttachRequest {
            credential: Credential::Token(first.token.clone().unwrap()),
            session_uuid: "session-resumed".to_owned(),
            name: Some("ignored".to_owned()),
            account: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(again.agent.id, first.agent.id);
    assert_eq!(again.agent.name, "writer");
    assert_eq!(again.agent.session_uuid, "session-resumed");
    assert_eq!(again.token, None, "the token is shown once");
}

#[tokio::test]
async fn a_token_nobody_issued_is_refused() {
    let board = board().await;

    let outcome = attach(
        &board.factory,
        at(NOW),
        AttachRequest {
            credential: Credential::Token("nope".to_owned()),
            session_uuid: "s".to_owned(),
            name: None,
            account: None,
        },
    )
    .await;

    assert!(matches!(outcome, Err(AgentError::TokenInvalid)));
}

#[tokio::test]
async fn two_agents_asking_for_one_name_get_two_names() {
    let board = board().await;

    let first = board.attach("writer", "work", NOW).await;
    let second = board.attach("writer", "work", NOW).await;

    assert_eq!(first.agent.name, "writer");
    assert_eq!(second.agent.name, "writer-2");
}

#[tokio::test]
async fn a_claim_inside_the_roots_is_taken_and_one_outside_is_refused() {
    let board = board().await;
    let agent = board.attach("writer", "work", NOW).await.agent.id;

    let inside = board
        .claim(agent, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();
    let outside = board.claim(agent, node(NodeTable::Domain, 904), NOW).await;

    assert_eq!(inside.claim.unwrap().root, node(NodeTable::Goal, 10));
    assert!(matches!(outside, Err(AgentError::OutsideRoots(_))));
}

#[tokio::test]
async fn an_overlapping_claim_is_refused_naming_the_first_agent() {
    let board = board().await;
    let first = board.attach("writer", "work", NOW).await.agent.id;
    let second = board.attach("reviewer", "work", NOW).await.agent.id;
    board
        .claim(first, node(NodeTable::Domain, 902), NOW)
        .await
        .unwrap();

    let refused = board.claim(second, node(NodeTable::Goal, 10), NOW).await;

    match refused {
        Err(AgentError::Overlaps { holder, .. }) => assert_eq!(holder, "writer"),
        other => panic!("expected an overlap, got {other:?}"),
    }
}

#[tokio::test]
async fn a_paused_claim_frees_the_subtree_and_resuming_is_refused_while_it_is_taken() {
    let board = board().await;
    let first = board.attach("writer", "work", NOW).await.agent.id;
    let second = board.attach("reviewer", "work", NOW).await.agent.id;
    board
        .claim(first, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();
    board.act(first, AgentAction::Pause).await.unwrap();

    board
        .claim(second, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();
    let resumed = board.act(first, AgentAction::Resume).await;

    assert!(matches!(resumed, Err(AgentError::Overlaps { .. })));

    board.act(second, AgentAction::Release).await.unwrap();
    board.act(first, AgentAction::Resume).await.unwrap();
    assert_eq!(board.view(first).await.standing, AgentStanding::Active);
}

#[tokio::test]
async fn an_agent_sees_and_writes_its_claim_and_nothing_else() {
    let board = board().await;
    let agent = board.attach("writer", "work", NOW).await.agent.id;
    board
        .claim(agent, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();

    let view = board.view(agent).await;

    assert!(view.map.can_write(node(NodeTable::Task, 100)));
    assert!(view.map.can_read(node(NodeTable::Goal, 10)));
    assert!(
        !view.map.can_read(node(NodeTable::Task, 101)),
        "a sibling subtree"
    );
    assert!(
        !view.map.can_read(node(NodeTable::Domain, 902)),
        "an ancestor"
    );
}

#[tokio::test]
async fn an_agent_without_a_claim_sees_nothing() {
    let board = board().await;
    let agent = board.attach("writer", "work", NOW).await.agent.id;

    let view = board.view(agent).await;

    assert_eq!(view.standing, AgentStanding::Unclaimed);
    assert!(!view.map.can_read(node(NodeTable::Task, 100)));
}

#[tokio::test]
async fn a_paused_claim_reads_and_writes_nothing() {
    let board = board().await;
    let agent = board.attach("writer", "work", NOW).await.agent.id;
    board
        .claim(agent, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();
    board.act(agent, AgentAction::Pause).await.unwrap();

    let view = board.view(agent).await;

    assert_eq!(view.standing, AgentStanding::Paused);
    assert!(view.map.can_read(node(NodeTable::Task, 100)));
    assert!(!view.map.can_write(node(NodeTable::Task, 100)));
    assert!(!view.map.may_create_task_under(node(NodeTable::Goal, 10)));
}

#[tokio::test]
async fn a_task_moved_out_of_the_claim_leaves_the_view_at_once() {
    let board = board().await;
    let agent = board.attach("writer", "work", NOW).await.agent.id;
    board
        .claim(agent, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();

    sqlx::query("UPDATE tasks SET parent_id = 11 WHERE id = 100")
        .execute(&board.pool)
        .await
        .unwrap();

    assert!(!board
        .view(agent)
        .await
        .map
        .can_read(node(NodeTable::Task, 100)));
}

#[tokio::test]
async fn a_claim_moved_under_an_older_one_is_shadowed_and_sees_nothing() {
    let board = board().await;
    let older = board.attach("writer", "work", NOW).await.agent.id;
    let younger = board.attach("reviewer", "work", NOW).await.agent.id;
    board
        .claim(older, node(NodeTable::Domain, 903), "2026-11-07T10:00:00")
        .await
        .unwrap();
    board
        .claim(younger, node(NodeTable::Goal, 10), "2026-11-07T11:00:00")
        .await
        .unwrap();

    sqlx::query("UPDATE goals SET parent_type = 'domain', parent_id = 903 WHERE id = 10")
        .execute(&board.pool)
        .await
        .unwrap();

    let shadowed = board.view(younger).await;
    assert_eq!(shadowed.standing, AgentStanding::Shadowed);
    assert!(!shadowed.map.can_read(node(NodeTable::Task, 100)));
    assert_eq!(board.view(older).await.standing, AgentStanding::Active);
}

#[tokio::test]
async fn a_claim_whose_root_left_the_users_roots_is_unreachable() {
    let board = board().await;
    let agent = board.attach("writer", "work", NOW).await.agent.id;
    board
        .claim(agent, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();

    sqlx::query("DELETE FROM mcp_roots")
        .execute(&board.pool)
        .await
        .unwrap();

    let view = board.view(agent).await;
    assert_eq!(view.standing, AgentStanding::Unreachable);
    assert!(!view.map.can_read(node(NodeTable::Task, 100)));
}

#[tokio::test]
async fn a_removed_agent_has_no_view_and_its_token_is_dead() {
    let board = board().await;
    let attached = board.attach("writer", "work", NOW).await;
    board
        .act(attached.agent.id, AgentAction::Remove)
        .await
        .unwrap();

    let mut db = board.db().await;
    assert!(view(&mut db, attached.agent.id).await.unwrap().is_none());
    drop(db);
    let outcome = attach(
        &board.factory,
        at(NOW),
        AttachRequest {
            credential: Credential::Token(attached.token.unwrap()),
            session_uuid: "s".to_owned(),
            name: None,
            account: None,
        },
    )
    .await;
    assert!(matches!(outcome, Err(AgentError::TokenInvalid)));
}

#[tokio::test]
async fn a_full_window_blocks_only_that_accounts_claims_until_it_resets() {
    let board = board().await;
    let work = board.attach("writer", "work", NOW).await.agent.id;
    let home = board.attach("reviewer", "home", NOW).await.agent.id;
    board
        .claim(work, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();
    board
        .claim(home, node(NodeTable::Goal, 11), NOW)
        .await
        .unwrap();

    board
        .report(work, "five_hour", 100.0, "2026-11-07T14:00:00", NOW)
        .await;

    let during = board.blocking("2026-11-07T12:00:00").await;
    assert_eq!(during.subtrees, vec![node(NodeTable::Goal, 10)]);
    let after = board.blocking("2026-11-07T14:00:00").await;
    assert!(after.is_none(), "it lifts at the reset by itself");
}

#[tokio::test]
async fn an_account_below_its_limit_blocks_nothing() {
    let board = board().await;
    let work = board.attach("writer", "work", NOW).await.agent.id;
    board
        .claim(work, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();

    board
        .report(work, "five_hour", 99.0, "2026-11-07T14:00:00", NOW)
        .await;

    assert!(board.blocking(NOW).await.is_none());
}

#[tokio::test]
async fn a_manual_lock_on_an_agent_or_its_account_blocks_its_claim() {
    let board = board().await;
    let work = board.attach("writer", "work", NOW).await.agent.id;
    board
        .claim(work, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();

    board
        .act(work, AgentAction::Lock { locked: true })
        .await
        .unwrap();
    assert_eq!(board.blocking(NOW).await.subtrees.len(), 1);
    board
        .act(work, AgentAction::Lock { locked: false })
        .await
        .unwrap();
    assert!(board.blocking(NOW).await.is_none());

    let mut db = board.db().await;
    set_account_locked(&mut db, "work", true).await.unwrap();
    db.commit().await.unwrap();
    assert_eq!(board.blocking(NOW).await.subtrees.len(), 1);
}

#[tokio::test]
async fn a_paused_claim_is_not_blocked_because_it_is_not_held() {
    let board = board().await;
    let work = board.attach("writer", "work", NOW).await.agent.id;
    board
        .claim(work, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();
    board
        .act(work, AgentAction::Lock { locked: true })
        .await
        .unwrap();
    board.act(work, AgentAction::Pause).await.unwrap();

    assert!(board.blocking(NOW).await.is_none());
}

#[tokio::test]
async fn the_overview_says_where_each_claim_stands_and_why_an_agent_is_at_capacity() {
    let board = board().await;
    let work = board.attach("writer", "work", NOW).await.agent.id;
    board
        .claim(work, node(NodeTable::Goal, 10), NOW)
        .await
        .unwrap();
    board
        .report(work, "five_hour", 100.0, "2026-11-07T14:00:00", NOW)
        .await;

    let mut db = board.db().await;
    let overview = overview(&mut db, at(NOW)).await.unwrap();

    assert_eq!(overview.agents.len(), 1);
    assert_eq!(overview.agents[0].standing, AgentStanding::Active);
    assert_eq!(
        overview.agents[0].at_capacity,
        Some(CapacityCause::UsageLimit {
            window: "five_hour".to_owned(),
            resets_at: "2026-11-07T14:00:00".to_owned(),
        })
    );
    assert_eq!(overview.accounts[0].label, "work");
    assert_eq!(overview.accounts[0].windows[0].percent_used, 100.0);
}

#[tokio::test]
async fn a_usage_report_is_checked() {
    let board = board().await;
    let work = board.attach("writer", "work", NOW).await.agent.id;
    let mut db = board.db().await;

    let negative = report_usage(
        &mut db,
        work,
        &[UsageWindow {
            kind: "five_hour".to_owned(),
            percent_used: -1.0,
            resets_at: "2026-11-07T14:00:00".to_owned(),
        }],
        at(NOW),
    )
    .await;
    let undated = report_usage(
        &mut db,
        work,
        &[UsageWindow {
            kind: "five_hour".to_owned(),
            percent_used: 50.0,
            resets_at: "soon".to_owned(),
        }],
        at(NOW),
    )
    .await;

    assert!(matches!(negative, Err(AgentError::Invalid(_))));
    assert!(matches!(undated, Err(AgentError::Invalid(_))));
}

#[test]
fn an_instant_with_an_offset_becomes_local_time_and_one_without_is_kept() {
    assert_eq!(
        normalise_time("2026-11-07T14:00:00").unwrap(),
        "2026-11-07T14:00:00"
    );
    assert_eq!(
        normalise_time("2026-11-07T14:00:00.250").unwrap(),
        "2026-11-07T14:00:00"
    );
    assert!(normalise_time("2026-11-07T14:00:00Z").is_ok());
    assert!(normalise_time("tomorrow").is_err());
}

#[tokio::test]
async fn the_connect_token_is_checked_by_digest_and_replaced_by_a_new_one() {
    let board = board().await;
    let mut db = board.db().await;

    let first = issue_connect_token(&mut db, at(NOW)).await.unwrap();
    assert!(connect_token_is_valid(&mut db, &first, at(NOW))
        .await
        .unwrap());
    assert!(!connect_token_is_valid(&mut db, "other", at(NOW))
        .await
        .unwrap());

    let second = issue_connect_token(&mut db, at(NOW)).await.unwrap();
    assert!(!connect_token_is_valid(&mut db, &first, at(NOW))
        .await
        .unwrap());
    assert!(connect_token_is_valid(&mut db, &second, at(NOW))
        .await
        .unwrap());
}

//! The composite operations on Agents: attaching, claiming, viewing, reporting usage and the
//! capacity they derive.
//!
//! Each gathers what a rule needs — the board's shape, the user's roots, the other agents' Claims,
//! the accounts' reports — and hands it to [`super::rules`]; the rules decide. Times arrive as
//! `now`, never read here, except [`normalise_time`], which turns a client's spelling of an
//! instant into the local one the tables keep.

use std::collections::HashMap;

use chrono::NaiveDateTime;

use super::{
    error::AgentError,
    model::{
        Account, Agent, AgentAction, AgentId, AgentStanding, AgentSummary, AgentsOverview,
        CapacityCause, ClaimStatus, IssuedPin, UsageWindow,
    },
    rules::{
        claims::{self, Held, Lineage, Refusal},
        names, pins,
        usage::{self, Window},
    },
    secret,
};
use crate::{
    access::{
        self,
        model::NodeKey,
        resolve::AccessMap,
    },
    capacity::blocks::Blocking,
    database::session::{Db, SessionFactory, SessionMode},
};

/// The stored spelling of an instant: local, to the second, ISO 8601.
const TIME_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

/// The name an agent gets when it gives none.
const DEFAULT_NAME: &str = "agent";

/// The account an agent works under when it names none.
const DEFAULT_ACCOUNT: &str = "default";

/// The longest session id kept.
const MAX_SESSION_ID: usize = 128;

/// What an attach presents to be let in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    /// A one-time PIN from a signed-in client: makes a new Agent.
    Pin(String),
    /// The token a previous attach answered: brings the same Agent back.
    Token(String),
}

/// A request to attach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachRequest {
    /// What lets it in.
    pub credential: Credential,
    /// The client's session id.
    pub session_uuid: String,
    /// The name it asks for; made unique. Ignored when it attaches with a token.
    pub name: Option<String>,
    /// The account it works under. Ignored when it attaches with a token.
    pub account: Option<String>,
}

/// The answer to an attach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attached {
    /// The Agent, as it stands.
    pub agent: Agent,
    /// The agent token, shown this once: only when a PIN made the Agent.
    pub token: Option<String>,
}

/// An Agent's view of the board and where its Claim stands.
#[derive(Debug, Clone)]
pub struct AgentView {
    /// The Agent.
    pub agent: Agent,
    /// What it may see and write: its Claim's subtree, or nothing.
    pub map: AccessMap,
    /// Where its Claim stands.
    pub standing: AgentStanding,
}

fn format_time(time: NaiveDateTime) -> String {
    time.format(TIME_FORMAT).to_string()
}

fn parse_time(text: &str) -> Result<NaiveDateTime, AgentError> {
    NaiveDateTime::parse_from_str(text, TIME_FORMAT)
        .map_err(|_| AgentError::Corrupt(format!("stored time {text:?}")))
}

/// `text` — an ISO 8601 instant, with or without an offset — as the local time the tables keep.
pub fn normalise_time(text: &str) -> Result<String, AgentError> {
    if let Ok(zoned) = chrono::DateTime::parse_from_rfc3339(text) {
        return Ok(format_time(
            zoned.with_timezone(&chrono::Local).naive_local(),
        ));
    }
    NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.f")
        .map(format_time)
        .map_err(|_| AgentError::Invalid(format!("{text:?} is not an ISO 8601 date and time")))
}

/// Asks for a PIN to give an agent. The caller must be a signed-in client.
#[tracing::instrument(skip(db))]
pub async fn issue_pin<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
) -> Result<IssuedPin, AgentError> {
    db.agents().purge_pins(&format_time(now)).await?;
    if db.agents().pending_pins().await? >= pins::MAX_PENDING {
        return Err(AgentError::TooManyPins);
    }
    let expires_at = format_time(now + pins::lifetime());
    for _ in 0..20 {
        let pin = secret::random_pin()?;
        if db
            .agents()
            .insert_pin(&pin, &format_time(now), &expires_at)
            .await?
        {
            return Ok(IssuedPin { pin, expires_at });
        }
    }
    Err(AgentError::TooManyPins)
}

/// Counts the PIN against the door and uses it up. A wrong PIN is counted, and a run of them
/// empties the table of PINs, so a guess cannot be followed by a lucky second.
async fn redeem_pin<M: SessionMode>(
    db: &mut Db<M>,
    pin: &str,
    now: NaiveDateTime,
) -> Result<(), AgentError> {
    let stamp = format_time(now);
    db.agents().purge_pins(&stamp).await?;
    let since = format_time(now - pins::failure_memory());
    if door_shut(db, &since, now).await? {
        return Err(AgentError::PinLockedOut);
    }
    let Some(expires) = db.agents().take_pin(pin).await? else {
        db.agents().record_pin_failure(&stamp).await?;
        if door_shut(db, &since, now).await? {
            db.agents().clear_pins().await?;
        }
        return Err(AgentError::PinInvalid);
    };
    if pins::live(parse_time(&expires)?, now) {
        Ok(())
    } else {
        Err(AgentError::PinInvalid)
    }
}

async fn door_shut<M: SessionMode>(
    db: &mut Db<M>,
    since: &str,
    now: NaiveDateTime,
) -> Result<bool, AgentError> {
    let failures: Result<Vec<_>, _> = db
        .agents()
        .pin_failures(since)
        .await?
        .iter()
        .map(|text| parse_time(text))
        .collect();
    Ok(pins::locked_out(&failures?, now))
}

/// Attaches a session: with a PIN it makes an Agent and answers its token; with a token it brings
/// the Agent back. Claiming is a step of its own ([`claim`]), made once the session is bound, so a
/// caller that has not proved itself learns nothing about the board.
///
/// A wrong PIN is counted even though the attach fails.
#[tracing::instrument(skip(factory, request), fields(session = %request.session_uuid))]
pub async fn attach(
    factory: &SessionFactory,
    now: NaiveDateTime,
    request: AttachRequest,
) -> Result<Attached, AgentError> {
    let session = request.session_uuid.trim().to_owned();
    if session.is_empty() || session.chars().count() > MAX_SESSION_ID {
        return Err(AgentError::Invalid(
            "session_id must be the client's session id, up to 128 characters".to_owned(),
        ));
    }
    let mut db = factory.begin().await?;
    let stamp = format_time(now);
    let (id, token) = match &request.credential {
        Credential::Pin(pin) => {
            if let Err(error) = redeem_pin(&mut db, pin, now).await {
                // Commit so the failure counts, though the attach does not go through.
                db.commit().await?;
                return Err(error);
            }
            let name = names::tidy(request.name.as_deref().unwrap_or(DEFAULT_NAME))
                .unwrap_or_else(|| DEFAULT_NAME.to_owned());
            let taken: Vec<String> = db
                .agents()
                .all()
                .await?
                .into_iter()
                .map(|agent| agent.name)
                .collect();
            let account = names::tidy(request.account.as_deref().unwrap_or(DEFAULT_ACCOUNT))
                .unwrap_or_else(|| DEFAULT_ACCOUNT.to_owned());
            db.agents().ensure_account(&account).await?;
            let token = secret::random_token()?;
            let id = db
                .agents()
                .insert(
                    &names::unique(&name, &taken),
                    &account,
                    &session,
                    &secret::digest(&token),
                    &stamp,
                )
                .await?;
            (id, Some(token))
        }
        Credential::Token(token) => {
            let agent = db
                .agents()
                .by_token(&secret::digest(token))
                .await?
                .ok_or(AgentError::TokenInvalid)?;
            db.agents().rebind(agent.id, &session, &stamp).await?;
            (agent.id, None)
        }
    };
    let agent = db
        .agents()
        .get(id)
        .await?
        .ok_or(AgentError::NotFound(id))?;
    db.commit().await?;
    Ok(Attached { agent, token })
}

/// The facts a Claim is judged against: the board's shape, what the user's roots open, and every
/// agent.
struct Ground {
    lineage: Lineage,
    user_map: AccessMap,
    agents: Vec<Agent>,
    nodes: Vec<crate::access::model::StoredNode>,
}

impl Ground {
    async fn read<M: SessionMode>(db: &mut Db<M>) -> Result<Self, AgentError> {
        let nodes = access::stored_nodes(db).await?;
        let roots = db.access().roots().await?;
        Ok(Self {
            lineage: Lineage::of(&nodes),
            user_map: AccessMap::resolve(&nodes, &roots),
            agents: db.agents().all().await?,
            nodes,
        })
    }

    /// Every active Claim, as the rules hold them.
    fn held(&self) -> Vec<Held> {
        self.agents
            .iter()
            .filter_map(|agent| {
                let claim = agent.claim.as_ref()?;
                (claim.status == ClaimStatus::Active).then(|| Held {
                    agent: agent.id,
                    root: claim.root,
                    claimed_at: claim.claimed_at.clone(),
                })
            })
            .collect()
    }

    fn name_of(&self, id: AgentId) -> String {
        self.agents
            .iter()
            .find(|agent| agent.id == id)
            .map_or_else(|| id.to_string(), |agent| agent.name.clone())
    }

    /// Whether `agent` may hold an active Claim on `node`.
    fn permit(&self, agent: AgentId, node: NodeKey) -> Result<(), AgentError> {
        let readable = self.user_map.can_read(node);
        claims::check(&self.lineage, node, readable, &self.held(), agent).map_err(
            |refusal| match refusal {
                Refusal::OutsideRoots => AgentError::OutsideRoots(node),
                Refusal::Overlaps { holder } => AgentError::Overlaps {
                    node,
                    holder: self.name_of(holder),
                },
            },
        )
    }

    /// Where an agent's Claim stands, given the Claims that are shadowed.
    fn standing_of(&self, agent: &Agent, shadowed: &std::collections::HashSet<AgentId>) -> AgentStanding {
        let claim = agent
            .claim
            .as_ref()
            .map(|claim| (claim.status, claim.root));
        let readable = agent
            .claim
            .as_ref()
            .is_some_and(|claim| self.user_map.can_read(claim.root));
        claims::standing(claim, readable, shadowed.contains(&agent.id))
    }
}

/// Gives the Agent an active Claim on `node`, replacing any it held, if the rules allow.
async fn claim_in<M: SessionMode>(
    db: &mut Db<M>,
    id: AgentId,
    node: NodeKey,
    now: NaiveDateTime,
) -> Result<(), AgentError> {
    let ground = Ground::read(db).await?;
    let agent = ground
        .agents
        .iter()
        .find(|agent| agent.id == id)
        .ok_or(AgentError::NotFound(id))?;
    if let Some(claim) = &agent.claim {
        if claim.root == node && claim.status == ClaimStatus::Active {
            return Ok(());
        }
    }
    ground.permit(id, node)?;
    db.agents().set_claim(id, node, &format_time(now)).await?;
    Ok(())
}

/// Gives the Agent an active Claim on `node`, replacing any it held. Refused when `node` is not
/// inside the user's MCP roots, or overlaps another agent's active Claim.
#[tracing::instrument(skip(db))]
pub async fn claim<M: SessionMode>(
    db: &mut Db<M>,
    id: AgentId,
    node: NodeKey,
    now: NaiveDateTime,
) -> Result<Agent, AgentError> {
    claim_in(db, id, node, now).await?;
    db.agents().get(id).await?.ok_or(AgentError::NotFound(id))
}

/// Applies a change to an Agent: what the agent does to itself, and what the user does by hand.
#[tracing::instrument(skip(db))]
pub async fn act<M: SessionMode>(
    db: &mut Db<M>,
    id: AgentId,
    action: AgentAction,
) -> Result<Option<Agent>, AgentError> {
    let agent = db
        .agents()
        .get(id)
        .await?
        .ok_or(AgentError::NotFound(id))?;
    match action {
        AgentAction::Pause => {
            agent.claim.as_ref().ok_or(AgentError::NoClaim(id))?;
            db.agents().set_paused(id, true).await?;
        }
        AgentAction::Resume => {
            let held = agent.claim.as_ref().ok_or(AgentError::NoClaim(id))?;
            if held.status == ClaimStatus::Paused {
                Ground::read(db).await?.permit(id, held.root)?;
                db.agents().set_paused(id, false).await?;
            }
        }
        AgentAction::Release => {
            agent.claim.as_ref().ok_or(AgentError::NoClaim(id))?;
            db.agents().clear_claim(id).await?;
        }
        AgentAction::Lock { locked } => db.agents().set_locked(id, locked).await?,
        AgentAction::Remove => {
            db.agents().delete(id).await?;
            return Ok(None);
        }
    }
    Ok(db.agents().get(id).await?)
}

/// Locks or unlocks a whole account by hand.
#[tracing::instrument(skip(db))]
pub async fn set_account_locked<M: SessionMode>(
    db: &mut Db<M>,
    label: &str,
    locked: bool,
) -> Result<(), AgentError> {
    let label = names::tidy(label)
        .ok_or_else(|| AgentError::Invalid("an account needs a label".to_owned()))?;
    db.agents().set_account_locked(&label, locked).await
}

/// Records what an agent reports of its account's limit windows. Each window is kept as its last
/// report; a report for a window already known replaces it.
#[tracing::instrument(skip(db, windows))]
pub async fn report_usage<M: SessionMode>(
    db: &mut Db<M>,
    id: AgentId,
    windows: &[UsageWindow],
    now: NaiveDateTime,
) -> Result<(), AgentError> {
    let agent = db
        .agents()
        .get(id)
        .await?
        .ok_or(AgentError::NotFound(id))?;
    for window in windows {
        let kind = names::tidy(&window.kind)
            .ok_or_else(|| AgentError::Invalid("a usage window needs a kind".to_owned()))?;
        if !window.percent_used.is_finite() || window.percent_used < 0.0 {
            return Err(AgentError::Invalid(format!(
                "percent_used for {kind} must be a number from 0 up"
            )));
        }
        let reported = UsageWindow {
            kind,
            percent_used: window.percent_used,
            resets_at: normalise_time(&window.resets_at)?,
        };
        db.agents()
            .record_usage(&agent.account, &reported, &format_time(now))
            .await?;
    }
    Ok(())
}

/// What an Agent sees and where its Claim stands, as the board stands now.
///
/// Its view is its Claim's subtree **intersected** with what the user's MCP roots open, so a Claim
/// whose root has since left them, gone private or been deleted sees nothing, and a Claim set
/// aside because an older one now overlaps it sees nothing either. A paused Claim reads and writes
/// nothing. Judged afresh on every call: a node moved into or out of the subtree changes the next
/// answer.
#[tracing::instrument(skip(db))]
pub async fn view<M: SessionMode>(
    db: &mut Db<M>,
    id: AgentId,
) -> Result<Option<AgentView>, AgentError> {
    let ground = Ground::read(db).await?;
    let Some(agent) = ground.agents.iter().find(|agent| agent.id == id).cloned() else {
        return Ok(None);
    };
    let shadowed = claims::shadowed(&ground.lineage, &ground.held());
    let standing = ground.standing_of(&agent, &shadowed);
    let roots: Vec<NodeKey> = match (&agent.claim, standing) {
        (Some(claim), AgentStanding::Active | AgentStanding::Paused) => vec![claim.root],
        _ => Vec::new(),
    };
    let map = AccessMap::resolve(&ground.nodes, &roots);
    let map = if standing == AgentStanding::Paused {
        map.read_only()
    } else {
        map
    };
    Ok(Some(AgentView {
        agent,
        map,
        standing,
    }))
}

/// The accounts, with the windows each has reported.
async fn accounts<M: SessionMode>(db: &mut Db<M>) -> Result<Vec<Account>, AgentError> {
    let mut windows: HashMap<String, Vec<UsageWindow>> = HashMap::new();
    for (account, window) in db.agents().usage().await? {
        windows.entry(account).or_default().push(window);
    }
    let mut known = db.agents().accounts().await?;
    for account in windows.keys() {
        if !known.iter().any(|(label, _)| label == account) {
            known.push((account.clone(), false));
        }
    }
    known.sort();
    Ok(known
        .into_iter()
        .map(|(label, locked)| Account {
            windows: windows.remove(&label).unwrap_or_default(),
            label,
            locked,
        })
        .collect())
}

fn usage_windows(account: &Account) -> Result<Vec<Window>, AgentError> {
    account
        .windows
        .iter()
        .map(|window| {
            Ok(Window {
                kind: window.kind.clone(),
                percent_used: window.percent_used,
                resets_at: parse_time(&window.resets_at)?,
            })
        })
        .collect()
}

/// Why `agent` is at capacity at `now`, given the accounts, or `None`.
fn cause_for(
    agent: &Agent,
    accounts: &[Account],
    now: NaiveDateTime,
) -> Result<Option<CapacityCause>, AgentError> {
    let account = accounts.iter().find(|account| account.label == agent.account);
    let windows = account.map(usage_windows).transpose()?.unwrap_or_default();
    Ok(usage::cause(
        agent.locked,
        account.is_some_and(|account| account.locked),
        &windows,
        now,
    ))
}

/// Every Agent and account, as Settings → Agents lists them.
#[tracing::instrument(skip(db))]
pub async fn overview<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
) -> Result<AgentsOverview, AgentError> {
    let ground = Ground::read(db).await?;
    let accounts = accounts(db).await?;
    let shadowed = claims::shadowed(&ground.lineage, &ground.held());
    let agents = ground
        .agents
        .iter()
        .map(|agent| {
            Ok(AgentSummary {
                standing: ground.standing_of(agent, &shadowed),
                at_capacity: cause_for(agent, &accounts, now)?,
                agent: agent.clone(),
            })
        })
        .collect::<Result<Vec<_>, AgentError>>()?;
    Ok(AgentsOverview { agents, accounts })
}

/// What the capacity blocks cover now: the whole board under the global lock, and the Claim of
/// each agent that is at capacity.
///
/// Only a Claim that is active and in force counts. A paused Claim is free for another agent, and
/// a shadowed or unreachable one covers nothing.
#[tracing::instrument(skip(db))]
pub async fn blocking<M: SessionMode>(
    db: &mut Db<M>,
    global: bool,
    now: NaiveDateTime,
) -> Result<Blocking, AgentError> {
    if db.agents().all().await?.is_empty() {
        return Ok(Blocking::from(global));
    }
    let ground = Ground::read(db).await?;
    let accounts = accounts(db).await?;
    let shadowed = claims::shadowed(&ground.lineage, &ground.held());
    let mut subtrees = Vec::new();
    for agent in &ground.agents {
        let Some(claim) = &agent.claim else { continue };
        if ground.standing_of(agent, &shadowed) != AgentStanding::Active {
            continue;
        }
        if cause_for(agent, &accounts, now)?.is_some() {
            subtrees.push(claim.root);
        }
    }
    Ok(Blocking { global, subtrees })
}

/// Issues the server's connect token, replacing the old one, and answers it: shown this once.
#[tracing::instrument(skip(db))]
pub async fn issue_connect_token<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
) -> Result<String, AgentError> {
    let token = secret::random_token()?;
    db.agents()
        .set_connect_token(&secret::digest(&token), &format_time(now))
        .await?;
    Ok(token)
}

/// Whether `token` is the server's connect token. A use is recorded.
#[tracing::instrument(skip_all)]
pub async fn connect_token_is_valid<M: SessionMode>(
    db: &mut Db<M>,
    token: &str,
    now: NaiveDateTime,
) -> Result<bool, AgentError> {
    db.agents()
        .connect_token_matches(&secret::digest(token), &format_time(now))
        .await
}

#[cfg(test)]
mod tests;

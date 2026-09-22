# How long a change actually takes to ship — a first measurement

**Arlesh-2dx · measured 2026-09-22 · window 2026-09-06 → 2026-09-22 (17 calendar days)**
**Sample: 62 pull requests, 53 of them merged; 96 beads, 75 closed.**

We estimate work in scope sizes and have never checked an estimate against what
shipping cost. This is that check. It is a snapshot, not a standing dashboard:
the numbers below describe a 17-day-old repository and will be wrong within a
month. Re-run it then rather than trusting it.

> **Why it lives in `docs/reports/`.** This is a dated measurement of a moving
> target, not a rule and not a design decision. It belongs next to
> `architecture-review-2026-09-13.html`, which is the same kind of object: a
> finding true on a day, kept for comparison when the next one is taken. It is
> deliberately *not* in `docs/spec/` — it describes how we work, not what the
> product does — nor in `docs/adr/`, which records decisions rather than
> measurements, nor in `progress.md`, which is a live operating journal that is
> rewritten continuously and would bury it. `SPEC.md` gets no index row.

---

## The short version

1. **The record cannot see when work starts.** The first commit on a branch lands
   a median of **0.4 minutes** before the pull request opens — 79% of branches
   within 15 minutes. The agent works, then commits once, then opens the PR. So
   "first commit to merged" is not build time; it is *integration* time, and
   every number here is integration time. Build time is currently unrecorded.
2. **What we can measure, we can measure well.** From PR open to merge, the median
   is **10.5 hours** — but **76% of that is idle**. Inside active sessions the
   median is **2.0 hours**, p75 **4.5 hours**.
3. **Two axes, not one.** Size predicts elapsed time and says nothing about
   rework. Boundary-crossing predicts rework and says nothing about elapsed time.
   We have been folding both into a single "scope" number, which is why the
   estimate never calibrates.
4. **The rework tail is real and it is mostly re-merges, not red CI.** 29 master
   re-merges against 14 red CI runs over 49 PRs. A PR that reworks at all takes
   **2.4× the elapsed time** of one that does not.
5. **n is small and one day dominates.** Only 35 PRs have CI data at all, and 17
   of 49 merged on the last day of the window. Treat every band below as a
   hypothesis with a sample size attached, not as a rate.

---

## What the record can and cannot answer

| Question | Answerable? | Why |
|---|---|---|
| PR open → merged | **Yes**, n=53 | Complete for every PR. |
| First commit → merged | Technically yes, but ≈ the above | The first commit is written *after* the work, not before it. Median gap to PR open: 0.4 min. |
| When work began | **No** | No timestamp marks it. `started_at` on a bead is the closest thing and it is overwritten on re-claim — two beads in this sample show a start *after* their PR merged. |
| Review rounds | **No** | **Zero** GitHub reviews across all 53 PRs, and 3 comments total. Review happens in the terminal conversation and leaves no artifact. |
| CI failures, durations | **Yes, from 2026-09-19 only** | The gate moved to GitHub Actions in PR #20. 35 of 49 non-mechanical PRs have CI data; the 14 before that have none. |
| Master re-merges absorbed | **Yes**, n=49 | Countable as merge commits on the branch. |
| Shipped behaviour vs. moved code | **Yes** | A `changelog.d/` fragment is present on 16 of 53 merged PRs. |

### Two exclusions, stated

**Mechanical sweeps are excluded from every band** — PRs #1 (bootstrap, 87
files), #20 (move the gate to CI, 63), #43 (cut the conflict surface, 110) and
#57 (rustfmt the tree, 77). A 77-file `rustfmt` run is not a large feature, and
leaving these in was enough on its own to destroy the size/time relationship:
Spearman ρ between files changed and active hours is **0.29 with them in and
0.49 with them out**. Working sample after exclusion: **n=49**.

**The unit of analysis is the pull request, not the bead.** A one-bead-one-PR
join is wrong for about 40% of this sample:

- 22 of 53 merged PRs name two or more beads in their title, body or commits.
- 13 beads span two or more PRs — `Arlesh-32r` appears in four (#2, #50, #52,
  #54); `Arlesh-6gm` in three; `Arlesh-vqf` in two (#55, #57).
- 20 closed beads are named by no merged PR at all.
- Splits and absorptions named in the ticket confirm it: `Arlesh-a18` split into
  `a18` + `2ma`; `Arlesh-zlg` absorbed `294`, `aiq` and `d0c` into one PR;
  `Arlesh-71m` bundles `ckf`, `fh7` and `tuo`.

The PR is the only object in the record with an unambiguous start and end. Beads
are how we *plan*; PRs are how we *ship*. Where a PR carries several beads its
cost is attributed once, to the PR.

### How "active time" is computed

All commit timestamps and all CI run timestamps across the repository are pooled
and cut into sessions wherever the gap exceeds **3 hours**. That yields **19
sessions totalling 66.2 active hours** across the 17 days. A PR's *active* time
is the overlap of its open→merge window with those sessions.

Two caveats. Up to six agents run in parallel, so active hours across PRs overlap
and do **not** sum to 66.2 — active time measures elapsed working time, not
effort. And the 3-hour threshold is a judgement call; at a 90-minute threshold
the medians fall by roughly a third, and the *ordering* of the bands does not
change.

---

## Headline distribution (n=49, mechanical excluded)

| | p25 | median | p75 | p90 | max |
|---|---:|---:|---:|---:|---:|
| PR open → merged | 0.8 h | **10.5 h** | 20.8 h | 41.9 h | 48.2 h |
| Active (in-session) | 0.7 h | **2.0 h** | 4.5 h | 8.3 h | 15.8 h |

**76% of the time a PR is open, nothing is happening to it.** That is the single
largest fact in the data, and it is a fact about availability, not about
difficulty. Any estimate quoted in wall-clock days is measuring when we happen to
be at the keyboard.

For context: 66 active repository-hours produced 53 merged PRs. CI is not the
bottleneck — a run takes a median of **3.3 minutes** (p90 4.8), and pre-merge CI
accounts for a median **8%** of a PR's active window, 7.3 hours in total.

---

## Axis 1 — size predicts elapsed time

Banded on **source files touched** (`src/` + `src-tauri/`, excluding docs,
changelog fragments and config), which is the closest thing to a scope size that
can be estimated at triage.

| Band | n | active median | active p75 | open→merge median | % that went red |
|---|---:|---:|---:|---:|---:|
| **XS** ≤5 src files | 10 | **0.6 h** | 1.7 h | 0.6 h | 14% |
| **S** 6–14 | 13 | **1.4 h** | 2.0 h | 1.7 h | 20% |
| **M** 15–30 | 13 | **4.1 h** | 4.6 h | 11.9 h | 40% |
| **L** 31+ | 13 | **4.3 h** | 5.6 h | 15.6 h | 38% |

The relationship is monotone and holds across every size proxy tested
(Spearman ρ against active hours: source files 0.48, TypeScript files 0.50, test
files 0.54, lines changed 0.43, commits on branch 0.49).

Two things worth saying plainly:

- **The step is between S and M, not between M and L.** Crossing roughly 15
  source files triples the active cost and multiplies elapsed time by seven. Above
  that, L looks like M. If there is one planning lever in this data, it is
  *keeping a change under fifteen source files*.
- **L is probably understated.** Four of the largest changes were excluded as
  mechanical, and the biggest genuine features in the window (#10 Commitments, #38
  Undo, #56 Plan View) merged inside single long sessions where the session model
  cannot distinguish work from waiting.

---

## Axis 2 — boundary-crossing predicts rework, and nothing else

Spearman ρ, n=49, against two different targets:

| Predictor | vs. active hours | vs. rework events |
|---|---:|---:|
| source files touched | **0.48** | 0.01 |
| test files touched | **0.54** | 0.04 |
| lines changed | **0.43** | −0.02 |
| crosses Rust ↔ TypeScript | −0.12 | **0.46** |
| carries a schema migration | −0.24 | **0.45** |
| needed a spec/ADR ruling | −0.05 | **0.47** |
| CI runs on the branch | −0.03 | **0.70** |

**These are two orthogonal axes.** Every size proxy correlates with time and not
with rework; every boundary proxy correlates with rework and not with time. The
number we quote when we estimate collapses them into one, and that is the most
likely reason estimates do not calibrate: a small change that crosses the IPC
boundary and moves a migration is cheap to write and expensive to land, and we
have no vocabulary that distinguishes it from a large change that stays on one
side.

The individual flags, on the 35 PRs that have CI data:

| Flag | n | red CI / PR | % that went red | active median |
|---|---:|---:|---:|---:|
| crosses Rust ↔ TS | 13 | 0.54 | 31% | 2.6 h |
| stays on one side | 22 | 0.32 | 27% | 1.0 h |
| carries a migration | 5 | 0.80 | 40% | 3.4 h |
| no migration | 30 | 0.33 | 27% | 1.6 h |
| ≥15 source files | 18 | 0.56 | 39% | 3.6 h |
| <15 source files | 17 | 0.24 | 18% | 0.7 h |

**Do not read these as rates.** n=5 for migrations. The claim the data supports is
that three independent flags point the same way; the claim it does not support is
any particular multiplier.

One boundary flag turned out to carry no information at all: **45 of 53 merged
PRs touch `docs/spec/` or an ADR**. Spec-touching is near-universal here — it is a
convention, not a signal — so as a *predictor* it is useless even though it
correlates. What would discriminate is whether a change needed a spec ruling
*before code could start*, and that is not recorded anywhere.

---

## The rework tail

Over 49 PRs: **14 red CI runs, 29 master re-merges, 6 red-after-green events.**
10 of the 35 CI-era PRs went red at least once; 11 absorbed at least one master
re-merge; 3 went red after having been green.

| | n | active median | open→merge median |
|---|---:|---:|---:|
| no rework at all | 22 | 1.2 h | **4.5 h** |
| any rework | 13 | 2.9 h | **10.8 h** |

**A PR that reworks takes 2.4× the elapsed time and 2.4× the active time of one
that does not.** That is the tail the ticket asked about, and it is invisible in
the aggregate median.

Re-merges outnumber red CI two to one. The dominant cost of landing a change on
this repo is not that the change is wrong; it is that master moved underneath it.
The worst offenders:

| PR | rework | of which | active | open→merge |
|---|---:|---|---:|---:|
| #56 Plan View | 7 | 6 re-merges, 1 red | 4.3 h | 4.3 h |
| #42 Habit history | 6 | 4 re-merges, 2 red, 2 red-after-green | 6.1 h | **48.2 h** |
| #47 async Task | 6 | 3 re-merges, 3 red, 3 red-after-green | 3.4 h | **45.5 h** |
| #55 clippy gate | 4 | 3 re-merges, 1 red | 0.6 h | 0.6 h |
| #58 scope picker | 4 | 4 re-merges | 0.7 h | 0.7 h |

Note the split in that table. #56, #55 and #58 absorbed heavy re-merging and still
landed the same hour — re-merging is cheap when the agent is live. #42 and #47
took two days, and both are the red-after-green cases. **Red-after-green is the
expensive failure mode, not re-merging.** All three red-after-green PRs in the
sample (#21, #42, #47) sit in the top six for elapsed time.

### The burst day skews the tail, and it should be reported separately

17 of the 49 PRs merged on 2026-09-22, with up to six agents in flight, several
forced re-merges and three disk-corruption incidents.

| | n | red | red-after-green | re-merges | active median | open→merge median |
|---|---:|---:|---:|---:|---:|---:|
| merged 2026-09-22 | 17 | 7 | **5** | **23** | 1.8 h | 4.3 h |
| merged earlier | 32 | 7 | 1 | 6 | 2.9 h | 10.6 h |

**One day out of seventeen produced 79% of the master re-merges and 5 of the 6
red-after-green events.** The rework tail measured above is substantially a
measurement of that day's parallelism. Read the re-merge numbers as a cost of
running six agents at once, not as a cost of the changes themselves — and note
that on that day elapsed time went *down*, not up, because everything was live at
once. Parallelism trades rework for latency here, and on this evidence the trade
is favourable, but one day is one day.

---

## So what should we quote when we estimate?

With n=49 and one dominant day, a confident average would be dishonest. What the
data does support is a two-part estimate:

**Part 1 — size, which sets the hours.** Under 15 source files: 1–2 active hours.
Over 15: 4 active hours, p75 about 5. That is the whole range the repository has
produced so far; nothing in the window took more than 16 active hours.

**Part 2 — boundaries, which set the risk of a second day.** Count the boundaries
a change crosses (Rust ↔ TypeScript, a schema migration, a ruling not yet in the
spec). At zero, expect to land it in the session it started. At two or three,
expect a rework round and plan for the PR to survive a night.

**And one operational rule the data argues for directly:** a change that is going
to exceed fifteen source files should be split before it is started, not after it
goes red. The S→M step is the only sharp discontinuity in the whole sample.

---

## What to start recording, so this is answerable in a month

The largest gap is not sample size — it is that **the beginning of work is not
written down anywhere**. Three cheap changes would fix the three specific things
this analysis could not measure.

1. **Stamp the start of work, immutably.** `bd update --claim` sets `started_at`,
   but a re-claim overwrites it, so a bead worked twice reports only the second
   start — and two beads here report a start *after* their PR merged. Either
   record the *first* claim and never overwrite it, or have the agent write the
   start time into the bead's notes on claim. Without this, build time stays
   unmeasurable no matter how many PRs accumulate.

2. **Record whether a spec ruling blocked the start.** "Touched `docs/spec/`" is
   on 85% of PRs and therefore predicts nothing. "Could not start until a design
   question was settled" is the variable that matters and it is nowhere in the
   record. A label on the bead — `blocked-on-ruling` — set at triage, costs one
   word and turns a useless flag into a usable one.

3. **Make review rounds visible.** Zero GitHub reviews and three comments across
   53 PRs. Review is real here and it is entirely oral. If a round of review
   changes a PR, a one-line PR comment naming what changed would make the
   rework tail countable instead of inferred. Absent that, `red-after-green` is
   the only rework signal we have — and on this evidence it is the one that
   actually predicts a two-day PR, so at minimum keep CI history intact.

Two smaller ones, if they are free:

4. **Estimate the source-file count at triage** and write it on the bead. The
   size axis is the half of the estimate that does calibrate, and one recorded
   guess per bead turns it from a post-hoc correlation into a real calibration
   loop.

5. **Record parallelism.** The burst day shows re-merge load is a function of how
   many agents are live, and nothing in the record says how many were. The count
   of open PRs at merge time is a weak proxy — it is confounded, since a PR that
   stays open longer necessarily overlaps more PRs (ρ=0.68 with elapsed time, but
   only 0.07 with re-merges, which is what confounding looks like).

**Re-run this in a month.** At roughly 50 more merged PRs, the size bands reach
n≈25 each and the boundary flags reach n≈15, which is where the migration and
Rust↔TypeScript claims become testable rather than suggestive.

---

## Appendix — per-PR data

`active` is overlap with a repository-wide session (3-hour idle gap). `—` in the
CI columns means the PR predates the CI gate (PR #20, 2026-09-19). `*` marks a
mechanical sweep excluded from the bands.

| PR | src files | open→merge | active | CI runs | red | red-after-green | master re-merges | layer | migration | spec |
|---:|---:|---:|---:|---:|---:|---:|---:|:--|:-:|:-:|
| #1 * | 78 | 0.1 h | 0.1 h | — | — | — | 7 | both | yes | yes |
| #2 | 42 | 1.2 h | 1.2 h | — | — | — | 0 | both | yes | yes |
| #3 | 32 | 14.9 h | 4.9 h | — | — | — | 0 | ts | — | yes |
| #4 | 37 | 15.6 h | 5.6 h | — | — | — | 0 | ts | — | yes |
| #5 | 3 | 14.7 h | 4.7 h | — | — | — | 0 | ts | — | yes |
| #6 | 6 | 15.2 h | 5.2 h | — | — | — | 0 | ts | — | yes |
| #7 | 59 | 42.9 h | 15.8 h | — | — | — | 2 | both | yes | yes |
| #8 | 21 | 14.1 h | 4.1 h | — | — | — | 1 | both | — | yes |
| #9 | 7 | 1.7 h | 1.7 h | — | — | — | 0 | ts | — | yes |
| #10 | 97 | 41.9 h | 14.8 h | — | — | — | 0 | both | yes | yes |
| #13 | 17 | 25.8 h | 8.7 h | — | — | — | 0 | both | — | yes |
| #14 | 21 | 0.8 h | 0.8 h | — | — | — | 0 | both | — | yes |
| #15 | 0 | 20.4 h | 3.2 h | — | — | — | 0 | — | — | — |
| #16 | 68 | 33.2 h | 13.0 h | 4 | 0 | 0 | 0 | ts | — | yes |
| #17 | 14 | 0.2 h | 0.2 h | — | — | — | 0 | both | yes | yes |
| #19 | 3 | 13.7 h | 0.5 h | — | — | — | 2 | both | — | yes |
| #20 * | 60 | 5.1 h | 5.1 h | 17 | 0 | 0 | 0 | rust | — | — |
| #21 | 12 | 20.8 h | 8.3 h | 4 | 2 | 1 | 1 | both | — | — |
| #23 | 19 | 7.5 h | 4.4 h | 1 | 0 | 0 | 0 | ts | — | yes |
| #24 | 22 | 7.0 h | 3.9 h | 3 | 0 | 0 | 0 | ts | — | yes |
| #25 | 26 | 7.7 h | 4.5 h | 2 | 0 | 0 | 0 | both | yes | yes |
| #26 | 61 | 7.6 h | 4.5 h | 4 | 1 | 0 | 0 | both | yes | yes |
| #27 | 0 | 0.2 h | 0.2 h | 1 | 0 | 0 | 0 | — | — | — |
| #28 | 13 | 0.9 h | 0.9 h | 1 | 0 | 0 | 0 | ts | — | yes |
| #29 | 10 | 0.8 h | 0.8 h | 2 | 0 | 0 | 0 | ts | — | yes |
| #31 | 15 | 11.9 h | 2.5 h | 2 | 0 | 0 | 0 | ts | — | yes |
| #34 | 25 | 11.4 h | 2.0 h | 3 | 1 | 0 | 0 | ts | — | yes |
| #35 | 22 | 13.8 h | 4.5 h | 6 | 1 | 0 | 0 | ts | — | yes |
| #36 | 13 | 10.8 h | 1.4 h | 2 | 1 | 0 | 0 | both | — | yes |
| #38 | 65 | 9.6 h | 0.2 h | 3 | 0 | 0 | 0 | both | yes | yes |
| #39 | 17 | 10.5 h | 1.1 h | 2 | 1 | 0 | 0 | ts | — | yes |
| #40 | 34 | 0.6 h | 0.6 h | 2 | 0 | 0 | 0 | both | — | yes |
| #41 | 25 | 35.8 h | 7.7 h | 2 | 0 | 0 | 0 | both | — | yes |
| #42 | 30 | 48.2 h | 6.1 h | 8 | 2 | 2 | 4 | ts | — | yes |
| #43 * | 38 | 0.3 h | 0.3 h | 1 | 0 | 0 | 0 | ts | — | yes |
| #44 | 2 | 29.8 h | 1.7 h | 1 | 0 | 0 | 0 | ts | — | yes |
| #45 | 13 | 0.4 h | 0.4 h | 1 | 0 | 0 | 0 | ts | — | — |
| #46 | 32 | 30.0 h | 1.9 h | 2 | 0 | 0 | 0 | both | — | yes |
| #47 | 65 | 45.5 h | 3.4 h | 7 | 3 | 3 | 3 | both | yes | yes |
| #48 | 13 | 29.8 h | 1.8 h | 2 | 0 | 0 | 0 | ts | — | yes |
| #49 | 34 | 44.6 h | 2.6 h | 2 | 0 | 0 | 1 | both | yes | yes |
| #50 | 25 | 29.6 h | 1.6 h | 2 | 0 | 0 | 0 | both | — | yes |
| #51 | 5 | 0.5 h | 0.5 h | 1 | 0 | 0 | 0 | rust | — | yes |
| #52 | 2 | 0.6 h | 0.6 h | 1 | 0 | 0 | 0 | ts | — | yes |
| #53 | 2 | 0.6 h | 0.6 h | 1 | 0 | 0 | 0 | ts | — | — |
| #54 | 4 | 0.3 h | 0.3 h | 1 | 0 | 0 | 0 | rust | — | yes |
| #55 | 4 | 0.6 h | 0.6 h | 4 | 1 | 0 | 3 | rust | — | — |
| #56 | 73 | 4.3 h | 4.3 h | 16 | 1 | 0 | 6 | ts | — | yes |
| #57 * | 75 | 0.2 h | 0.2 h | 2 | 0 | 0 | 1 | rust | — | — |
| #58 | 9 | 0.7 h | 0.7 h | 4 | 0 | 0 | 4 | ts | — | yes |
| #59 | 7 | 0.2 h | 0.2 h | 2 | 0 | 0 | 0 | ts | — | yes |
| #61 | 14 | 2.0 h | 2.0 h | 1 | 0 | 0 | 0 | both | — | yes |
| #62 | 13 | 2.9 h | 2.9 h | 4 | 0 | 0 | 2 | both | — | yes |

Source data: `gh pr list`/`gh pr view` (62 PRs), `gh run list` (204 workflow
runs), `bd list --all` (96 beads) and `git log --all`, all read on 2026-09-22.


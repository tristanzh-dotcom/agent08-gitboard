# Agent08 Git Governance Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use direct Git write commands; any eventual submission must use Agent08 Git Control.

**Goal:** Establish the approved Tier 0–3 Git governance and the v1.3 local-isolation contract without changing executable behavior.

**Architecture:** Keep the global layer as the minimum safety baseline, define risk tiers and the Agent08 broker boundary at workspace level, define the cross-repository authorization model in the sovereignty contract, keep implementation invariants in Agent08 local governance, and place API/state-machine detail in a new v1.3 SDD. Existing v1.1/v1.2/v1.2.1 draft SDDs remain historical drafts and receive only a short forward reference.

**Tech Stack:** Markdown governance and SDD documents; read-only repository inspection; deterministic text/reference checks.

## Global Constraints

- Phase A changes governance and contracts only.
- Do not modify TypeScript, JavaScript, tests, package manifests, runtime configuration, or services.
- Do not create, remove, prune, or modify Git worktrees.
- Do not run tests that create or mutate temporary Git repositories.
- Do not execute direct Git write commands.
- Tier 1 must not authorize raw Git arguments, remote access, force, user-worktree mutation, or Tier 2/Tier 3 operations.
- Authorization, execution capability, and user confirmation must remain separate concepts.
- User main worktrees may be dirty; Tier 1 must never mutate them.

---

### Task 1: Define workspace risk tiers

**Files:**
- Modify: `/Users/tristanzh/agent/AGENTS.md`

**Interfaces:**
- Consumes: Global Git Safety Principle.
- Produces: Workspace Tier 0–3 classification and the Agent08 broker boundary used by the sovereignty contract.

- [x] Add Tier 0 read-only, Tier 1 machine-authorized local isolation, Tier 2 user-confirmed durable local mutation, and Tier 3 explicit destructive/external approval.
- [x] State that Tier 1 is available only through allowlisted Agent08 typed operations with authenticated task principals, operation-bound execution capabilities, lease ownership, fixed local-only command templates, pre/post verification, and audit.
- [x] Preserve the prohibition on direct Codex Git mutation and the Agent08-only submission path.
- [x] Review the section for conflict with the higher global baseline.

### Task 2: Separate authorization from confirmation

**Files:**
- Modify: `/Users/tristanzh/agent/agent-tooling/docs/git-operations-sovereignty.md`

**Interfaces:**
- Consumes: Workspace Tier model.
- Produces: Cross-repository PolicyDecision, ExecutionCapability, UserConfirmation, and lease-ownership rules.

- [x] Replace the rule that every mutation requires a confirmation token with the rule that every mutation requires an operation-bound execution capability and current-state verification.
- [x] Require UserConfirmation for Tier 2 and Tier 3 only.
- [x] Define Tier 1 as fixed typed local-isolation operations with no raw arguments, remote access, force, protected-branch mutation, or user-worktree mutation.
- [x] Define ownership as repository identity plus common Git directory, task, lease, canonical path, creation operation, base revision, mode, timestamps, lifecycle, and audit.
- [x] Define fail-closed cleanup and the prohibition on treating a managed path as general Git authority.

### Task 3: Update Agent08 implementation invariants

**Files:**
- Modify: `/Users/tristanzh/agent/agent08-gitboard/AGENTS.md`

**Interfaces:**
- Consumes: Workspace tiers and sovereignty authorization model.
- Produces: Local implementation constraints for future Agent08 changes.

- [x] Replace universal confirmation-token binding with universal ExecutionCapability binding plus Tier 2/Tier 3 UserConfirmation.
- [x] Add authenticated principal, repository identity, managed-root, lease, fixed-template, environment-isolation, postcondition, and audit invariants.
- [x] State that Tier 1 does not grant commit, stage, reset, stash, checkout, merge, rebase, upstream, remote, force, branch-deletion, or protected-branch authority.
- [x] Preserve existing publication and verification boundaries.

### Task 4: Specify v1.3 local isolation

**Files:**
- Create: `/Users/tristanzh/agent/agent08-gitboard/docs/sdd/git-control-v1.3-local-isolation.md`

**Interfaces:**
- Consumes: Approved audit design, workspace tiers, sovereignty contract, and Agent08 local invariants.
- Produces: The authoritative Phase A contract for future Phase B–F planning.

- [x] Mark the document `Approved for Phase A Contract; Runtime Implementation Not Authorized`.
- [x] Define the four authorization modes and the PolicyDecision, ExecutionCapability, and UserConfirmation separation.
- [x] Define repository identity, managed-root containment, worktree ownership, lease lifecycle, idempotency, immutable audit phases, and notification separation.
- [x] Define typed contracts for `prepare_isolated_worktree`, `inspect_worktree_lease`, `renew_worktree_lease`, `remove_owned_worktree`, and `prune_owned_worktree_metadata`.
- [x] Define `promote_isolated_branch` as a future Tier 2 operation outside the MVP.
- [x] Define detached-first MVP, dirty-user-worktree non-interference, cleanup requirements, error codes, threat controls, test contract, rollout phases, exit criteria, rollback, non-goals, and remaining activation decisions.

### Task 5: Preserve historical draft status

**Files:**
- Modify: `/Users/tristanzh/agent/agent08-gitboard/docs/sdd/git-control-v1.1.md`
- Modify: `/Users/tristanzh/agent/agent08-gitboard/docs/sdd/git-control-v1.2-upstream.md`
- Modify: `/Users/tristanzh/agent/agent08-gitboard/docs/sdd/git-control-v1.2.1-commit-safety.md`

**Interfaces:**
- Consumes: v1.3 SDD path and scope.
- Produces: Explicit non-retroactive relationship between historical drafts and v1.3.

- [x] Add one short note to each draft stating that v1.3 defines the separately approved local-isolation authorization model.
- [x] Do not change the existing draft status or retroactively claim approval.

### Task 6: Level 0 verification

**Files:**
- Verify all files listed above.

**Interfaces:**
- Consumes: Completed Phase A document edits.
- Produces: Evidence that the approved contract is complete, internally consistent, and non-executable.

- [x] Search for unresolved placeholder markers and incomplete requirements.
- [x] Verify all referenced paths exist and all required operation names, tiers, authorization concepts, ownership fields, phases, exit criteria, rollback rules, and non-goals are present.
- [x] Review diffs for accidental changes outside Phase A.
- [x] Confirm no TypeScript, JavaScript, test, package, runtime, or service file changed.
- [x] Record pre-existing unrelated dirty files separately.
- [x] Route any eventual Git submission through Agent08 Git Control; do not commit directly.

### Task 7: Resolve Phase A authority drift

- [x] Change the managed root to the approved contract value.
- [x] Record the approved lease defaults.
- [x] Change detached-only from an open decision to the approved MVP mode.
- [x] Resolve the metadata exact-scope fail-closed policy.
- [x] Defer protected-branch registry authority to Phase F.
- [x] Resolve notification ownership between Agent08 and Codex task runtime.
- [x] Add Tier 1 runtime-disabled rules to Workspace and sovereignty governance.
- [x] Add task-level notification deduplication to Workspace governance.
- [x] Reduce pre-Phase B open decisions to principal authentication and the
  task/session identity source.

### Task 8: Close lifecycle activation gap

- [x] Move lease inspect and renew into Phase C lifecycle activation.
- [x] Keep clean-owned removal and metadata recovery in Phase D.
- [x] Remove the Phase C rollback dependency on an unavailable typed cleanup
  path.
- [x] Define conservative Phase C rollback that preserves worktrees and hands
  cleanup to TZ.
- [x] Align Phase C and Phase D test contracts with the corrected lifecycle
  boundary.
- [x] Confirm no executable behavior or runtime authorization changed.

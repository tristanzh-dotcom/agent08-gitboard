# Agent08 Git Control v1.3 Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do not create a worktree or execute
> any Git mutation.

**Goal:** Implement the approved Phase B read-only and policy primitives while
keeping every Tier 1 production route and real Git/worktree mutation disabled.

**Architecture:** Add isolated v1.3 modules beside the legacy active mutation
path. Use server-owned registry metadata, authenticated-principal interfaces,
immutable and append-only JSON records, exclusive file creation for single-use
and compare-and-swap transitions, and a dependency-injected simulation-only
coordinator that has no Git runner dependency.

**Tech Stack:** TypeScript, Node.js standard library, Vitest, JSON file stores.

## Global Constraints

- The v1.3 SDD is authoritative; v1.1/v1.2/v1.2.1 remain draft evidence.
- Strict TDD: establish an expected RED before each production module.
- Tier 1 runtime and the real machine route remain disabled.
- Do not import `child_process`, `MutationGitProxy`, or any Git runner into new
  Phase B modules.
- Do not create the managed root or any Git repository/worktree.
- Do not modify Web, Codex runtime, package dependencies, active HTTP routes, or
  existing Tier 2/Tier 3 behavior.
- Do not execute Git add/commit/push/stash/reset/checkout/switch/merge/rebase.
- Temporary JSON-store directories are allowed; temporary Git repositories are
  forbidden.

---

### Task 1: Contracts, atomic records, registry, and principals

**Files:**
- Create: `src/gitboard/machineOperationContracts.ts`
- Create: `src/gitboard/phaseBFileStore.ts`
- Create: `src/gitboard/authorizationPolicy.ts`
- Create: `tests/authorizationPolicy.test.ts`

**Interfaces:**
- Produces `TaskPrincipal`, `AuthenticatedPrincipalContext`,
  `PrincipalAuthenticator`, `PolicyDecision`, `MachineOperationDefinition`,
  `OperationRegistry`, `DisabledPrincipalAuthenticator`,
  `DeterministicTestPrincipalAuthenticator`, and `AuthorizationPolicy`.
- Produces deterministic canonical serialization/digests and exclusive/atomic
  JSON file helpers for later stores.

- [x] Write tests proving the six operation definitions, caller tier/mode
  downgrade rejection, default-disabled production registry, disabled
  production authenticator, and every deterministic test-authenticator outcome.
- [x] Run `npm test -- tests/authorizationPolicy.test.ts` and record expected RED
  caused by missing Phase B modules.
- [x] Implement the contracts, deterministic digest, atomic/exclusive JSON
  helpers, registry, authenticators, and deny-by-default PolicyDecision logic.
- [x] Rerun `npm test -- tests/authorizationPolicy.test.ts` and obtain GREEN.

### Task 2: Immutable preflight and append-only audit

**Files:**
- Create: `src/gitboard/immutablePreflightStore.ts`
- Create: `src/gitboard/machineOperationAuditStore.ts`
- Create: `tests/immutablePreflightStore.test.ts`
- Create: `tests/machineOperationAuditStore.test.ts`

**Interfaces:**
- Produces `ImmutablePreflightStore.create/read/appendPhaseRecord`.
- Produces `MachineOperationAuditStore.append/readOperation/status`.

- [x] Write tests for stable digest, overwrite rejection, safe phase append,
  secret/capability rejection, append-only audit phases, duplicate rejection,
  status recovery, and restart reads.
- [x] Run the two new test files and record expected RED caused by missing
  stores.
- [x] Implement immutable preflight records and append-only audit records using
  schema-versioned exclusive files.
- [x] Rerun the two test files and obtain GREEN.

### Task 3: ExecutionCapability and UserConfirmation

**Files:**
- Create: `src/gitboard/executionCapabilityStore.ts`
- Create: `src/gitboard/userConfirmationStore.ts`
- Create: `tests/executionCapabilityStore.test.ts`
- Create: `tests/userConfirmationStore.test.ts`

**Interfaces:**
- Produces `ExecutionCapabilityStore.issue/consume/read`.
- Produces `UserConfirmationStore.issue/consume/read`.

- [x] Write tests for cryptographically opaque capability issuance, verifier-only
  persistence, expiry, single use, replay, every binding mismatch,
  cross-principal rejection, restart read, Tier 2/Tier 3-only confirmation,
  expiry/single use/mismatch, and type/runtime separation between the stores.
- [x] Run the two new test files and record expected RED caused by missing
  stores.
- [x] Implement immutable issuance plus exclusive consumption claims; keep raw
  capabilities out of persisted JSON and audit inputs.
- [x] Rerun the two test files and obtain GREEN.

### Task 4: Durable WorktreeLease state machine

**Files:**
- Create: `src/gitboard/worktreeLeaseStore.ts`
- Create: `tests/worktreeLeaseStore.test.ts`

**Interfaces:**
- Produces `WorktreeLeaseStore.reserve/read/transition/renew/tombstone/quarantine`.
- Enforces 24-hour default TTL, seven-day cumulative maximum, 24-hour expiry
  grace metadata, idempotency, version CAS, and durable lifecycle history.

- [x] Write tests for reserve, shorter TTL, idempotent repeat/conflict, version
  conflict, bounded renewal, expiry without cleanup, tombstone, quarantine, and
  restart recovery.
- [x] Run `npm test -- tests/worktreeLeaseStore.test.ts` and record expected RED.
- [x] Implement immutable version records and exclusive idempotency/CAS files
  without creating or inspecting real paths.
- [x] Rerun the lease test file and obtain GREEN.

### Task 5: Simulation-only authorization coordinator and activation boundary

**Files:**
- Create: `src/gitboard/machineOperationAuthorizationService.ts`
- Create: `src/gitboard/policyDecisionStore.ts`
- Create: `tests/machineOperationAuthorizationService.test.ts`
- Create: `tests/policyDecisionStore.test.ts`
- Create: `tests/phaseBActivationBoundary.test.ts`

**Interfaces:**
- Produces `MachineOperationAuthorizationService.authorize/consume`.
- Produces an immutable durable `PolicyDecisionStore`.
- Consumes the authenticator, policy, preflight, decision, capability, and audit
  interfaces by dependency injection.

- [x] Write tests for authenticated test flow, immutable preflight binding,
  PolicyDecision binding, deny-without-capability, capability consumption and
  audit, audit failure blocking, no Git dependency, production registry
  disabled, machine HTTP paths returning 404, and server main remaining
  disconnected.
- [x] Run the two new test files and record expected RED.
- [x] Implement the simulation-only coordinator with no command/path creation
  dependency and no production registration.
- [x] Rerun the two new test files and obtain GREEN.
- [x] Correct `consume` to re-authenticate, reload the authoritative decision
  and preflight, and derive all capability bindings from durable records.
- [x] Revoke an issued capability when its `capability_issued` audit append
  fails; return no raw capability.

### Task 6: Evidence, targeted final gate, and self-review

**Files:**
- Modify: `docs/sdd/git-control-v1.3-local-isolation.md`
- Modify: `docs/superpowers/plans/2026-07-30-agent08-git-control-phase-b.md`

**Interfaces:**
- Records implemented modules, targeted tests, disabled runtime, unresolved
  activation decisions, absent machine route, and absent worktree mutation.

- [x] Run the complete Phase B targeted test set once, including the
  authoritative decision store tests.
- [x] Run `npm run typecheck` once.
- [x] Run deterministic source scans proving no new Git runner/worktree command,
  no machine route, no production override, and no persisted raw capability.
- [x] Add the concise v1.3 Phase B implementation evidence section.
- [x] Review the final modified-file set, diff checks, dirty baseline, and all
  completion gates; keep Phase C unstarted.

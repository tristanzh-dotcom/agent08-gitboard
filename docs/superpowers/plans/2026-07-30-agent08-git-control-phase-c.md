# Agent08 Git Control v1.3 Phase C

## Scope

Implement only `prepare_isolated_worktree`, `inspect_worktree_lease`, and
`renew_worktree_lease` as an injectable local service. Production Tier 1
runtime, machine HTTP routes, removal, pruning, branch, remote, and promotion
remain disabled.

## Design

- Resolve repository identity exclusively from the server-owned manifest.
- Validate canonical top-level and common Git directory device/inode before and
  after every create.
- Derive the target as `<managedRoot>/<repoId>/<taskId>/<leaseId>`.
- Execute one fixed `git worktree add --detach target fullCommitOid` command with
  `shell: false` and the verified repository root as cwd.
- Persist the lease through the existing append-only `WorktreeLeaseStore`.
- Inspect only registered, owned, detached worktrees and report dirty/in-progress
  state without granting cleanup authority.
- Renew with lease-store compare-and-swap and never invoke Git.
- Ambiguous or partial create results quarantine the lease and never clean up.

## Verification

TDD tests cover create/inspect/renew, dirty primary non-interference, identity
and path containment failures, forbidden request fields, idempotency and
quarantine, renewal CAS/ownership/bounds, and the no-production-route boundary.

## Final Lean Acceptance Fix Evidence (2026-07-30)

- `command_started` is emitted only after reserve and the `creating`
  transition; matched/idempotent paths emit no command-start or
  command-finished records.
- Every post-command failure converges to `active`, `failed`, or `quarantined`;
  audit failures are typed and never leave a `creating` lease.
- Renew performs filesystem-only proof of canonical worktree ownership,
  administrative scope, `commondir`, `gitdir` back-reference, detached HEAD,
  and base OID without invoking Git.
- Renew persists its lease CAS before writing `renewed`; a successful renewal
  records the result audit against the new lease version, while audit failure
  quarantines that version.
- Prepare and renew authenticate before repository or lease inspection; ignored
  porcelain entries are counted while `removable` remains `false`.

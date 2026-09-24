# Agent08 Git Control v1.4.1 Codex Proposal Handoff

Status: Approved design; implementation not yet started
Date: 2026-08-01
Owner: Agent08 / agent08-gitboard
Approved by: TZ

## 1. Decision

Agent08 remains a final user-control plane for commit and push. It does not
infer repository semantics, classify files, organize commits, repair a working
tree, or replace Codex's native Git judgement.

The responsibility boundary is:

```text
Codex native Git capability
  -> exact finalization proposal
  -> Agent08 immutable plan and user confirmation
  -> fixed, verified commit or push
```

The existing v1.4 fail-closed checks remain mandatory. This amendment changes
how a proposal reaches and is presented by Gitboard; it does not authorize
automatic commit, automatic push, force push, worktree repair, or content
selection by Agent08.

## 2. Proposal and plan are different objects

A **proposal** is Codex's or an explicit local user's development judgement.
For a commit it contains exactly: allowlisted `repoId`, selected paths, commit
message, expected HEAD, and optional rationale. For a push it identifies the
allowlisted repository and the intended current local HEAD. A proposal carries
a bounded source label: `codex` or `manual`.

A **finalization plan** is Agent08's immutable, deterministic record derived
from that proposal. It contains the canonical repository path, branch, exact
HEAD, selected-state digest for the exact selected paths (commit only), and
the manifest-bound remote state (push only). It has its existing five-minute
plan lifetime and separately confirmed sixty-second token lifetime.

Agent08 must never turn all dirty paths into a proposal merely because they are
visible in a scan result. A UI-selected manual proposal remains available as a
fallback, but begins with no selected files and requires deliberate local-user
selection.

## 3. Commit flow

1. Codex inspects repository state using its native Git capabilities and emits
   an exact commit proposal through the Agent08 proposal endpoint.
2. Agent08 validates the existing v1.4 invariants and persists an immutable
   finalization plan; preparation creates no confirmation token.
3. The local Gitboard UI renders only the plan's repo identity, selected paths,
   commit message, short HEAD, expiry, and bounded source label.
4. The user explicitly confirms the plan in the local Gitboard UI.
5. Agent08 recomputes canonical identity, branch, HEAD, selected paths, and
   the digest of only the approved selected paths immediately before its fixed
   `git add -A -- <paths>` plus `git commit --only ... -- <paths>` operation.
6. Agent08 verifies the parent OID and exact committed-path set, then records
   a secret-free receipt.

If the repository or approved selected content changes, Agent08 must not
silently update, widen, or execute the proposal. It marks the proposal stale
and returns control to Codex for a new exact proposal. Reconfirmation of
changed content is always required.

## 4. Push flow

1. Codex proposes push only after it judges a specific local HEAD ready for
   publication.
2. Agent08 binds the plan to the allowlisted canonical repository, named
   branch, exact local HEAD, manifest-owned HTTPS origin, remote ref, and
   remote OID.
3. The user confirms in Gitboard.
4. Agent08 rechecks those values and executes the existing exact non-force
   refspec. It verifies the remote postflight OID.

Uncommitted, staged, generated, or runtime files are not push inputs and must
not block a push plan. A changed local HEAD or remote OID makes the plan stale
and requires a new Codex proposal and user confirmation.

## 5. User-visible outcomes and records

The Gitboard UI must use bounded, actionable states rather than a generic
"Finalization blocked" message:

- `ready_for_confirmation` -- render the immutable proposal summary;
- `proposal_stale` -- distinguish safe classes: selected content, HEAD/branch,
  or remote state changed; request a fresh Codex proposal;
- `confirmation_expired` -- request a new confirmation for unchanged content;
- `execution_failed` -- show a safe summary and receipt identifier;
- `committed` or `pushed` -- show the verified resulting OID.

Every prepare, confirmation, and execute terminal outcome must have a
secret-free, queryable status record. It may store typed result codes and
digests, but never confirmation tokens, raw file content, credentials, raw
command output, or absolute paths in browser output.

## 6. Delivery boundary

Implementation is limited to Agent08 finalization contracts, service/store and
HTTP surfaces, the Agent08 Web presentation, and their focused tests. It must
not modify project repositories' product logic, add GitHub credentials,
introduce automatic retries that execute changed proposals, or turn Gitboard
into a project-specific commit-policy engine.

## 7. Acceptance criteria

1. A Codex-originated exact proposal is visible in Gitboard without the UI
   deriving a file set from all dirty paths.
2. Manual fallback has no implicit selected paths.
3. Agent08 commits exactly the Codex- or user-proposed selected paths and no
   unrelated staged content.
4. Drift in an approved commit selection never causes an automatic commit;
   the resulting state is queryable and safely explained as stale.
5. Push ignores dirty working-tree state but rejects changed local or remote
   commit identity.
6. A user can finish a valid commit and subsequent push wholly from Gitboard,
   without reading service logs or interpreting an internal error code.
7. Existing v1.4 confirmation, allowlist, canonical-path, secret-scan,
   no-force, and postcondition invariants continue to pass.

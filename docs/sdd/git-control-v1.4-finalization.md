# Agent08 Git Control v1.4 Finalization SDD

Status: Approved for implementation and tests
Date: 2026-07-30
Owner: Agent08 / agent08-gitboard
Approved by: TZ

## 1. Product decision

Agent08 controls only the two boundaries that make development state durable or
externally visible:

```text
Codex development freedom
-> Agent08 final commit control
-> Agent08 final push control
```

Agent08 does not govern file generation, editing, tests, builds, dirty working
trees, ordinary local worktree use, conflict resolution, branch selection,
stash, rebase, or other development orchestration.

Codex uses its base-model and native tool capabilities to understand the change,
choose files, propose logical commits, write commit messages, and explain risk.
Those proposals are not execution evidence. Agent08 deterministically verifies
the repository and proposed final state before executing a fixed typed Git
operation.

## 2. Responsibilities

### 2.1 Codex

- inspect status, diff, log, and repository context;
- develop, test, and resolve local development state;
- select the exact commit paths;
- propose the commit message and optional rationale;
- decide when a committed revision is ready to propose for push.

### 2.2 Agent08

- resolve an allowlisted repository to its canonical physical identity;
- record an immutable commit or push plan;
- calculate the final-state digest from Git and filesystem evidence;
- reject HEAD, branch, path, content, remote, or remote-ref drift;
- reject unmerged paths, unsafe path syntax, blocked outputs, and deterministic
  secret signatures at the final commit boundary;
- obtain a separate local-operator confirmation;
- execute only fixed commit or push templates;
- verify and persist the result as a receipt.

Agent08 does not decide whether application behavior is correct.

## 3. Operations

### Digital Home repository scope (2026-10-08)

TZ approved implementation of one Digital Home group with three independently
controlled local repositories: shared application code at `HomeView`, Beijing
source material at `AgentAssetVault/00_Inbox/HomeViewBJ`, and Shanghai source
material at `AgentAssetVault/00_Inbox/HomeViewSH`, relative to the workspace root.
All three use owner `agent15`; the application retains legacy repository ID
`homeview-bj`, while the source repositories use `homeview-bj-data` and
`homeview-sh-data`. The two source repositories are initialized locally on
`main`, preserving original files and their locations. No remote, initial commit,
or upload is included in this registration. Each commit plan and confirmation
continues to bind one canonical repository and its exact selected paths. The Web
group aggregates status only; it cannot create a combined commit or publish
raw source attachments as application assets.

Only these state-changing product operations are exposed:

```text
commit
push
```

Pull, stash, rebase, reset, checkout, worktree lifecycle, repository
initialization, remote configuration, upstream configuration, force push, and
history rewrite are outside the Agent08 v1.4 product API.

## 4. Commit contract

### Initial commit clarification (2026-10-05)

TZ requested that the registered `HomeViewBJ` repository can prepare its first
commit through the existing Agent08 confirmation flow. For a named branch with
no commit, the immutable commit plan records `expectedHead: null`. Preparation
and execution still verify canonical repository identity, branch, exact selected
paths, selected content, blocked output, and secret signatures. Execution must
fail if a HEAD appears before the confirmed operation runs. Postflight verifies
that the new commit has no parent and contains exactly the selected paths. This
clarification does not authorize a remote or a push for the local-only repository.

Codex submits:

```ts
interface CommitProposal {
  selectedPaths: string[];
  commitMessage: string;
  expectedHead?: string;
  rationale?: string;
}
```

`prepare_commit`:

1. resolves the manifest repository and canonical top-level path;
2. verifies a named branch and current full commit OID;
3. verifies `expectedHead` when supplied;
4. validates and normalizes exact relative file paths;
5. requires every selected path to have a current Git change;
6. rejects unmerged selected or repository paths;
7. rejects blocked dependency, cache, runtime, generated, and secret-bearing
   content;
8. calculates a selected-state digest;
9. persists an immutable plan without issuing confirmation.

`execute_commit` requires a separately consumed confirmation. Immediately before
execution it recomputes repository identity, branch, HEAD, selected paths, and
selected-state digest. Any drift fails closed.

The fixed commit template is equivalent to:

```text
git add -A -- <selected paths>
git commit --only --no-verify --no-gpg-sign -m <message> -- <selected paths>
```

`--only` prevents unrelated pre-existing staged changes from entering the
commit. Working-tree dirt outside the selected paths is allowed. Agent08 does
not clean, stash, reset, or otherwise repair development state.

The result is accepted only after Git reports a new full commit OID whose parent
is the approved HEAD and whose changed paths exactly equal the approved selected
change set. A failed commit may leave selected paths staged; that is local
development state and is reported, not automatically reverted.

## 5. Push contract

`prepare_push` derives and persists:

- canonical repository identity;
- current named branch;
- exact local full commit OID;
- manifest-owned `origin` URL;
- exact remote branch ref;
- current remote OID or `null` for a new branch.

A dirty or staged working tree does not block push because push publishes
commits, not working-tree content.

`execute_push` requires separate confirmation and recomputes all fields.
Local-head, branch, remote URL, or remote-OID drift fails closed.

The fixed command is equivalent to:

```text
git push origin <approved full OID>:refs/heads/<approved branch>
```

No force option, wildcard refspec, caller-supplied remote, remote configuration,
or additional ref is accepted. A race after verification is left to Git's
native non-fast-forward rejection.

## 6. Confirmation and persistence

Prepare, confirmation, execution, and result are distinct records:

```text
prepared -> confirmed -> consumed -> succeeded | failed
```

- prepare never returns an execution-capable confirmation token;
- confirmation is performed through the local Agent08 confirmation surface;
- confirmation returns a short-lived, single-use execution token bound to the
  immutable plan digest;
- consumption occurs before the Git command;
- success and failure receipts contain no token or raw private file content.

The current local confirmation surface records `local_operator`; it must not
claim cryptographic proof of TZ identity. Remote or multi-user activation
requires an authenticated human confirmation channel.

## 7. Deterministic checks

The minimum final commit checks are:

- allowlisted canonical repository identity;
- named branch and exact HEAD;
- safe, unique, relative selected paths;
- selected paths are changed;
- no unmerged paths;
- no blocked path prefixes;
- no private-key block or supported high-confidence token signature;
- stable selected-state digest;
- exact committed path set and parent OID.

The minimum push checks are:

- allowlisted canonical repository identity;
- named safe branch;
- manifest-owned HTTPS GitHub `origin`;
- stable local full OID;
- stable remote full OID or stable absence;
- fixed non-force single-ref push;
- remote postflight OID equals the approved local OID.

## 8. Phase B/C disposition

The Phase B machine-policy and Phase C worktree-lease implementation are not
part of the v1.4 production route. They remain historical, disabled source
evidence until separately removed. No v1.4 service, HTTP route, UI action, or
activation decision may depend on:

- managed worktree roots;
- worktree leases;
- prepare/inspect/renew/remove worktree operations;
- quarantine or reconciliation state machines;
- Tier 1 machine-authorized isolation.

## 9. Acceptance

Automated acceptance must prove:

1. prepare persists an immutable commit plan bound to exact selected content;
2. prepare does not itself create confirmation;
3. execution rejects changed HEAD, branch, selected content, or remote state;
4. commit includes only selected paths even when unrelated changes are staged;
5. dirty working trees do not block push;
6. push uses one exact non-force refspec;
7. confirmation tokens are short-lived and single-use;
8. non-commit/push mutation routes are unavailable;
9. result receipts distinguish success and failure without secrets;
10. production service contains no Phase C worktree dependency.

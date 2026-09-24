# Agent08 Git Control Project Governance

Scope: `/Users/tristanzh/agent/agent08-gitboard` only.

Agent08 is the approved user-facing finalization control plane for commit and
push on allowlisted repositories. Development-state authority and submission
authority do not grant authority over a submitted repository's product behavior.

## Authority

Apply local authority in this order:

1. global and workspace governance;
2. `docs/sdd/git-control-v1.4-finalization.md` as the TZ-approved commit/push
   finalization contract;
3. `/Users/tristanzh/agent/agent-tooling/docs/git-operations-sovereignty.md`;
4. other TZ-approved project decisions and approved specifications or contracts;
5. current source and executable tests as evidence of observed implementation
   behavior only;
6. `docs/sdd/git-control-v1.1.md`,
   `docs/sdd/git-control-v1.2-upstream.md`, and
   `docs/sdd/git-control-v1.2.1-commit-safety.md` as draft supporting evidence;
7. `/Users/tristanzh/agent/web/docs/agents/agent08-publishing-config.md` and
   `/Users/tristanzh/agent/web/config/agents/agent08.contract.json` for
   publication/UI scope only.

Draft SDDs do not authorize new behavior, and current code does not automatically
become approved product intent. Report conflicts among approved intent, draft
design, and observed behavior; do not silently resolve them.

`docs/sdd/git-control-v1.3-local-isolation.md` and its Phase B/C plans are
superseded historical evidence and do not authorize a production worktree route.

## Git-control invariants

- Resolve the allowlisted repository identity and canonical physical path before
  finalization.
- Expose only typed `commit` and `push`; expose no raw shell, argv, cwd,
  environment, remote, refspec, force, or config escape hatch.
- Treat Codex file selection, message, rationale, and risk explanation as a
  proposal, not evidence.
- Persist an immutable plan before confirmation. Prepare must not issue an
  execution-capable confirmation token.
- Require a separate short-lived, single-use local-operator confirmation bound
  to the immutable plan.
- Re-scan immediately before execution and fail closed on repository, branch,
  HEAD, selected-content, remote, or remote-ref drift.
- Commit only exact selected paths and never absorb unrelated staged changes.
- Permit dirty or staged worktree state during push because push publishes
  commits, not working-tree content.
- Verify the resulting commit or remote OID and persist a secret-free receipt.
- The production service, HTTP routes, and UI must not depend on worktree lease,
  managed root, quarantine, reconciliation, or Phase C machine policy.
- Destructive, force, history-rewriting, remote-configuration, or
  protected-branch override operations remain outside v1.4.

## Verification and integration boundaries

`package.json` and current tests are command authority. A governance-only
Markdown change is Workspace Level 0 and does not run Agent08 application or
integration tests. For local Git-control behavior, start with the affected test
file/case and typecheck the changed TypeScript surface.

Full `npm test` runs only for a Workspace Level 4 trigger or a manifest-defined
final/release gate. Integration tests that create and mutate disposable Git
repositories run only when the affected Git-control contract requires them;
their temporary Git writes are not justified by documentation uncertainty.
Build and runtime-start commands are not default verification gates.

Agent08 owns Git Control behavior at `127.0.0.1:3108`; Web owns the shared
`/agent08` publication shell and proxy and cannot construct Git mutations. The
current Web supervisor, not Agent08, owns published Agent00 repair; do not expand
the legacy Agent08 repair executor.

Older prose describes 9 monitored repositories while current implementation and
tests contain 12. Treat this as disclosed drift, not authorization to change the
target set. The legacy repair path likewise requires an approved contract before
change.

# Agent08 Git Control v1.2.1 Commit Safety SDD

Status: Implementation Draft
Date: 2026-06-19
Owner: Agent08 / agent08-gitboard
Related baseline: `docs/sdd/git-control-v1.1.md`, `docs/sdd/git-control-v1.2-upstream.md`

## 1. Purpose

Agent08 v1.2 can commit selected files, but the latest end-user test exposed a safety gap: a commit selection may include dependency or runtime-output directories such as `node_modules/` and `storage/runtime_shadow/`. Git accepts the command, so the operation can succeed while publishing the wrong scope.

v1.2.1 closes that gap at the mutation service boundary. UI hints are insufficient; the mutation path itself must refuse dangerous commit paths before `git add` runs.

## 2. Scope

### Adds

- server-side commit path policy;
- productized safety error for blocked commit paths;
- short mutation output summary for successful commits.

### Does not add

- revert/reset UI;
- ignore-file editing UI;
- arbitrary cleanup operations;
- web-platform-owned Git logic;
- branch switching or tag operations.

## 3. Commit Path Policy

The commit operation must reject any selected file path that is absolute, path-traversing, or under a blocked generated/runtime/dependency directory.

Blocked path prefixes:

```text
node_modules/
storage/runtime_shadow/
.cache/
.pytest_cache/
.vite/
dist/
build/
coverage/
```

Rules:

- path checks run before `git add`;
- `"."` is still allowed only as an internal fallback when no explicit files are supplied, but it must not bypass selected-file policy in the UI path;
- blocked paths return a typed safety error, not a raw Git error;
- path matching uses normalized POSIX-style relative paths.

## 4. Error Model

New productized safety code:

```text
COMMIT_PATH_BLOCKED
```

Required user-facing meaning:

- title: commit blocked by generated/runtime files;
- summary: selected files include dependency or runtime-output paths that Agent08 will not commit;
- suggested action: deselect those files or update `.gitignore`, rescan, then retry.

Raw stderr must not be shown as the primary error.

## 5. Mutation Output Summary

Successful mutations may still keep raw command output for diagnostics, but the primary response must include a compact summary suitable for UI rendering.

Minimum response addition:

```ts
interface GitControlMutationResponse {
  output: string;
  outputSummary: string;
}
```

Commit output summary rules:

- first non-empty output line is enough for commit success;
- if output is empty, use `commit complete`;
- summary must be a single line;
- summary must be capped to 160 characters.

This prevents long commit stdout from rendering as an error-like block in the page.

## 6. TDD Red Contracts

1. `MutationGitProxy.commit()` rejects selected `node_modules/...` before calling `git add`.
2. `MutationGitProxy.commit()` rejects selected `storage/runtime_shadow/...` before calling `git add`.
3. `GitControlHttpServer` maps `COMMIT_PATH_BLOCKED` to HTTP 409 with a productized error body.
4. `GitControlService.mutate()` returns `outputSummary` for commit success and caps it to one short line.

## 7. Verification

Required commands:

```bash
npm run typecheck
npm test
```

Manual smoke:

- select a safe file and commit through `/agent08`; the result area shows a short success line;
- select or attempt to commit a blocked path; the API returns 409 and no `git add` runs.

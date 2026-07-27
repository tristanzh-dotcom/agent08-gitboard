# Agent11 Fishtank Monitor Git Control Design

**Status:** Approved by TZ on 2026-07-16

## Goal

Register the Agent11 Fishtank Monitor project at
`/Users/tristanzh/agent/agent11-fishtank-monitor` in Agent08 Git Control and
allow the project to be safely initialized as a local Git repository through
the existing controlled-mutation surface.

## Scope and invariants

- The canonical repository ID is `agent11-fishtank-monitor`; `Agent11` is its
  display identity.
- Agent08 registers the actual project directory, not the requested shorthand
  `agent11-fish-monitor`.
- The project currently has no `.git` directory and no verified GitHub remote.
- Initialization is a local operation only. It must not create a GitHub
  repository, configure an `origin`, push, or create a first commit.
- `git init` is never run directly by business code or the shared Web service.
  It is exposed only by Agent08's typed mutation boundary, preflight and
  confirmation flow.
- The shared Web platform continues to render/proxy Agent08 only; all Git
  mutation policy remains in `agent08-gitboard`.
- Existing dirty changes in `agent08-gitboard` and `web` are out of scope and
  must be preserved.

## Considered approaches

### 1. Local controlled bootstrap (selected)

Add Agent11 to the manifest, distinguish an existing non-Git directory from a
missing directory, and expose an `init_repository` action only for that first
state. The action performs a local `git init` after the same confirmation
mechanism used by other mutations. A post-mutation rescan makes the normal
commit workflow available.

This fulfills the requested Git Control entry point without fabricating remote
state or widening the authority of the shared Web service.

### 2. Manifest registration only (rejected)

This would show Agent11 as unavailable because the directory is not a Git
repository. It does not satisfy the requirement that the card can perform Git
Control.

### 3. Remote bootstrap (rejected)

Creating a GitHub repository, configuring credentials, adding `origin`, and
pushing an initial branch would be an external state change and a materially
larger product capability. It is intentionally not part of this change.

## Architecture and data flow

```text
manifest target (Agent11)
  -> RepoScanner classifies project directory
      -> missing path: unavailable
      -> existing non-Git directory: initializable
      -> Git repository: ordinary snapshot
  -> GitControlCardModel exposes init_repository only for initializable
  -> GitControlService preflights and confirms init_repository
  -> MutationGitProxy runs typed local git init
  -> rescan updates the Agent11 card to normal Git Control
  -> Web /agent08 renders the returned dynamic card without Agent11-specific UI
```

## Component design

### Manifest

`createDefaultManifest()` gains one required local target:

| Field | Value |
| --- | --- |
| `id` | `agent11-fishtank-monitor` |
| `agent` | `Agent11` |
| `label` | `Fishtank Monitor` |
| `path` | `${base}/agent11-fishtank-monitor` |
| `visibility` | `local` |

The target must not claim a remote URL until one has been explicitly created
and configured.

### Repository state

The scanner must preserve the existing missing-repository behavior for absent
directories. For an existing directory where `git status` reports `not a git
repository`, it must instead return a snapshot state that explicitly permits
initialization. This state must not be confused with a detached Git HEAD or a
missing path.

### Init mutation

`init_repository` is a typed Agent08 mutation operation. It is allowed only
when all of these conditions hold:

- the repository ID is in the manifest;
- the directory exists;
- the directory is not already a Git repository;
- a fresh preflight snapshot and matching confirmation token are supplied.

The mutation proxy uses a fixed argument list for local initialization. It
accepts no user-supplied command fragments, branch names, remote URLs, or
configuration values. A second attempt after successful initialization is
blocked by the ordinary repository state rather than re-running `git init`.

### Card and Web behavior

The Git Control API supplies Agent11 in both `dashboard.targets` and `cards`.
The existing dynamic Agent08 Web renderer must show it in the repository rail
and detail panel. For the initializable state, the only primary action is
`init_repository`; all normal commit, push, pull, and upstream actions remain
unavailable until the post-init rescan sees a Git repository.

No Agent11-specific route, CSS, or shared platform-home card is introduced:
the requested card is the dynamically rendered repository card on `/agent08`.

## Error handling

- A nonexistent Agent11 directory remains unavailable and cannot initialize.
- An already initialized repository cannot invoke `init_repository`.
- A stale snapshot or invalid confirmation token blocks initialization before
  the command is invoked.
- Command failures use the existing productized mutation-error response; raw
  stderr is not the primary user-facing message.
- Lack of a remote is represented honestly and does not enable push/upstream
  actions.

## Verification

Implementation will use red-green tests for:

1. the 11-target manifest and Agent11 identity;
2. scanner classification of existing non-Git versus missing directories;
3. init operation allowlist, preflight, confirmation, and fixed Git arguments;
4. Agent11 card action availability before and after initialization;
5. Web Agent08 rendering/refresh of the dynamic Agent11 card.

The completion gate additionally runs affected Agent08 tests, the shared Web
Agent08 service test, TypeScript type checking, Agent08 build, and a real local
initialization/rescan acceptance flow against the Agent11 directory. No remote
push is part of the acceptance flow.


# Agent11 Remote Bootstrap Design

## Decision

Agent11 uses the canonical repository ID and GitHub repository name
`agent11-fishtank-monitor`. Agent08 remains the sole executor for local Git
state changes. GitHub repository creation is limited to the authenticated
`tristanzh-dotcom` owner and produces a private repository.

## Current State

The local directory `/Users/tristanzh/agent/agent11-fishtank-monitor` is a
Git repository on `main`. Its existing local history comprises `f46fd6b` and
`50bcd03`; there is no configured remote. The current remaining working-tree
modification is intentionally outside this bootstrap operation.

## Approved Flow

1. Create the private GitHub repository
   `tristanzh-dotcom/agent11-fishtank-monitor` without adding generated
   README, license, or gitignore content.
2. Extend Agent08's safety-gated mutation contract with a narrowly scoped
   `configure_origin` operation. It accepts only an allowlisted manifest
   repository and its manifest-defined remote URL, and only while the local
   repository has no `origin` remote.
3. Configure local `origin` through that Agent08 operation.
4. Use a dedicated confirmation-gated `bootstrap_push` operation to publish
   the existing `main` commits. This is the only push operation allowed with a
   dirty working tree: it is limited to a manifest target whose `origin` is
   configured, which has no upstream, and whose remote `main` branch does not
   yet exist. It runs only `git push -u origin main` and never stages or
   commits working-tree files.

## Explicit Non-goals

- Do not create another initialization commit.
- Do not include the remaining uncommitted working-tree modification in this push.
- Do not alter the project files, branch, visibility, or repository name.
- Do not use raw local Git writes for remotes, commits, or push.

## Failure Handling and Verification

Creation must fail safely if the GitHub repository already exists. Origin
configuration must fail if `origin` is already present or the repository is
not an allowlisted manifest target. Before bootstrap push, Agent08 must
re-scan and require its ordinary one-time confirmation token; the operation
must reject an existing upstream, an existing remote branch, missing commits,
or a non-HTTPS manifest remote. Acceptance verifies GitHub private visibility,
local `origin`, `main` upstream tracking, and that the post-initialization
working-tree changes remain uncommitted.

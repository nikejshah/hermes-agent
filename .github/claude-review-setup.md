# Local Claude review rollout template

This bundle contains the self-contained review workflow and its failed-run
companion copied from `nikejshah/factory-os`.

Hardening applied for rollout:
- review requests are accepted only when the triggering actor is
  `nikejshah`; workflow dispatch also requires that actor. These actor checks
  protect trigger paths, but anyone with repository workflow-write access could
  alter workflow code and must be trusted before the OAuth secret is installed;
- a bootstrap `pull_request` run covers only non-draft, same-repository PRs
  opened, marked ready, reopened, or edited to change the base branch by
  `nikejshah`, so the first setup PR can receive a real review before this
  workflow is on `main`; comment and manual reviews also run directly in the
  owner-triggered workflow run;
- `pull_request.synchronize` runs only the status-only shared-head ambiguity check; model review remains limited to owner-opened, ready, reopened, base-edited, comment, or manual review paths;
- pushes to a branch used as the base of open PRs run a status-only invalidation
  job. That job never starts Claude; it marks the current PR head as needing a
  fresh owner review when the base branch tip advances and the head already has
  a factory review status, unless a valid PASS for the new exact base and
  current head already exists and the head is not shared by another open PR with a different base. Pull-request opened, ready, reopened, edited and synchronize events also fail stale successful statuses whose description does not match the current PR base/head. Open PR and status pagination are followed under bounds; known PR pages are processed before an overbound job fails closed;
- `anthropics/claude-code-action/base-action` v1 is pinned to the resolved v1
  tag commit recorded in the workflow; the full GitHub agent wrapper is not
  used and there is no PR checkout action;
- unused `id-token: write`, repository write, and bot-dispatch paths were
  removed;
- exact PR-head checks, a bounded static GitHub API diff packet, trusted repository fullname in the packet, untrusted
  review-focus and changed-file boundaries, no PR checkout, no Claude tools/project settings/hooks
  or MCP, and fail-closed receipts are preserved.

The workflow is self-contained: it uses GitHub CLI and Node.js to fetch and
validate exact-base/exact-head metadata plus the complete unified diff media
response from the trusted GitHub API. It fails closed when the response may be
truncated, contains binary changes, or exceeds the 800000-byte prompt-file
safety bound. Hermes uses a separate 131072-byte bound for the trusted base
`AGENTS.md` policy packet because its measured root policy is 76090 bytes before
packet framing; the bound leaves room for applicable ancestor policies while
still failing closed on unexpected growth. The policy packet includes root and
changed-file ancestor `AGENTS.md` files that exist at the trusted base, with
path depth, candidate count and total bytes bounded. If no applicable
`AGENTS.md` exists at the trusted base, the packet contains an explicit
no-policy contract instead of silently omitting or truncating policy text.

No PR code is checked out or executed. The prompt packet is written to a trusted
`RUNNER_TEMP` file and passed through the official pinned `base-action`
`prompt_file` input, avoiding large prompt text in action inputs or environment
strings. Claude runs with the installed, verified `--safe-mode`, `--tools ""`,
slash commands disabled, user-only settings, and strict MCP configuration. A
fresh private HOME is created for the action, and the workflow refuses to
continue unless its no-checkout workspace is empty. Settings loading is limited
to that new user's HOME; only action-generated settings can exist there. This
avoids the pinned action's SDK fallback to user/project/local settings when
given an empty setting-sources value.

The isolation step initializes an empty synthetic Git repository with a fixed
bootstrap identity, disabled hooks, and an empty commit so Claude CLI Git
bookkeeping has a safe `HEAD`; no PR files are fetched or copied. No helper
script from factory-os is required. If a target repository has its own
`.claude` configuration, inspect it as untrusted repository content before
rollout.

The companion listens for the workflow name `Claude Code Review` and the
canonical workflow filename `claude.yml`; keep that filename when installing.
It covers failed or cancelled owner-triggered manual, comment, and bootstrap
pull-request runs after the workflow exists on the default branch. It derives
the reviewed PR, base and head from the exact review job name. If a run fails
before resolving an exact base and head, it may post a PR-level failure receipt
but will not write a commit status or claim that the latest SHA was reviewed.
Stale or superseded exact-base/exact-head runs also leave the shared commit
status unchanged. PASS statuses include the full reviewed base and head in the
status description, so the push invalidation job can avoid overwriting a newer
valid PASS for the current base/head. The primary receipt publisher also
revalidates the live PR base and head immediately after writing a PASS status;
if the base or head changed, a newer owner-triggered exact review appeared, the
head is shared by another open PR with a different base, or that revalidation
fails, it writes a failure status and correction receipt requiring a fresh
owner review. Before or after publishing an older failure status, the
publishers also check for a newer owner-triggered exact-head PASS status and
preserve or restore it only when that newer run's latest shared review status
is still the exact PASS; this is a guarded repair, not a GitHub atomic
compare-and-set. Active run
cancellation is deliberately not attempted; freshness is enforced by
exact-base/exact-head receipts plus live PR base and head checks.

This template copy is local until installed. Once merged into a repository default branch, the installed workflows can react to the configured events, read the configured Claude OAuth secret in the review job, and post review comments or commit statuses under the hardcoded `nikejshah` operator policy. Keep that owner value only for `nikejshah/*` repositories or after separately verifying the same intended operator boundary.

## Merge boundary

This rollout supports owner-controlled pull requests opened by `nikejshah` in
the same repository only. Before merging, verify the actual pull request,
repository owner and actor, current base and head, and fresh exact-head Claude
and Codex receipts. A fixed commit status by itself is not merge evidence.
Fork pull requests and non-owner actors are unsupported until a separate
security design covers their trust and token boundaries. Failed, pending,
ambiguous, stale, or unresolved receipts are never merge approval; keep the
pull request blocked until a fresh exact-head review resolves the condition.

The receipt schema requires a report field up to 12000 characters. BLOCK
receipts include that report so actionable file/line findings remain visible;
PASS receipts keep the concise summary. The trusted prompt tells Claude not to
quote credentials, tokens, private financial source text, or long private
code/source excerpts in findings; this is a review instruction, not a universal
log-redaction system.

Run `node .github/tests/claude-review.cjs` to execute the actual inline policy,
packet, receipt, and failed-run scripts with synthetic inputs and mocked GitHub
responses. The test covers base-branch status invalidation, unrelated pushes,
no-open-PR pushes, live base/head races, delayed invalidation after a fresh
valid PASS, shared-head ambiguity invalidation, paginated PR/status lookup,
bounded newer-run scans, untrusted focus framing, post-publication PASS
revalidation including newer exact-run races and stale same-run PASS history,
diverged diffs, packet bounds,
binary rejection, ancestor policy loading, malformed changed paths, empty BLOCK
reports, wrong-base and wrong-head receipts, unresolved failures, base/head
drift, and stale exact-base/exact-head status suppression. Changed-file metadata
omits duplicate patches; the complete diff appears once.

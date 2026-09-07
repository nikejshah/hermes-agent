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
- no `synchronize` trigger is enabled; later head changes require a fresh
  owner-requested dispatch or comment review;
- `anthropics/claude-code-action/base-action` v1 is pinned to the resolved v1
  tag commit recorded in the workflow; the full GitHub agent wrapper is not
  used and there is no PR checkout action;
- unused `id-token: write`, repository write, and bot-dispatch paths were
  removed;
- exact PR-head checks, a bounded static GitHub API diff packet, untrusted
  changed-file boundary, no PR checkout, no Claude tools/project settings/hooks
  or MCP, and fail-closed receipts are preserved.

The workflow is self-contained: it uses GitHub CLI and Node.js to fetch and
validate exact-base/exact-head metadata plus the complete unified diff media
response from the trusted GitHub API. It fails closed when the response may be
truncated, contains binary changes, or exceeds the 800000-byte prompt-file
safety bound. The trusted base `AGENTS.md` policy packet includes root and
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
status unchanged. Active run cancellation is deliberately not attempted;
freshness is enforced by exact-base/exact-head receipts plus live PR base and
head checks.

This bundle is local only. Installing it creates workflows that can post review
comments and commit statuses when triggered by `nikejshah`, but the template
itself performs no dispatch, secret read, or GitHub write.

The receipt schema requires a report field up to 12000 characters. BLOCK
receipts include that report so actionable file/line findings remain visible;
PASS receipts keep the concise summary. The trusted prompt tells Claude not to
quote credentials, tokens, private financial source text, or long private
code/source excerpts in findings; this is a review instruction, not a universal
log-redaction system.

Run `node .github/tests/claude-review.cjs` to execute the actual inline policy,
packet, receipt, and failed-run scripts with synthetic inputs and mocked GitHub
responses. The test covers diverged diffs, packet bounds, binary rejection,
ancestor policy loading, malformed changed paths, empty BLOCK reports,
wrong-base and wrong-head receipts, unresolved failures, base/head drift, and
stale exact-base/exact-head status suppression. Changed-file metadata omits
duplicate patches; the complete diff appears once.

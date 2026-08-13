# CLAUDE.md

<!--
MAINTAINER NOTES — block-level HTML comments are stripped before this file enters
Claude's context, so everything in here is free. Write notes to humans in comments.

This file is written for a repo that doesn't have code yet. It contains only rules
Claude cannot infer from reading the codebase, because there is no codebase.

WHEN THERE IS CODE: run /init. Claude inspects the repo and fills in real build
commands, test runners, and conventions. It proposes additions rather than
overwriting an existing file. Then fill in the two stub sections at the bottom.

EDITING RULE: for every line, ask "would deleting this cause Claude to make a
mistake?" If no, delete it. Adherence drops as this file grows — a bloated file
buries the rules that matter. Target under 200 lines. `/context` shows whether it
loaded; `/doctor` proposes trims. Review edits in PRs like any other code.

WHEN THE REPO GROWS SUBDIRECTORIES: give each one its own CLAUDE.md rather than
extending this file. Claude loads files above the working directory at launch and
subdirectory files lazily — only when it reads something in that directory. That's
what keeps them cheap. Two cautions: (1) nested files are NOT re-injected after
/compact, so anything that must hold across a long session stays in THIS file;
(2) all discovered files concatenate rather than override, so contradictions
between levels get resolved arbitrarily. Audit for conflicts when behavior gets odd.
-->

## Project invariants

<!--
The load-bearing rules specific to THIS project: correctness properties, honesty
requirements, things that must never be true of the output. These are decisions,
not discoveries — Claude cannot derive them from code, which is exactly what earns
them a place here. Put them first; they matter most and context position matters.

Delete this section if there aren't any yet. Don't leave it empty.
-->

- [invariant]
- [invariant]

## Verification — never report done without evidence

- Every change ships with a check that returns pass or fail: a test, a typecheck, a
  build exit code, a script that diffs output against a fixture, or a screenshot
  compared to a target.
- Show the command and its actual output. Do not assert success in prose.
- If no check exists for what I asked, say so **before** implementing and propose one.
- Fix root causes. Never silence a warning, skip a test, widen a type, or add a
  try/except that swallows the error to make a check pass.
- If a check still fails after two attempts, stop. Report what you tried, what the
  output said, and what you think is actually wrong.

## Loops — iterate until the check passes

- Default loop: change → run the check → read the output → fix → re-run. Do not hand
  control back mid-loop to tell me a test is failing; fix it and show me the green run.
- Stop after three rounds with no measurable progress. Report, don't thrash.
- When I set `/goal <condition>`, the condition is judged from what you surface in the
  conversation — the evaluator reads the transcript and cannot run commands. Run the
  check and print its output every turn, or it can't be evaluated.
- Before calling any multi-file change done, run an adversarial review in a **fresh**
  subagent against the plan file. Report only gaps that affect correctness or a stated
  requirement — not style preferences, not hypothetical edge cases.

## Subagents — keep exploration out of the main context

- Delegate work whose output we will never reference again: repo-wide searches, full
  test-suite runs, log triage, reading third-party docs. Return the finding, not the
  transcript.
- Independent questions → parallel subagents. Questions that depend on each other →
  main conversation.
- A subagent starts with a fresh context and cannot see our conversation. Restate the
  file paths, the constraints, and the definition of done in every delegation prompt.
- The built-in Explore and Plan agents do not load this file. If a rule here must apply
  to their work, repeat it in the delegation prompt.
- The agent that wrote the code never grades it. Reviews and verification run in a
  separate context.

## Context management

- Plans, specs, and task lists go in files under `docs/plans/`, never in chat alone.
  Conversation gets summarized away on compaction; files survive.
- Track multi-step work as `[ ]` checkboxes in the plan file and tick them as you go.
  On resuming, re-read the plan file rather than trusting conversation memory.
- Prefer targeted reads: grep, symbol search, and specific line ranges over whole files.
- Never read build output, dependency directories, generated files, or vendored code.
- Say when you are guessing instead of having read the code. Guessing is fine; a
  confident-sounding guess presented as fact is not.
- Tell me to `/clear` when I switch to unrelated work while context is loaded with the
  previous task.

## When my prompt is thin

- No verification criterion in the request → ask for one, or propose one, before coding.
- Touches 3+ files, or the approach is uncertain → plan first. Write the plan to
  `docs/plans/<slug>.md` and wait for approval before editing.
- One-sentence diff (typo, log line, rename) → just do it. Don't plan.
- I named a file, symbol, or endpoint that doesn't exist → say so. Do not silently
  substitute a plausible-looking alternative.
- Ask at most one clarifying question per turn, and only when the answer changes the
  implementation. Otherwise pick the reasonable default and state which one you picked.
- For a feature-sized request, interview me with `AskUserQuestion` first — cover edge
  cases, tradeoffs, and what's out of scope, not the obvious parts. Then write a spec.

## Repository etiquette

- Branches: `[convention]`. Commits: `[convention]`.
- Never commit secrets, `.env` files, or credentials. If you find one committed, stop
  and tell me — do not rewrite history to hide it.
- Never `git push --force`, amend a pushed commit, or rewrite shared history.
- Do not create a PR unless I ask. Do not merge one, ever.

## Non-negotiables

- Do not add a dependency without asking. Use what's already in the tree.
- Do not delete or rewrite a test to make it pass. If a test is wrong, say why.
- Do not modify migrations, generated files, or lockfiles without saying so first.
- Destructive commands (`rm -rf`, `DROP`, `TRUNCATE`, `reset --hard`) require my
  explicit go-ahead in the current turn.

## Commands

<!-- Run /init once there is code. Keep only what can't be guessed from the manifest. -->

_Not yet established._

## Layout

<!-- Six lines maximum, and only once directories exist. Layout, not architecture. -->

_Not yet established._

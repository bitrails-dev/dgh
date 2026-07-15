---
name: opencode-delegate-scale
description: This skill should be used when a user wants a coding task orchestrated as a new Opencode-delegate-scale task; it makes the orchestrator inspect and plan in fine detail, delegate implementation through opencode-delegate, maintain live progress, coordinate safe parallel workers and reviewers, answer advisor questions, require self-review and verification evidence, and perform final review. It supports full-cycle or implementation-only delegation.
license: MIT
compatibility: Requires the opencode-delegate skill, an authenticated OpenCode CLI, git, and an orchestrator that can run and monitor background commands.
metadata:
  version: 0.1.0
---

# Opencode-delegate-scale

## Purpose

Opencode-delegate-scale is the orchestration desk. The orchestrator is the brain: understand the
request, inspect the repository, decide the work breakdown, write precise briefs, coordinate execution,
advise workers, and make the final judgment. OpenCode is the muscle: perform the delegated
implementation and, when configured, the review and verification work.

Every invocation is a **new Opencode-delegate-scale task**. Invoke opencode-delegate by skill name for
every OpenCode worker or reviewer. Never address it through an installation path, helper filename, or
copied relay command. Do not modify opencode-delegate as part of using this skill.

## Non-negotiable boundaries

- Do not start implementation before the orchestrator has inspected enough repository context to
  produce a fine-detail plan.
- Delegate OpenCode work only through opencode-delegate.
- Default fresh OpenCode sessions to zai-coding-plan/glm-5.2 unless the user overrides the model.
- OpenCode never commits, pushes, deploys, merges, or broadens scope unless the user separately
  authorizes that action.
- The orchestrator owns final acceptance even when OpenCode owns reviews and gates.
- Never equate a heartbeat, process existence, model self-report, or progress tracker with correctness.
- Preserve unrelated user changes. Parallel writers must not share overlapping files in one working
  tree.

## Runtime configuration

Resolve these settings at the start. Use the defaults without stopping for confirmation when the user
has not supplied an override.

| Setting | Default | Options |
| --- | --- | --- |
| OpenCode model | zai-coding-plan/glm-5.2 | Any user-approved OpenCode model |
| Delegation profile | full-cycle | full-cycle or implementation-only |
| Parallelism | safe-auto | Sequential, safe automatic parallelism, or a user limit |
| Human progress cadence | Event-driven plus heartbeat | Material changes immediately; quiet-alive update at least every 60 seconds |

### full-cycle profile

OpenCode owns the hard-work loop:

1. implementation;
2. targeted tests and all discovered project gates;
3. implementation self-review;
4. independent diff/correctness review;
5. independent security and failure-mode review when relevant;
6. corrections and gate reruns until all blocking findings are cleared;
7. a concise evidence-based implementation and review summary.

Use separate opencode-delegate reviewer tasks where independence matters. The orchestrator consumes
their summaries only after the execution and review loop reaches a terminal successful state, then
reviews the real diff and evidence as the final step.

### implementation-only profile

OpenCode owns implementation and its implementation summary. The orchestrator owns all diff review,
security review, tests, builds, linters, type checks, and correction decisions after OpenCode returns.
The brief must explicitly state that reviews and gates remain with the orchestrator so ownership is not
ambiguous.

## Workflow

### 1. Announce and establish the desk

Tell the user that a new **Opencode-delegate-scale** task is starting. State the selected model,
delegation profile, and parallelism policy. If the user supplied them earlier in the conversation, use
those values without asking again.

### 2. Inspect and think

Perform read-only repository inspection before dispatch:

- read the applicable agent instructions;
- inspect current git state and protect pre-existing changes;
- locate architecture, entry points, tests, validation commands, and ownership boundaries;
- identify security-sensitive or irreversible surfaces;
- determine whether the task can be partitioned without overlapping writes;
- record unknowns and decide which can be discovered by workers versus which require human authority.

The orchestrator must understand the plan. Do not delegate the act of deciding the entire plan to an
unbounded worker.

### 3. Produce a fine-detail execution plan

Break work into bounded tasks. Each task must define:

- goal and rationale;
- exact scope and explicit exclusions;
- expected files or component boundary;
- dependencies and ordering;
- acceptance criteria;
- actual repository gate commands;
- expected report shape;
- risk level and required reviewer types;
- whether it can run in parallel and how isolation is achieved.

Maintain one in-progress orchestration step at a time while allowing its independent worker tasks to
run concurrently.

### 4. Dispatch through opencode-delegate

Create one self-contained brief per worker and invoke opencode-delegate by name. A worker sees only
its brief and repository state, so include every relevant decision and constraint.

Every brief must contain:

1. task objective and current state;
2. exact allowed scope and protected areas;
3. concrete acceptance criteria;
4. the selected delegation profile and ownership of reviews/gates;
5. repository-specific gate commands, when OpenCode owns gates;
6. a prohibition on commits and unrelated cleanup;
7. the progress and advisor protocol;
8. a structured terminal report contract.

Require OpenCode to report observable phases such as inspection, plan confirmation, editing, testing,
self-review, correction, and finalization. Require an explicit terminal state of SUCCESS, FAILURE,
BLOCKED, CANCELLED, or COLLAPSED.

### 5. Use safe parallelism

Opencode-delegate-scale may invoke multiple opencode-delegate tasks:

- Parallelize independent read-only analysis and reviews freely within the configured limit.
- Parallelize writers only when they use separate worktrees or strictly disjoint ownership that cannot
  collide.
- Keep dependency-linked work sequential.
- Never allow two writers to modify overlapping files in the same working tree.
- Give every worker the same shared constraints and relevant decisions.
- After parallel work, run a coherence pass over the combined result.

Parallelism is a latency optimization, not a reason to weaken traceability.

### 6. Maintain the live channel

Never leave the user with an opaque background wait.

- Monitor each active opencode-delegate task through its available incremental output, event
  artifacts, result artifact, and process state.
- Capture every observable OpenCode step. Surface meaningful phase changes to the user promptly in a
  concise progress update.
- If nothing changes, do not repeatedly claim progress. Send an honest heartbeat at least every
  60 seconds: identify the active task, say the process is alive, and state how long it has been quiet.
- A heartbeat means **alive but quiet**, not advancing and not correct.
- Do not block the entire orchestration on constant polling. Poll at bounded intervals, continue safe
  independent orchestration work, and report only changed state or the heartbeat.
- Maintain per-worker state: queued, starting, active phase, quiet-alive, awaiting advice, succeeded,
  failed, blocked, cancelled, or collapsed.
- Report every terminal outcome to the user. Silence, a missing terminal artifact, a vanished process,
  a supervisor timeout, or an unreadable result is COLLAPSED until evidence proves otherwise.
- Never describe a killed wrapper or host timeout as an implementation failure without evidence.

### 7. Act as OpenCode's advisor

OpenCode may request advice during execution.

1. Require the worker to emit ADVISOR_QUESTION with the missing decision, evidence, options, impact,
   and recommendation.
2. Answer directly when the decision is within the approved plan and repository evidence.
3. Ask the user only when the answer requires new authority, product intent, cost approval, destructive
   action, or material scope expansion.
4. Resume the same OpenCode session with a delta brief containing the decision and any new constraint.
5. Record the decision and propagate it to dependent workers.

An advisor exchange is progress and must appear in the live channel.

### 8. Run the configured review loop

For full-cycle:

1. Wait for implementation success and its summary.
2. Dispatch independent read-only reviewers through opencode-delegate for correctness/diff review and
   security/failure-mode review as risk warrants.
3. Dispatch gate execution through opencode-delegate, or require the implementation worker to execute
   the discovered gates when isolation and ordering make that safer.
4. Send blocking findings back to the implementation session as a delta brief.
5. Repeat implementation correction, gates, and independent review until OpenCode reports no blocking
   findings and all required gates pass.
6. If repeated attempts do not converge, report failure or blockage; do not manufacture success.

For implementation-only, the orchestrator performs these reviews and gates directly.

### 9. Require evidence-based summaries

Every worker summary must include:

1. terminal status;
2. what changed and why;
3. files/components touched;
4. commands run with exit codes and test counts;
5. review findings and how each was resolved;
6. security/failure-mode findings;
7. deviations, open risks, and advisor decisions;
8. session identifier needed for targeted rework;
9. confirmation that no commit or unauthorized external action occurred.

Summaries guide review; they do not replace inspecting the working tree.

### 10. Perform the orchestrator's final review

Only after the configured OpenCode loop reaches terminal success:

- inspect the actual diff against the plan and protected scope;
- reconcile worker and reviewer summaries with repository evidence;
- verify that required gates genuinely ran and passed;
- independently rerun high-risk, ambiguous, or suspicious checks;
- check combined changes for coherence and unintended interactions;
- reject or re-dispatch any unsupported success claim.

The orchestrator may make a small final correction only when it is safer and clearer than another
delegation cycle; otherwise resume the responsible OpenCode session. The orchestrator remains the final
reviewer and delivery voice.

### 11. Close visibly

Deliver one explicit overall state:

- **SUCCESS:** implementation, configured reviews, required gates, and final orchestrator review passed.
- **FAILURE:** execution or verification failed with actionable evidence.
- **BLOCKED:** progress requires user authority or unavailable external state.
- **CANCELLED:** the user or orchestrator intentionally stopped the work.
- **COLLAPSED:** infrastructure or process termination prevented a trustworthy terminal result.

Include a concise implementation summary, review/gate evidence, remaining risks, and the final decision.
Never leave an Opencode-delegate-scale task implied to be running after its processes have ended.

## Brief skeleton

Use this structure conceptually when constructing each opencode-delegate task:

~~~text
<task>
Goal, repository state, exact scope, exclusions, dependencies, and acceptance criteria.
</task>

<delegation_profile>
full-cycle | implementation-only
State exactly who owns implementation, reviews, and gates.
</delegation_profile>

<execution_plan>
Numbered steps, file/component ownership, and repository-specific gate commands.
</execution_plan>

<live_channel>
Announce every observable phase. Emit honest quiet-alive heartbeats. End with one explicit terminal
state. Use ADVISOR_QUESTION for decisions instead of guessing.
</live_channel>

<action_safety>
No commits, pushes, deploys, unrelated cleanup, destructive commands, or scope expansion.
</action_safety>

<report_contract>
Status; changes; touched scope; commands and outcomes; reviews; security findings; decisions; risks;
session identifier.
</report_contract>
~~~

---
name: moye-task-control
description: Control Moye development tasks and documentation dependencies. Use when an agent starts, changes, validates, closes, archives, resumes, or hands off work in this repository, or when code changes may require Architecture, ADR, CodeMap, Runbook, Pitfall, Incident, Backlog, or Task artifact updates.
---

# Moye Task Control

Use the repository CLI and document graph as gates for Standard/Full work; Lite follows the explicit exemption below. Never infer lifecycle state from a directory move or edit Task state directly.

## Select the development profile

Use `auto` by default. `auto` is a selector, not a fourth profile: choose the smallest safe profile and announce the selected profile plus the reason before task actions. A user may request a stricter profile. Never honor a lower profile when the actual change triggers a stricter one; announce the escalation first.

The normative profiles are `lite`, `standard`, and `full`. `performance` is an orthogonal execution strategy such as parallel agents or caching. `ultimate` is not a profile.

### Lite

Choose Lite only when every condition is true: the change is local and easily reversible; it is limited to static presentation, copy, comments, test maintenance, formatting, or a proven behavior-preserving refactor; and it does not touch a public contract, business rule, state machine, Workflow, persisted Schema, Event, Artifact, dependency, security boundary, build/deploy/recovery path, migration, or external side effect.

Lite procedure:

1. Read `AGENTS.md`, inspect the worktree, and read only the directly relevant source and tests.
2. Implement the smallest bounded change while preserving unrelated user changes.
3. Run targeted tests or static checks proportional to the change. For visual changes, verify the real page in a browser at relevant desktop and narrow widths, including keyboard behavior when applicable.
4. Run `git diff --check` and review the final diff.
5. Report changed files, verification evidence, and remaining limitations. Create at most one ordinary Commit when requested or expected by the active repository workflow.

Lite must not create lifecycle-only Finding, Backlog, Task package, Docs Impact, Document Graph, or Seal artifacts. It must not invoke Context Route or a Runtime Workflow merely to manufacture process evidence. Editing a document that is itself the requested target is allowed. If the scope crosses any Lite boundary, stop expanding the change, announce escalation, and continue under Standard or Full.

### Standard

Use Standard for ordinary bugs, bounded product behavior, and component work that changes behavior without touching Full triggers.

1. Read the repository baseline and run Context Route.
2. Create a minimal Task package. A direct user requirement does not need a synthetic Finding or Backlog; create Source/Backlog only when work needs durable intake, deduplication, scheduling, or follow-up.
3. Read all `required_read` documents and disposition every `required_review` item in Docs Impact.
4. Implement and run targeted tests plus the relevant repository gate. Do not require multi-agent execution or a fault matrix unless the risk calls for them.
5. Use the existing single Result Commit and two-phase Seal protocol when the repository task is committed and closed.

### Full

Use Full for Core state machines and invariants, Runtime/Workflow behavior, persisted Schema, Event or Artifact protocols, UNKNOWN effects and Reconcile, Git/Merge correctness, permissions/security, migrations, dependencies/infrastructure, cross-module architecture boundaries, production release, or any request for a complete product fault matrix.

Follow the complete Source/Backlog/Task, Spec/Design/Plan, role isolation, implementation, documentation, independent test/review, Docs Impact, Result Commit, Verification, Closure and Archive path. Use real product evidence whenever the acceptance criteria require it; Fake/Mock evidence remains supplemental.

## Start or resume Standard or Full work

1. Read `AGENTS.md`, `docs/README.md`, `docs/graph.yaml`, and `docs/knowledge/current/codemap/README.md`.
2. Route the intended changes:

   ```bash
   npm run cli -- route --intent <intent> --path <planned-path>
   ```

3. Read every `required_read` document. Record every `required_review` node in the Task's `docs-impact.yaml` before completion.
4. Find the Active Task under `docs/delivery/tasks/TASK-*`. If no approved Task covers the requested implementation, create a Task package; create or update Source/Backlog first only when intake, deduplication, scheduling, incident handling, or follow-up requires it.
5. On handoff, use the Task package plus Runtime status as authority; do not rely on chat history or Worker-local state.

## Operate a durable task

- Validate input: `npm run cli -- validate --file <task.json>`
- Submit once: `npm run cli -- create --file <task.json>` (bootstrap Task or real Coding Task submission)
- Inspect the owning projection: `npm run cli -- status <TASK-ID>`
- Wait for archived terminal state or reconcile wait: `npm run cli -- wait <TASK-ID> [--timeout-ms N]`
- Resume an explicitly reconciled Coding effect: `npm run cli -- reconcile-task <TASK-ID> --token <TOKEN> --evidence <TEXT>`
- Wait for business close: `npm run cli -- close --file <task.json>`
- Run or reattach to archive: `npm run cli -- archive --file <archive.json>`
- Reconcile an uncertain archive outcome: `npm run cli -- reconcile --file <archive.json>`

Core v2 repository Tasks use the two-phase sealed Result Commit protocol:

1. Submit the frozen Task input once: `npm run cli -- seal-start --file <sealed-task.json>`.
2. Read the durable Intent: `npm run cli -- seal-status <TASK-ID>`.
3. Save the returned `intent` JSON and prepare the final package: `npm run cli -- seal-stage --file <seal-intent.json>`.
4. Create exactly one Result Commit whose parent is the frozen Base and whose changed paths are all listed by the archived Docs Impact report.
5. Submit evidence once: `npm run cli -- seal-submit <TASK-ID> --token <TOKEN> --commit <SHA> --executor <ID>`.
6. Use `status`/`wait` to confirm Runtime `CLOSED + ARCHIVED`; do not write or move files after the Gate succeeds.

Wrong tokens are rejected without resolving the durable promise. Repeating identical evidence is idempotent. A different evidence submission conflicts; never amend or create a second Result Commit to hide a failed Gate.

`create/status/wait` resolve `TaskAuthority` and address the same keyed owning Workflow; `close` remains the bootstrap TaskWorkflow attach command. `archive` and `reconcile` address the same keyed ArchiveWorkflow. `reconcile-task` only resolves the pending durable Workflow signal after external evidence exists; it cannot create a new Attempt. Never implement retry loops or a second task state machine in this Skill.

## Close the documentation gate

1. Update current facts: CodeMap for module changes, Architecture for boundary or invariant changes, and Runbook/README/AGENTS for operator changes.
2. Create an ADR only for an accepted significant decision. Record real faults as Incident or Finding, then create Backlog work separately. Promote stable repeatable hazards to Pitfall.
3. Update the Task `verification.md`, `plan.md`, and `docs-impact.yaml` with actual evidence.
4. Validate both gates:

   ```bash
   npm run check
   ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/<TASK-ID>/docs-impact.yaml
   ```

5. For legacy/Coding flows, archive only after terminal outcome and Archive Workflow receipt. For sealed flows, prepare the Archive package before the Result Commit and treat it as closed only after `SealedTaskWorkflow` reports `ARCHIVED`.

If a gate fails, keep the Task active and report the exact failed invariant. Do not weaken or bypass the gate.

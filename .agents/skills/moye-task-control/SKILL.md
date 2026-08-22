---
name: moye-task-control
description: Control Moye development tasks and documentation dependencies. Use when an agent starts, changes, validates, closes, archives, resumes, or hands off work in this repository, or when code changes may require Architecture, ADR, CodeMap, Runbook, Pitfall, Incident, Backlog, or Task artifact updates.
---

# Moye Task Control

Use the repository CLI and document graph as gates. Never infer lifecycle state from a directory move or edit Task state directly.

## Start or resume work

1. Read `AGENTS.md`, `docs/README.md`, `docs/graph.yaml`, and `docs/knowledge/current/codemap/README.md`.
2. Route the intended changes:

   ```bash
   npm run cli -- route --intent <intent> --path <planned-path>
   ```

3. Read every `required_read` document. Record every `required_review` node in the Task's `docs-impact.yaml` before completion.
4. Find the Active Task under `docs/delivery/tasks/TASK-*`. If no approved Task covers the requested implementation, create or update a Backlog item and Task package before changing code.
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

5. Archive the Task only after its business outcome is terminal, verification passes, document impact is complete, and the Archive Workflow reports `ARCHIVED`.

If a gate fails, keep the Task active and report the exact failed invariant. Do not weaken or bypass the gate.

# Minimal Git Example

This fixture proves that Moye's project contract does not require a language framework. It needs only Git plus the released CLI:

```bash
npm install --global moye@0.1.0
moye project validate
git diff --check HEAD
moye doctor
moye task start \
  --objective "Add a CONTRIBUTING file with a three-step review checklist" \
  --accept "git diff --check HEAD passes"
moye task watch TASK-ID
moye task open TASK-ID
```

The Task page shows Runtime-owned state and evidence. It never scans this repository to invent Workflow history. Use data-preserving Runtime stop by default; destructive purge requires explicit confirmation.

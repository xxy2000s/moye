# Node/TypeScript Example

This repository uses Node 22's type stripping, so the example has no language dependency beyond Node itself. Install the released CLI, start the local Runtime, then run:

```bash
npm install --save-dev moye@0.1.0
npx moye project validate
npm test
npx moye doctor
npx moye task start \
  --objective "Add a farewell function with tests and document the public behavior" \
  --accept "npm test passes"
npx moye task watch TASK-ID
npx moye task open TASK-ID
```

`documentation.policy: conventional` requires a project-fact documentation change when product code changes. The Task page is read-only: use the Canvas for the actual path and Roles & Deliverables for Agent/Artifact evidence.

Stop Runtime without deleting data using `npm run runtime:down` from the Moye distribution. Purge requires the separate explicit confirmation described by the Runtime Runbook.

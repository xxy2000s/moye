# External Project Examples

These directories are standalone consumer fixtures for `moye@0.1.0`:

- `node-typescript`: Node 22 TypeScript and conventional documentation policy;
- `python`: standard-library unittest and deterministic `none` documentation policy;
- `minimal-git`: Git-only integrity command with no language toolchain.

Copy one directory outside this repository, initialize/commit it as `main`, install the released npm package, and follow its README. The templates contain no import, file dependency, or path back to Moye source, and none uses Moye's internal `docs/graph.yaml`.

For a repeatable local proof against the W07 RC tarball:

```bash
npm run acceptance:framework:examples
```

The full Happy/Repair/Reconcile/failure/upgrade product matrix is a separate W09 gate; passing the template smoke does not claim those Runtime scenarios.

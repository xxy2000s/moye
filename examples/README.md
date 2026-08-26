# External Project Examples

These directories are standalone consumer fixtures for `moye@0.1.0`:

- `node-typescript`: Node 22 TypeScript and conventional documentation policy;
- `python`: standard-library unittest and deterministic `none` documentation policy;
- `minimal-git`: Git-only integrity command with no language toolchain.

Copy one directory outside this repository, initialize/commit it as `main`, install the released npm package, and follow its README. The templates contain no import, file dependency, or path back to Moye source, and none uses Moye's internal `docs/graph.yaml`.

For a repeatable proof against the locally built release tarball:

```bash
npm run acceptance:framework:examples
```

Template smoke only proves clean-install consumption. The separate W09 product gate has also passed against real Restate tasks for Happy, Repair, Reconcile, failure archive, and cross-version recovery; its source Evidence Digest is `sha256:d65f253ba55f8bb00f8ab253706e23b6e4d54d5f6c7f2b0db8b59456942f8354`. Neither result by itself claims that public npm or container publication is confirmed; those states require remote receipts.

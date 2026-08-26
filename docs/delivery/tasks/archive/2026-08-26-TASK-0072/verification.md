# TASK-0072 Verification

> 状态：Accepted
> 产品证据：[release-pipeline-acceptance.json](./release-pipeline-acceptance.json)

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0072-01 | `npm pack --json` 文件审计；clean install 后动态 import | `moye/core`、`moye/client`、`moye/plugin-sdk` 均可用；Workflow/Projection handler 0 个 |
| REQ-0072-02 | tarball whitelist + 解包 metadata/绝对路径检查 | 34 个条目，forbidden 0；包含 License、README、Schema，不含 docs/tests/scripts/Runtime data |
| REQ-0072-03 | 独立 committed snapshot → tarball install → CLI | `moye --help`、`init`、`project validate` 通过，Schema/API/Plugin 均为 v1 |
| REQ-0072-04 | `createReleaseManifestV1` 与 tamper 单测 | 版本、Commit、npm/container/SBOM/协议统一绑定；冲突内容校验失败 |
| REQ-0072-05 | SHA-256 checksum + CycloneDX 1.5 SBOM | tarball、SBOM 和 image 均有内容摘要；包内无 Moye 仓库绝对路径 |
| REQ-0072-06 | `.github/workflows/ci.yml`；`acceptance:framework:release` | CI 复用 repository/E2E/release gate；本地真实 RC snapshot 全通过 |

## Repository Gates

- `npm run check`：53 个 Test File、297 个 Test 全通过；Document Graph 657 docs / 996 relations / 425 Markdown；
- `npm run test:e2e`：13 files passed、2 skipped；35 tests passed、2 skipped；
- `npm run acceptance:framework:release`：真实 npm pack/install、CLI/exports/Schema、Docker build、SBOM 和 Release Manifest 通过；
- W07 只证明本地 RC pipeline 与不可伪造产物身份，不把 snapshot commit 或本地 image ID 冒充 GitHub/npm/Registry receipt；W10 才执行外部发布。

# Security

Moye `0.1.x` is a single-operator, loopback-first Framework MVP. It is intended for trusted local repositories and trusted local Agent CLIs. It is not an authenticated multi-tenant service.

## Supported versions

Only the latest `0.1.x` release receives security fixes. Public Schema, Client and Plugin contracts are versioned independently; an unsupported or incompatible version is rejected explicitly rather than guessed.

## Default boundary

- Service and Board bind to loopback by default. Do not expose them to an untrusted network without an authenticated reverse proxy and additional isolation.
- Repository paths, Artifact roots and Provider Session roots are explicit allowlists. Project commands are argv arrays; implicit shell strings are rejected.
- Prompt, response, tool content and raw model I/O capture are disabled by default. Enabling Transcript capture can persist source or prompt material in the configured Artifact store.
- Plugins return Effect results and Evidence only. They cannot advance Task state; the owning Workflow remains the sole state owner.
- The default local Workspace, process runner and Docker deployment are not a hardened production sandbox. Run untrusted code only inside an isolation boundary you control.
- Secrets must be supplied through the operator environment or external secret tooling. Moye does not provide a production secret vault in `0.1.0`.

## Reporting

Use the repository's GitHub Security Advisory channel when available. Do not include credentials, private prompts, Provider Session files, source archives or Runtime data in a public issue. Include the Moye version, affected public contract, minimal reproduction and redacted evidence digest.

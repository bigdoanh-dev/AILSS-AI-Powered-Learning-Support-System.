# Release and assurance artifacts

This directory contains generated or retained JSON evidence that previously lived in the repository root:

- Phase 24–40 evidence bundles and attestations.
- Release-candidate manifests and deployment timelines.
- SBOM, API inventories, topology, RPO, PCI, IAM and FinOps evidence.

These files are not application configuration. CI producers and consumers must use paths under `artifacts/release-evidence/`; generated artifacts must not be written back to the repository root.

The repository root intentionally retains only tool configuration JSON such as `package.json`, `tsconfig.json`, `tsconfig.base.json` and `.prettierrc.json`.

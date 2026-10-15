# Architecture

Wanxiang uses two Rust workspaces in one repository.

## World-model workspace (root)

- `wanxiang_types`: shared domain types.
- `wanxiang_core`: core orchestration and data structures.
- `wanxiang_brain`: cognition-inspired and decision-related components.
- `wanxiang_evolution`: evolutionary utilities.
- `wanxiang_world`: world and entity modeling.
- `wanxiang_engine`: engine orchestration.
- `wanxiang_sdk`: an embedding-facing API around the world model.

The SDK is the intended integration surface for applications embedding the world model. Internal modules are not automatically stable public API.

## Engine workspace (`engines/`)

This workspace contains smaller components grouped by responsibility: world-state accounting, causal-graph utilities, memory experiments, agent runtime, model adapters, security helpers, config resolution, and narrative-writing tools.

The crates are not all at the same maturity level and should not be described as one validated cognitive architecture. A crate can compile and pass unit tests while its modeling assumptions remain experimental.

## Integration principles

- Prefer typed interfaces and explicit inputs/outputs over reaching into private internals.
- Keep provider/network behaviour behind adapter traits.
- Treat world-state changes as operations that can be audited and tested.
- Distinguish deterministic calculation from empirically correct prediction.
- Do not make safety-sensitive decisions based solely on heuristic scores.

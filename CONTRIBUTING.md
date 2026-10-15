# Contributing

Wanxiang contains two Rust workspaces and modules with different maturity levels. Small, testable changes are preferred.

## Before submitting

1. Explain the problem and intended behaviour.
2. Keep changes scoped to one subsystem when practical.
3. Add or update tests for bug fixes and edge cases.
4. State algorithmic assumptions and known limitations.
5. Do not claim security, privacy, causal, or performance guarantees without reproducible evidence.

## Local validation

```bash
cargo test --locked --workspace
cargo test --locked --workspace --manifest-path engines/Cargo.toml
```

On Linux/macOS, `bash scripts/test-all.sh` runs both workspaces. On Windows, use `./scripts/test-all.ps1`.

Do not commit secrets, local databases, API credentials, build outputs or private planning notes.

#!/usr/bin/env bash
set -euo pipefail
cargo test --locked --workspace
cargo test --locked --workspace --manifest-path engines/Cargo.toml

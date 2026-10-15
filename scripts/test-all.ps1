$ErrorActionPreference = "Stop"
cargo test --locked --workspace
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cargo test --locked --workspace --manifest-path engines/Cargo.toml
exit $LASTEXITCODE

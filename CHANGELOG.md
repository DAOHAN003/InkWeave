# Changelog

## Unreleased — initial standalone extraction

- Extracted the world-model workspace and engine workspace from the public InkWeave source tree into a standalone repository layout.
- Added architecture, algorithm-scope and security documentation, contributing guidance, and CI for both workspaces.
- Excluded app-specific Tauri bridge code and internal planning/status notes from the extracted snapshot.
- Hardened lexical sandbox prefix matching and fail-closed handling for unknown access modes.
- A clean-checkout CI run is required before a release is tagged.

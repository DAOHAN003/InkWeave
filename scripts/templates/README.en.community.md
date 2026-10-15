# 墨织 InkWeave · Community Edition

中文 | **English**

[![CI](https://github.com/DAOHAN003/InkWeave/actions/workflows/ci.yml/badge.svg)](https://github.com/DAOHAN003/InkWeave/actions/workflows/ci.yml)
[![Release](https://github.com/DAOHAN003/InkWeave/actions/workflows/release.yml/badge.svg)](https://github.com/DAOHAN003/InkWeave/releases)
[![License](https://img.shields.io/github/license/DAOHAN003/InkWeave)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/DAOHAN003/InkWeave)](https://github.com/DAOHAN003/InkWeave/releases)

An offline-first novel-writing workbench for Chinese fiction. Your manuscript stays on your own disk, and the AI is yours to configure — a local Ollama or any OpenAI-compatible API.

```bash
# Web dev mode (try the UI with zero setup)
npm install
npm run dev

# Desktop (Tauri 2 + Rust)
npm run tauri dev
npm run tauri build
```

## Screenshots

| Writing workbench (3-pane + AI assistant) | Reading mode (full-book rendering) |
| --- | --- |
| ![Writing](screenshots/main.png) | ![Reading](screenshots/reading.png) |

Command palette (Ctrl / ⌘ + K) — every feature one keystroke away:

![Command palette](screenshots/command-palette.png)

## What it does

- **Workbench**: volumes / chapters / outline tree / a standard creation pipeline with deterministic outline decomposition — million-word structure at a glance
- **Editor**: CodeMirror, version snapshots, autosave, external chapter storage (never blows up localStorage)
- **Setting library**: characters (with deep profiles), factions, locations, and a foreshadowing board — plant → pending → payoff, fully tracked
- **AI writing (bring your own key)**: 6-step chapter pipeline, rewrite, polish, selection tools, proofreading, AI illustration, RAG prior-chapter recall, chapter self-check, quality gates
- **De-AI-flavor**: six explainable rules (simile stacking, written-register connectives, summary tone, adjective stacking, four-character-idiom runs, uniform sentence length) — selection de-flavor, whole-book heatmap, batch queue, density trends
- **Structural insight**: plot grid (character / faction / foreshadowing matrix), pacing board (chapter cards + one-click tension rewrite), tension curve
- **Reading & audiobook**: full-book rendered reading view + local speech-synthesis readthrough (sentence-level highlight)
- **Export**: EPUB / TXT / Markdown / PDF
- **Data safety**: file-level automatic backup & restore, integrity sentinel, startup recovery guard
- **Also**: command palette (⌘K), writing sprints, trilingual UI (zh / ja / en), theme system, Playwright E2E

## Model configuration

Settings → Model: fill Base URL (e.g. `http://localhost:11434/v1` for Ollama) + model name + key (leave empty for local endpoints). API keys are stored in the Windows Credential Manager, never in plaintext.

## Editions

This is the **InkWeave Community Edition**. There is also a full edition with the complete "deterministic world simulation → narrative extraction" pipeline (WanXiang world engine, 3D star-map rendering, story-vein mining, book deconstruction & benchmarking, overseas translation, multi-chapter continuous writing), which is not open-sourced for now. See [docs/EDITIONS.md](docs/EDITIONS.md) for the feature comparison.

## License

Apache-2.0 (see [LICENSE](LICENSE)). Third-party notices: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The de-AI-flavor lexicon, plot grid, and pacing board are all welcome contribution areas.

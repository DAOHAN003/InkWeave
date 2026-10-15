# 墨织 InkWeave (MoZhi InkWeave)

[中文](README.md) | **English**

[![CI](https://github.com/DAOHAN003/InkWeave/actions/workflows/ci.yml/badge.svg)](https://github.com/DAOHAN003/InkWeave/actions/workflows/ci.yml)
[![Release](https://github.com/DAOHAN003/InkWeave/actions/workflows/release.yml/badge.svg)](https://github.com/DAOHAN003/InkWeave/releases)
[![License](https://img.shields.io/github/license/DAOHAN003/InkWeave)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/DAOHAN003/InkWeave)](https://github.com/DAOHAN003/InkWeave/releases)

An offline-first, engine-driven AI workbench for writing long-form Chinese fiction — built on Tauri, React, TypeScript, and a deterministic world-simulation engine written in Rust.

It is not a "prompt → generate → pray" chat window. The app organizes context around your novel's structure (characters, settings, timelines, prior chapters, creative rules), runs deterministic quality gates before and after generation, and auto-rewrites when a chapter fails — preventing character drift, setting contradictions, plot breaks, and style decay across 500k+ word manuscripts.

## Screenshots

| Writing workbench (3-pane + AI assistant) | Reading mode (full-book rendering) |
| --- | --- |
| ![Writing](screenshots/main.png) | ![Reading](screenshots/reading.png) |

Command palette (Ctrl / ⌘ + K):

![Command palette](screenshots/command-palette.png)

## The differentiator: a deterministic world engine

Most AI writing tools generate text and hope for consistency. InkWeave runs a **deterministic world simulation first** (17 Rust crates) and lets the LLM narrate what happened in that world:

- **Reproducible by seed** — the same seed reproduces the world byte-for-byte, frame by frame (conservation-law accounting keeps drift ≈ 0 across Matter / Energy / Information / Entropy pools)
- **Causal verification** — a built-in do-calculus engine (d-separation, backdoor criterion, counterfactuals) fact-checks LLM output against the world's causal graph with zero tokens
- **SDR sparse memory** — 2048-bit sparse distributed representations (2% sparsity) for character memory, with neuromodulatory decay weights
- **Cognitive NPC models** — theory of mind, counterfactual reasoning, meme evolution, dream integration, insight catalysis — all deterministic, all optional behind compile-time switches

## Everything a long-form author needs

- **Structure**: multi-novel / volume / chapter management, outline tree, story canvas, plot grid (chapter × storyline matrix), foreshadowing board (plant → pending → payoff)
- **AI pipelines (BYOK)**: 6-step chapter pipeline, multi-role review chain, rewrite & polish, constrained JSON decoding with automatic fallback — Ollama or any OpenAI-compatible API
- **De-AI-flavor**: 20-item cliché regex blacklist, simile-density caps, beat rotation (6 openers × 5 tension curves), style presets — failed gates trigger automatic rewrite
- **Analysis**: quality scoring, story evaluation, pacing board, tension curve, AI-trace detection (local LNN inference), book deconstruction & benchmarking
- **Reading & audiobook**: full-book rendered reading view, local TTS with sentence-level highlight
- **Export**: EPUB / TXT / Markdown / PDF
- **Data safety**: external chapter storage, rolling file backups, integrity sentinel, startup recovery guard
- **Truly offline**: the core works with no network — LNN inference and offline word-vector RAG need zero APIs

1,312 frontend unit tests + 12 Playwright E2E tests + 1,076 Rust engine tests, all running in CI.

## Quick start

```bash
npm install
npm run dev        # Web dev mode
npm run tauri dev  # Desktop (Tauri 2 + Rust)
```

Windows installer (~4.4MB) available in [Releases](https://github.com/DAOHAN003/InkWeave/releases).

## Model configuration

Settings → Model: Base URL (e.g. `http://localhost:11434/v1` for Ollama) + model name + key (empty for local endpoints). Keys are stored in the Windows Credential Manager.

## License

Apache-2.0 (see [LICENSE](LICENSE)). See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute — the de-AI-flavor lexicon and pacing board are welcome areas.

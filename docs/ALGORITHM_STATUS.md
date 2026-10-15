# Algorithm status and scope

This document distinguishes implementation presence from theoretical or empirical validation.

| Area | Present in code | Scope / limitation |
|---|---|---|
| World state | Entity/world types, deterministic identifiers, abstract resource ledger | Resource-pool totals are bookkeeping invariants, not physical conservation laws. Validate domain units and invalid numeric inputs. |
| Causal graphs | Weighted directed graphs, separation utilities, path/intervention-style propagation | Correctness depends on graph assumptions. Simplified path sums do not by themselves constitute a complete causal-inference implementation. |
| Causal abstraction | Candidate node mappings based on permutation enumeration and edge/sign matches | Search is factorial. It is suitable only for small graphs; this is not a full VF2 implementation. |
| Memory | Deterministic sparse codes, weighting, association and causal-link components | Determinism is not semantic similarity. Benchmark retrieval against keyword/BM25 and vector baselines on labeled tasks. |
| Action selection | UCB1-style selection, rule-based metacognitive checks, evolutionary selection | UCB1 and NSGA-II are established methods. Surrounding rules remain heuristics unless independently evaluated. |
| Agent runtime | ReAct-style flow, tool registry, approval policies, skills and team orchestration APIs | Interfaces and unit tests do not prove robust real-world autonomy, safe tool execution or distributed reliability. |
| LLM adapter | Adapter trait, cache and route-selection helpers | A common interface does not imply every provider has a production-ready network/SSE implementation. |
| Security helpers | Pattern scanning, path-policy checks, audit and privacy helpers | Defense-in-depth utilities, not a sandbox boundary or formal privacy guarantee. |
| Narrative suite | Concept spreading, causal checks, consistency heuristics and memory workflows | Heuristic scores do not establish story quality or reliable semantic understanding. |

## Recommended validation

1. Unit tests for algorithm invariants and malformed inputs.
2. Property-based tests for resource accounting and graph operations.
3. Labeled corpora for memory retrieval, causal alerts and character-consistency checks.
4. Baselines with false-positive/false-negative reporting.
5. Benchmarks with explicit runtime and memory limits.
6. A clean-checkout CI run for both workspaces before a release is tagged.

A test count, deterministic output, or use of a named algorithm is not proof of theoretical correctness or application-level effectiveness.

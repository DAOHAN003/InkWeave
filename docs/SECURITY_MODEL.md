# Security model and limitations

The `security_suite` package contains security-oriented checks and policy helpers. Treat it as an additional layer, not a security boundary.

## What it can help with

- Pattern-based detection of some risky text and prompt-injection indicators.
- Lexical path-policy decisions.
- Basic PII-pattern scanning and redaction helpers.
- Audit records and simple threat-model scoring.

## What it does not guarantee

- It does not isolate processes or restrict the operating system on its own.
- Lexical path normalization does not resolve symlinks, mount points, Windows reparse points, race conditions, or filesystem-specific semantics.
- Pattern scans can have false positives and false negatives.
- A hash-chained log is not inherently tamper-proof against an attacker who can rewrite the entire log.
- PII regexes are not complete privacy classifiers. Differential-privacy guarantees require a defined adjacency model, calibrated mechanism and composition accounting.

## Safer integration

1. Use process/container/OS permissions for actual isolation.
2. Canonicalize and validate the filesystem object at the point of access; account for symlinks and time-of-check/time-of-use races.
3. Fail closed on unknown operations and malformed paths.
4. Avoid storing raw user content, prompts, API keys, or personal information in audit events unless necessary and explicitly configured.
5. Test attacker-controlled paths, encodings, sibling-prefix paths, symlinks, and platform-specific path forms.
6. Treat model output and tool arguments as untrusted input.

Report vulnerabilities privately as described in [SECURITY.md](../SECURITY.md), not in a public issue.

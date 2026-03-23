# Benchmark Fixtures

Fixture repos and specs are the durable reproducibility layer for benchmark runs.

- `repos/`: deterministic repo templates copied into temporary workspaces for `ci_safe` benchmark execution.
- `specs/smoke/`: fast CI-safe task inputs for control-plane regression coverage.
- `specs/fresh/`: normalized recent real-task inputs backed by candidate provenance records.
- `specs/longhorizon/`: broader milestone-style inputs for intentional long-form benchmark runs.

Keep fixture material separate from persisted benchmark run artifacts under `runs/benchmarks/`. If a fixture is simplified or redacted from a real task, record that in the candidate and accepted-case metadata instead of silently rewriting the source context.

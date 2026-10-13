# Operations, logging and debugging

## Twelve-factor adaptation

Aetherion is a single-machine local-first system. Apply the [Twelve-Factor App](https://12factor.net/) as operational discipline; source vaults, model files, database volumes and durable checkpoints are deliberate persistent backing resources.

| Factor            | Aetherion rule                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Codebase          | One Git repo, issue-linked branches/commits, reproducible releases                                        |
| Dependencies      | Exact versions + lockfile; pin model digests and reviewed skill revisions                                 |
| Config            | Validated nonsecret YAML plus environment secret/deployment overrides; fail fast; commit only examples    |
| Backing services  | DB/Redis/Ollama accessed through configurable private endpoints and scoped adapters                       |
| Build/release/run | Build artifacts separately; release includes commit/config/migration versions; run immutable artifact     |
| Processes         | Process memory is disposable; threads/jobs/approvals/checkpoints live in Postgres/Redis                   |
| Port binding      | Each service declares its port; bind loopback/Tailscale explicitly; no wildcard exposure                  |
| Concurrency       | Separate API/worker/channel processes; bound queues; one GPU request through LlmGate                      |
| Disposability     | Handle SIGTERM: stop intake, close SSE, drain/cancel bounded work, close clients; recover durable jobs    |
| Dev/prod parity   | Same Node/package versions and DB migrations; synthetic development data; private service config          |
| Logs              | Structured stdout/stderr events; external rotation/retention; audit records are separate durable evidence |
| Admin processes   | Doctor, migrations, ingest, backup and restore are explicit one-off commands with config/version context  |

Validate config once at startup. Precedence is documented: explicit CLI for diagnostics → allowed environment overrides → checked-in nonsecret defaults. Reject unknown config/invalid private addresses. No credentials in `NEXT_PUBLIC_*`, browser bundles, URLs, CLI arguments or logs. `.env.example` documents variable names and safe placeholder values. Do not add runtime dependencies on cloud telemetry.

Liveness proves the process responds; readiness reports dependency/config/migration state. Detailed health is authenticated. Startup should not auto-migrate or run a full ingest. Service units restart with bounded backoff; readiness does not claim a model is resident without observing it.

## Logging contract

Pino in server applications; JSON production stdout; pretty transport only for local development. Create a scoped child logger with `service`, `component`, `requestId`; add `runId`, `threadId`, `jobId`, `stepId`, `approvalId` and `traceId` when present. Propagate correlation across HTTP/SSE/jobs/tool calls without trusting arbitrary inbound IDs. Use bounded, validated correlation IDs.

Event fields include `event`, `outcome`, `durationMs`, stable `errorCode` and safe counts/role names. Debug traces include queue wait/load/prefill/decode/retrieval/tool timings, not private text. Error objects retain cause/stack locally after redaction; API responses receive a safe code/requestId. Log errors once at the responsible boundary. Audit records capture action/decision/actor/idempotency and safe previews under retention/access policy; they are not ordinary logs.

Levels: debug for scoped diagnostics, info for lifecycle/completion, warn for recoverable degradation/retry, error for failed operations requiring action. No raw payloads, authorization/cookie headers, OAuth tokens, DB URLs, private prompts, document content, message bodies or bank rows. Redact by schema/serializer as well as key paths; arbitrary nested payloads must not be logged. Test redaction using fake secrets. Model output/prompt debugging is opt-in, local, access-controlled and time-limited; never send it to GitHub issues or Actions artifacts.

Metrics use bounded labels (service, role, event/status); never user text, IDs or paths as high-cardinality labels. Track queue depth/age, latency distributions, GPU reloads, embedding throughput, retrieval quality, job failures and approval expiries. Cross-check Ollama residency metadata with GPU measurements when known reporting issues exist.

## Debugging runbook

1. Create/link an issue. Record expected/actual behavior, safe reproduction, commit/config/migration versions and request/run ID.
2. Run doctor/readiness and identify whether the failure is transport, queue, model reload/inference, retrieval, tool execution or persistence.
3. Reproduce with minimal synthetic data. Correlate structured events by ID; inspect the first error/cause and timings. Avoid increasing log level globally or dumping private payloads.
4. API: check schema/auth/deadline/errors. DB: inspect locks/connection pools and query plans; use EXPLAIN ANALYZE only for reviewed reads in an isolated representative DB because it executes the query. AI: inspect role/context/digest and retrieval sources; evaluate prompt changes against fixtures.
5. Frontend: use React DevTools/Profiler, Query Devtools and browser network/cancel/reconnect traces in local development only. Inspect selectors, stale keys, hydration and Effect cleanup before memoizing. Zustand devtools must not leak private state.
6. Add a failure-focused regression test, implement the smallest fix, rerun affected checks, and document reproduction/resolution in the issue.

Use the Node inspector bound to 127.0.0.1 with a documented local command; never expose it remotely by default. Breakpoints can hold DB locks and trigger deadline behavior: reproduce with isolated services. Remove temporary probes and diagnostics before merging.

References: [Pino redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md), [Node debugger](https://nodejs.org/api/debugger.html), project [security/recovery spec](../specs/security-recovery.md).

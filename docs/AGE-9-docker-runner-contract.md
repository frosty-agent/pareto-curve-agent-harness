# AGE-9 Docker runner contract

This is the migration contract for replacing `openrouter-worker.mjs` with the adapter from the verified fork [`frosty-agent/open-agent-sdk-typescript`](https://github.com/frosty-agent/open-agent-sdk-typescript) at commit `6933905657de3349ad34d88737f09807dbc4b75e`.

## Invocation boundary

The host starts **one** runner container. It may build the image and provide the two bind mounts below, but it must not fetch the catalog, compute/escalate the ladder, invoke an agent, invoke the judge, or generate reports. Those operations are performed by `src/container-run.ts` inside the runner container.

```bash
docker run --rm \
  -e OPENROUTER_API_KEY \
  --mount type=bind,src="$(pwd)/target-repository",dst=/source,readonly \
  --mount type=bind,src="$(pwd)/pareto-reports",dst=/reports \
  pareto-runner:latest
```

`/reports` is the only required writable host bind mount. `/workspace` is created and destroyed by the runner inside its container; it is not mounted from the host.

## Fork adapter interface

The runner Dockerfile clones, builds, and copies the pinned fork into `/opt/open-agent-sdk`; `open-agent-worker.mjs` imports its `Agent` runtime from that path and is called once per ladder attempt by the in-container runner. It must receive:

| Input | Contract |
| --- | --- |
| `PARETO_TASK_CONTEXT` | JSON serialization of `WorkerContext`: task, selected ladder model, `WorkspaceInfo`, attempt number, and any previous-attempt context. |
| `OPENROUTER_API_KEY` | Runtime-only environment variable. It must not be baked into an image or emitted in output. |
| `/workspace` | Writable, disposable Git clone of `/source`, created by `ContainerWorkspace`. The adapter must perform all repository reads and edits here. |
| `/source` | Read-only target repository. The runner clones it into `/workspace`; the adapter must not edit it. |
| `/reports` | Runner-owned report/patch output directory. The adapter does not need to write here. |

The adapter writes exactly one JSON `WorkerResult` to stdout. Its stdout therefore cannot contain progress logging. Diagnostics belong on stderr. The fork `Agent` receives only the adapter's workspace-scoped `read_file`, `list_files`, `write_file`, and allowlisted `run_check` tools, so its tool calls and tool results remain in the Docker worker. The adapter must not run a host command, invoke Docker, or expect a Docker socket.

## No-host-loop invariant

**No host process may perform the per-model attempt loop.** The same runner process that calls `fetchCatalog`, `buildLadder`, `ParetoTaskLadder.run`, `OpenRouterJudge`, and `writeReports` must also invoke the fork adapter directly. In particular, AGE-9 must not reintroduce `DockerCommandWorker`, `DockerGitWorkspace`, `docker run`, or a Docker socket as an intermediate execution layer for an attempt.

This invariant keeps catalog fetch, ladder selection, all agent attempts, judging, and report generation in one runner container. The host is limited to container lifecycle, key injection, and the declared `/source` and `/reports` bind mounts.

## Acceptance check

`test/container-runner-contract.test.ts` is a source-level fixture for this boundary. It fails if the runner image or runner source loses either required mount, stops calling the catalog/ladder/judge/report path in-container, or introduces a Docker/host-loop worker path. Update the test and this contract together only when intentionally changing this interface.

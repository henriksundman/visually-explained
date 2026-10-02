## vexp - Context-Aware AI Coding <!-- vexp v3.2.5 -->

### Context strategy: call run_pipeline ONCE at task start
If the task already names the files/symbols to touch, SKIP vexp. Otherwise one
`run_pipeline({ "task": "..." })` returns ranked pivot files with line ranges and
blast radius. Do NOT open files one by one to find your way around - every extra
tool call costs a turn. Call it again ONLY when the task moves to a new area.
`get_skeleton` for files to understand, not edit. `verify_done` before calling a
multi-file task complete, then RUN the tests it names.

### Query shape (do this)
Anchor the task on real identifiers (ClassName, functionName) or file paths:
`run_pipeline({ "task": "fix JWT expiry in AuthService.validateToken" })`

vexp runs entirely on this machine, index in `.vexp/`;
`run_pipeline` transmits nothing to any external service.
On `status: "degraded"` or 0 pivots the index is still building - use your own tools.
For literal string sweeps use your native search - do NOT route text sweeps through vexp.
Repo SOURCE only: logs, dist/, node_modules/ and files outside the repo are NOT indexed.
<!-- /vexp -->

### Freebuff / non-VS-Code agents
If the vexp MCP tools are not available in this session, drive the same index via
the CLI wrapper: `./scripts/vexp <subcommand>` (same CLI as `vexp-core`). Useful
subcommands: `search --json <terms>`, `capsule "<query>"`, `skeleton <file>`,
`impact <file>::<Symbol>`, `flow <a> <b>`, `verify`. The wrapper auto-resolves
the newest extension binary and targets this repo as VEXP_WORKSPACE.

### Plan execution: inline only, no CLI subagents
Do NOT dispatch subagents via external CLIs (claude, gemini, ...) — they are
unauthenticated/unreliable headless on this machine. Execute plan tasks inline
in-session, but keep the SDD quality gates: per-task commits, the plan's
verification steps (commands + expected output), and a fresh-eyes review pass
against the spec before calling a multi-task plan done. Task briefs live in
`.superpowers/sdd/` (git-ignored scratch); progress ledger at
`.superpowers/sdd/progress.md`. Finishing a branch includes appending a
"Branch finished" line to that ledger (merge state, tests on merged result,
push state, branch deletion) — part of the finish step, not an afterthought.
A debugging session that surfaces a reusable lesson appends a dated entry to
`docs/DEBUGGING.md` (symptom → root cause → fix → rule) before the branch
finishes; consult its Part 1 triage list before deep-diving on a bug.

### Open threads: read before changing shipped code
`docs/OPEN_THREADS.md` records the judgement calls shipped work was left with —
the deliberate decisions, the known-rough edges, and what to revisit if. **Read
it first when picking up a session, and before touching code it names.** A
divergence that looks like a bug may be a decision with a reason behind it
(a drag ignoring the param's `step`, the timeline's 825px budget, focus
restoration being browser-verified only). Shipping a deliberate choice without
recording it leaves the next session to re-derive it — or to "fix" it.
Append a thread when a session ends with a judgement call that is not visible
in the code, the spec, or the ledger.

### Merge gate: user reviews before main
The user wants to review a finished branch before it lands. Complete all
other finish steps (verification, review, ledger), then **stop and present
the work** — demo URL, what to look at, diff stat — and merge to `main` only
on explicit go-ahead. Keep the feature branch (do not delete it) until the
merge is approved, so the work stays inspectable and discardable
(`git checkout main && git branch -D feature/x` undoes everything).

### Running the demo server
The server (`demo/server.mjs`) serves the BUILT package (`dist/`) plus the demo
fixtures, on port 4173 (`PORT` env to override). Routes: `/` (all examples),
`/document` (multi-section document page), `/interactive` (figure runtime).

1. Build first, or routes 404 and old code keeps serving: `npm run build`.
2. Start detached — a server started with `&`/`nohup` from an agent tool call
   is killed when that call exits, even if it answered a request first. Use
   launchd so it survives and restarts on crash:

   ```bash
   npm run build
   launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
   ```

3. Verify from a SEPARATE tool call before telling the user it's up:
   `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/document`
   (expect 200).
4. Stop it with `launchctl remove explanations-demo`.

`EADDRINUSE` on 4173 means a stale server from an earlier session is still
running (it serves the dist/ that existed when it started): find it with
`lsof -ti tcp:4173`, kill that PID, then start fresh. A long-lived server must
be restarted after `npm run build` to pick up new dist output.

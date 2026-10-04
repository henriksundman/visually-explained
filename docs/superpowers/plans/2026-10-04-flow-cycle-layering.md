# Plan: cycle-aware flow layering + back-edge return paths + clamp alignment

Implements `docs/superpowers/specs/2026-10-04-flow-cycle-layering-design.md`.
Branch: `fix/flow-cycle-layering`. Baseline: `d84caa0`'s successor — the commit
this branch was cut from (`5634429`).

All work happens in `src/figures/layoutFlow.ts` plus tests and docs. No emit
layer, schema, or block-type change.

## Ground rules for every task

- One commit per task, message explaining **why**.
- Run `npx tsc --noEmit` after every task that touches `src/`.
- Run the task's named tests before committing.
- Do not edit `demo/examples.js` — the fixture is the test case, not the thing
  under test. If a fixture must change to look right, that is a bug in the fix.

## Task 1 — cycle-aware layering

**File:** `src/figures/layoutFlow.ts` step 3 (lines ~144–160).

Replace the capped relaxation with DFS classification + relaxation over forward
edges only.

1. Add an exported-for-test helper (or internal, tested through `layoutFlow`)
   that walks nodes in **spec order** with an explicit stack:

   ```
   state: 0 = white (unvisited), 1 = grey (on stack), 2 = black (done)
   edge u→v is a BACK edge iff state[v] === 1 when it is examined
   ```

   Return `Set<string>` of back-edge keys, keyed `"${from}->${to}"` (the same
   key form the arrow `id` already uses, so no new key convention).

   **Iterative, not recursive** — a model-authored chain must not blow the
   stack. Each white node starts a fresh DFS; adjacency is in spec order.

2. Keep the existing relaxation loop but feed it only non-back edges. It now
   terminates because the subgraph is acyclic; the `changed` early-exit and the
   pass cap both stay (the cap is now a belt-and-braces guard, not the
   mechanism).

3. Delete the "capped at nodes.length passes, so cyclic layers stabilize"
   comment — it described a behaviour that did not stabilize, which is the
   bug. Replace with a comment stating the invariant that now holds.

4. Stash the back-edge set on the layout scope so step 6 can read it.

**Verification**

```
npx tsc --noEmit
npx vitest run tests/figures/layout-flow.test.ts
```

New tests (in Task 4's file, written here so the task is self-verifying):

- The `howToIr` diagram layers to `req=0 cache=1 fresh=2 origin=2 reval=3`.
- Scene width for that spec is **< 900** (was 1556).
- The two-node existing tests still pass unchanged — a cycle-free spec must
  produce **byte-identical** output to before this task.

## Task 2 — back-edge return paths

**File:** `src/figures/layoutFlow.ts` step 6.

For each back edge, emit a return path instead of the normal route:

- **lr:** `sx = a.x + a.w/2`, `sy = a.y + a.h` (source bottom);
  `tx = b.x + b.w/2`, `ty = b.y + b.h` (target bottom);
  control points both at `ly`. Head is a triangle at `(tx, ty)` opening
  downward so the tip points **up** into the target.
- **tb:** mirror — leave the source's right edge, lane to the right of every
  node, head pointing **left** into the target's right edge.
- **Coincident cross-axis centres** (within 1px): emit the orthogonal 3-segment
  form instead of the cubic, which would degenerate.

**The ¾ rule (spec §2.2).** With both control points at `ly` and endpoints at
`y0`/`y3`, the curve's true extremum is **not** `ly`:

```
t* = u/(1+u),  u = sqrt((ly - y0)/(ly - y3))
depth = y(t*)
```

For equal endpoints this is `depth = y0 + 0.75*(ly - y0)`. Compute the depth
**forward** from the control depth — do not invert numerically.

Add a small pure helper with a comment stating the ¾ rule, so the next editor
does not size the scene from `ly`.

**Lanes.** `LANE_PITCH` per back edge, indexed by back-edge order, so two
cycles in one figure do not draw over each other.

**Scene extent.** A return path extends below every node, so the scene height
must contain it: `height = max(height, maxRealDepth + headAllowance)`. This is
computed from the **real** depth, not the control depth.

**Verification**

```
npx tsc --noEmit
npx vitest run tests/figures/layout-flow.test.ts
```

- A single-back-edge spec: the path's lowest point is below every node's
  bottom edge, and the head's tip points up.
- Two back edges: their lanes differ.
- Scene height contains the deepest return path.

## Task 3 — clamp before serialize

**File:** `src/figures/layoutFlow.ts` steps 5–8.

Reorder so the scene clamp is applied to node placement and edge paths are
built from final coordinates (spec §2.3):

1. Place nodes (unchanged).
2. Compute each edge's **label anchor and line count** — `labelX`, `labelY`,
   `lines` — which need node positions but no path string.
3. Scan label extents (the existing `minY`/`maxY` loop) to get the shift.
4. Apply the shift to node `y` and to `labelY`.
5. **Then** build `d`/`head` from the shifted node coordinates.
6. Assemble the `elements` array edges-first, nodes-second — preserving the
   existing paint-order guarantee, which is about array order, not compute
   order.

Delete the old post-hoc `el.y -= minY` loop. It becomes unrepresentable:
there is no serialized path left to forget.

Also add the `figure-edge-negative-gutter` warning (spec §2.4): when a
**rendered** (non-back) edge has `b.x - (a.x + a.w) < 0`, push a warning. With
back edges routed separately this is now a genuine authoring error, not a
layout artefact.

**Verification**

```
npx tsc --noEmit
npx vitest run tests/figures/layout-flow.test.ts
```

- The regression case: a spec engineered so a label block hangs above the
  origin has **zero** misaligned arrows. This must fail on `main` — check by
  stashing the fix, or by running the same assertion at `5634429` in a
  worktree.
- Every non-diagram fixture's rendered HTML is unchanged (Task 5's diff gate).

## Task 4 — tests

**File:** `tests/figures/layout-flow.test.ts` (extend the existing file).

The central one is an **invariant**, not a golden file:

```ts
// Every arrow endpoint's path y must equal the RENDERED node's centre.
for each arrow el with id "a->b":
  firstY of d  === mustNode(scene,"a").y + h/2
  lastY  of d  === mustNode(scene,"b").y + h/2
```

Assert it over **every diagram fixture in `demo/examples.js`**, not just a
hand-built spec — this is what would have caught the regression on the day it
shipped.

Plus, per spec §5:

- no layer explosion on cyclic specs (fixture + a gnarly 2-cycle graph)
- positive gutter on every rendered edge; no edge-label line under 4 chars
- back edge dips below all nodes, head points up
- two back edges get distinct lanes
- clamp regression case (label above origin ⇒ arrows still aligned)
- determinism: two calls byte-identical

**Verify each new test bites.** A test that passes before the fix is not a
test. For each, run it against `5634429` in a worktree and confirm it fails:

```bash
git worktree add --detach /tmp/vn-base 5634429
ln -s "$PWD/node_modules" /tmp/vn-base/node_modules
(cd /tmp/vn-base && npx vitest run tests/figures/layout-flow.test.ts)
```

Expected: the alignment invariant and the width test fail. The others fail to
exist.

## Task 5 — docs

- **README:** one sentence in the figure-layer section noting that a diagram
  containing a cycle is layered with the cycle broken, so feedback loops stay
  compact instead of exploding into empty ranks. **No** block-type list edit
  and **no** `N primitives` bump — this adds no block type, so
  `tests/readme.test.ts` must still pass untouched. Run it to prove it.
- **`docs/OPEN_THREADS.md`:** append a thread recording (a) that capped
  relaxation was replaced and why, and (b) the ¾ rule — a cubic's control line
  is not its extent, which is a reusable trap for any future curve geometry.
- **`docs/DEBUGGING.md`:** a Part 1 triage entry — *"figure looks tiny / text
  illegible"* ⇒ check scene width against the rendered column width; a wide
  `viewBox` scales down rather than overflowing, and the usual cause is a
  cycle exploding the layer count. Symptom → root cause → check → fix.
- **`docs/ROADMAP.md`:** add a `Shipped` line.

**Verification:** `npx vitest run tests/readme.test.ts`

## Task 6 — the gates

```bash
npx tsc --noEmit
npm test
npm run build
```

Then the mandatory rendered-output diff. Baseline is the commit this branch was
cut from:

```bash
git worktree remove --force /tmp/vn-base 2>/dev/null || true
git worktree add --detach /tmp/vn-base <baseline-sha>
ln -s "$PWD/node_modules" /tmp/vn-base/node_modules
(cd /tmp/vn-base && npm run build)
node .superpowers/render-fixtures.mjs "$PWD/dist" /tmp/after.txt
(cd /tmp/vn-base && node "$OLDPWD/.superpowers/render-fixtures.mjs" "$PWD/dist" /tmp/before.txt)
diff /tmp/before.txt /tmp/after.txt
```

**Expected diff: only the `howToIr`/`demoDocIr` diagram block.** Everything
else — `figuresIr`, charts, timelines, all other figures and prose — must be
**byte-identical**. A diff touching anything else means a fixture-independent
regression; stop and find it before committing.

Then restart the demo server and verify in real Chrome:

```bash
launchctl remove explanations-demo 2>/dev/null; sleep 1
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/
```

CDP assertions on `/`:
- the pipeline diagram's arrow endpoint `y` matches its node centre `y + h/2`
- the edge label reads `miss / stale` (one line, not `["miss","/","stal","e"]`)
- effective scale = rendered width / `viewBox` width ≥ 0.9
- no console exceptions; all six routes 200

## Task 7 — fresh-eyes review

Re-read the diff against the spec, as if reviewing someone else's work:

- Does the layering handle a node reachable only via a back edge?
- Is determinism preserved (spec order everywhere, no `Set`/`Map` iteration
  leaking into output order)?
- Does the clamp still cover labels **and** return paths?
- Is `figure-edge-negative-gutter` reachable in practice, or dead code?
- Does any test pass vacuously (loop body never runs)?

Fix what it finds, then present to the user for merge approval. Do not merge to
`main` without explicit go-ahead; keep the branch.

## Ledger

Append a line to `.superpowers/sdd/progress.md` when the branch finishes:
merge state, tests on the merged result, push state, branch deletion.
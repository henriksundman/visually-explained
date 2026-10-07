# Debugging Playbook

Lessons from real debugging sessions in this repo, recorded so future sessions
don't pay for them twice. Two parts: a **check-first triage list** of this
codebase's recurring failure modes, and **dated entries** (newest first) in the
format *symptom → root cause → fix → rule*.

**Convention** (see `AGENTS.md`): a debugging session that surfaces a reusable
lesson appends an entry here before the branch finishes. Keep entries tight —
four lines, one rule each. The progress ledger (`.superpowers/sdd/progress.md`,
git-ignored) is the raw feed; this file is the distilled, versioned record.

## Part 1 — Check first

Before deep-diving, test the failure against these recurring patterns:

- **A clean run with garbage output: check what the model actually returned.**
  `0 repairs / 0 failures / valid: true` while the rendered pages are nearly
  empty means the validation surface is lenient *by design*
  (`documentSectionSchema.blocks` is `z.array(z.unknown())`), so the repair
  loop cannot see block-level violations. Dump the raw reply and check every
  block starts `{ "type":`. See the 2026-10-07 entry — and run prompt
  changes against a real model before trusting them.
- **A one-shot job under `launchctl submit` re-runs after a clean exit.**
  One `submit` observed to start the script three times, each relaunch
  truncating the shared log with `>`. Remove the label as part of the run
  and confirm with `ps` before trusting a log. See the 2026-10-07 entry.
- **Stale `dist/`.** The demo server serves the *built* package and holds it
  from process start: rebuild without restart → old behavior; `EADDRINUSE` on
  4173 → a stale server from an earlier session (`lsof -ti tcp:4173`, kill,
  resubmit). See AGENTS.md "Running the demo server".
- **Browser module-graph holes.** Demo route 200s but the page is blank:
  bare specifiers reachable from `dist/` (`zod`, `roughjs`) must be in the
  page's importmap. Read the console, not just the status code.
- **zod object schemas strip unknown keys.** If a render ignores a field the
  host or LLM attached, check the field is *declared in the schema* before
  debugging the renderer. "Parses fine but the field is gone" is the signature.
- **A degradation guard can be unreachable.** A cap below what the schema
  admits never fires, because the block is rejected before the renderer sees
  it: a 30-child tree hits `MIND_MAP_MAX_CHILDREN` (8) first, so a
  `nodes > 24` guard cannot be tested with one. Check that a guard's fixture
  survives validation, and measure the fixture — `mindMapFigureWidth` of
  three 400-character labels is 314px, because labels wrap at 176px and scene
  width is set by DEPTH (one column per level), not by label length.
- **`z.object` strips, so an unrolled schema needs a strict leaf.** An
  explicit ladder without `.strict()` at the bottom rung accepts `children`
  and silently discards the whole subtree below it: a 500-deep chain validates
  as a clean 12-deep tree, losing 488 nodes with no diagnostic.
- **A stylesheet test proves the CSS parses, never that it applies.** Assert
  the class is in the emitted markup too, at every level of a recursive
  structure — the outermost element always looks right.
- **`.focus()` is not a keyboard test.** A scripted `el.focus()` fires **no**
  `focusin` on an injected SVG element, so a focus-driven popover never opens
  and the keyboard path looks dead when it is not. Dispatch a real Tab
  keypress (`Input.dispatchKeyEvent`) instead. See the 2026-10-05 entry.
- **Never remove React-rendered DOM by hand to reset probe state.** Calling
  `popover.remove()` leaves React's virtual DOM believing the node is still
  mounted, so the next state update patches the *detached* node and the
  element appears to vanish. Reload the page between cases.
- **A child component's effects land AFTER the parent's body has run.** If a
  parent collects state during render and reads it back in the same body, a
  child that mutates that state is always too late — the parent's read sees the
  pre-child value. Symptom: the child behaves correctly when rendered alone,
  and reports nothing through the parent. See the 2026-10-05 entry.
- **A prop with a sink attached can still be silent** if the sink is on the
  wrong side of the render boundary. Before assuming the fix failed, check
  whether the parent's read happens before or after the child's body.
- **An effect is not available for reporting under SSR.** `renderToStaticMarkup`
  never runs effects, so a component that reports from `useEffect` reports
  nothing in the server-rendering path these components exist for.
- **Salvage is all-or-nothing per block.** A block failing its own schema is
  skipped whole (`[invalid-block]`, empty render). There is no partial payload
  for a field to "survive" on.
- **Degenerate clamp intervals.** `min(max(x, lo), hi)` misbehaves when
  `lo > hi` (narrow containers): the wrong bound wins. Clamp the lower bound
  last, and test the narrow case explicitly.
- **Prototype pollution on externally-keyed records.** Any record keyed by
  host/LLM strings (`registry[type]`, `datasets[key]`) needs a null prototype
  (`Object.create(null)`) and `Object.hasOwn` lookups, or `"constructor"` /
  `"__proto__"` resolve to inherited values.
- **Smoke greps must target rendered output.** Block `id`s never appear in
  HTML; `data-el-id`s, labels, values, and emitted attributes do.
- **Figures scale, they do not overflow.** `sceneToSvg` emits a `viewBox` with
  no `width`, and `.exp-figure` is `width: 100%; height: auto` — so a wide scene
  is *shrunk* to its column, not allowed to stick out. An 11px label in a
  2,472px scene renders at ~3px in a 700px column. Before adding a horizontal
  scrollbar or a wider figure, check what the width budget costs at render time.
- **A figure that is too BIG is a sizing-model bug, not a layout bug.** If a
  figure renders larger than the surrounding type, the scene is probably fine
  and the box is wrong: `.exp-figure` is `max-width: 100%` and the `<svg>`
  carries an intrinsic `width`/`height`, so a narrow figure renders 1:1 rather
  than stretching. Measure `box.width / viewBox.width` before touching
  `layoutFlow` — a `tb` figure at 2x is this, not a coordinate bug. A
  `max-height` cap does **not** help: `width: 100%` has already fixed the box
  width, so the cap letterboxes the content down instead.
- **Diagram `direction: "tb"` is exercised far less than `lr`.** Same-rank
  siblings are spaced by node *width* on the horizontal cross axis (spacing by
  height was a real bug, fixed 2026-10-04), skip-rank edges route down the
  source column and can overprint an adjacent edge, and an edge label sits at
  the source column centre — so two labelled edges out of one node land on the
  same point. Two of those three are still open; see ROADMAP Backlog.
- **A tiny figure is usually a layout bug, not a size budget.** If a figure
  renders far smaller than its siblings at the same font size, print
  `scene.width` before touching CSS — an unexpectedly wide scene is the
  cause, and the emit layer will hide it by shrinking. For `diagram`, the
  usual culprit is a CYCLE in the node graph: relaxed ranking cannot terminate
  on one, so layers inflate and the empty ranks between them still consume
  width. Also check for a negative label gutter (`b.x - (a.x + a.w) < 0`),
  which clamps to a few pixels and shreds the label into stubs.
- **Never move geometry that was already serialized.** `ArrowEl.d`/`.head`
  are path STRINGS built before the scene clamp runs. A clamp that adjusts
  `node-box.y` and `arrow.labelY` but not `d` moves the boxes and leaves the
  arrows behind — every arrow then floats above its node's centre and reads as
  "aligned to the top". Resolve the shift on node placement and build paths
  from the final coordinates; z-order is array order, so this costs nothing.
- **A Bezier's control point is not on the curve.** With both control points
  at `ly`, the curve reaches only `y0 + 0.75·(ly - y0)` — sizing a `viewBox`
  from `ly` clips it. Sample the path, or use `cubicDepth`.
- **Entry-point families.** Threading an option through render paths? Grep
  every call site of the shared helpers (`renderSalvagedBlock`, `renderBlock`)
  — plan file lists have missed call sites before.
- **Never hand-copy a sibling's decision logic.** If React and the string
  renderers must agree on something, it belongs in a shared helper
  (`documentDiagnostics`, `sectionOk`, `renderSalvagedBlock`,
  `collectAnchors`), not in a second implementation. A copy is a fork, and it
  drifts on exactly the broken-input path you wrote it to describe.
- **Probe a fixture's actual warning before asserting on it.** A fixture more
  broken than intended yields a *different* code: `series: []` gives
  `[invalid-block]` not `[dataset]`, `stack` children live under `blocks` not
  `children`, an explanation IR needs `version`. Three fixtures in one cycle
  passed for the wrong reason before this was checked.
- **A check that reads a side effect must follow the build.** In JSX the
  producing `.map()` often sits *inside* the `return`, so a guard placed
  before it reads an array that has not been filled yet.
- **The test may be the bug.** If the implementation matches the spec and the
  test still fails, re-derive the test's expected contract from the spec
  before touching code.
- **Verify helper assumptions.** Read the helper; don't trust its name or the
  plan's claim about it (`compileFigure` does not parse figures).
- **Re-derive harness inputs from the code.** A smoke script that guessed an
  export name (`demoIr` vs `dataIr`) or a document shape (`blocks` vs
  `sections`) reported "zero figures" — a property of the harness, not the
  library. Check what the entry point actually accepts before believing a null
  result.
- **Verify a failure reproduces before explaining it away.** Repeated synthetic
  keydowns failing after the first one looked exactly like a CDP harness
  artifact; it was a real focus bug in the page. When a test result is
  inconvenient, suspect the product before the tool.
- **`dangerouslySetInnerHTML` hides nodes from React.** React's synthetic
  events (including `onFocusCapture`) do not fire for injected markup. Use
  native listeners for anything inside such a subtree.
- **A selector that matches nothing fails silently.** Verify a CSS selector
  against real served output (`grep` the class in the HTML you actually serve),
  not against the component you pictured. A theme token declared on `.exp` must
  be consumed by a rule on `.exp`, not on a narrower descendant that some other
  page happens not to use.
- **Negative assertions pass vacuously on inputs that throw first.** "output
  does not contain X" is satisfied by a crash. Prove a security or escaping test
  bites by running it against a deliberately broken stub, and include at least
  one input that *parses* so an assertion actually executes.
- **A `$…$` scanner without a plausibility gate silently corrupts prose.**
  The symptom is invisible: "It costs $5 and returns $10" renders with a
  typeset formula where a price should be, the output looks deliberate, and
  **zero warnings fire** — because prose is valid TeX (a run of letters is a
  run of variables), so the `not TeX` degradation cannot catch it. When
  scanning prose for a delimiter that also occurs in ordinary text, measure
  the collision before designing the scanner, and gate toward false negatives:
  a rejected candidate should be byte-identical to the pre-scanner output.
- **An engine's error TYPE is part of its contract.** Narrowing a catch to
  `ParseError` and rethrowing "the rest" is only safe if everything else is a
  real bug. Probing temml found seven malformed-TeX shapes that throw a
  `TypeError` instead, and the narrow let them out of the render pass. Enumerate
  what the engine actually throws before relying on its class hierarchy.
- **Scope an assertion to where the danger lives.** "The output does not contain
  `javascript:`" is wrong when the payload legitimately survives as escaped
  *text*. Assert against real attributes and real tags, never the raw string —
  the raw string contains exactly the residue that is safe.
- **Three screenshots the same size are one screenshot.** Rendering "variants"
  of a layout and eyeballing the PNGs is not a comparison. Check the bytes (or
  the measured geometry) before showing anything: a variant whose injected CSS
  computes to `margin-left: 0px` produces a file identical to the original, and
  three of those read as "here are three designs". Measuring the element after
  injecting found the real answer in one line where the images said nothing.
- **A backlog item nobody reported is a hypothesis, not a task.** Before
  building one, check that someone actually saw the problem, and measure the
  element rather than rendering a picture of it.

## Part 2 — Entries

### 2026-10-07 — `getBBox()` ignores the element's own transform
- **Symptom:** the figure-measurement probe reported two diagram edge labels as OUTSIDE-CANVAS at negative coordinates — while the served SVG had them correctly placed at `translate(400,24.5)` inside the scene. One false alarm burned a diagnosis round.
- **Root cause:** `SVGGraphicsElement.getBBox()` returns the box in the element's LOCAL user space — before the element's own `transform` maps it into the parent. A `<text transform="translate(x,y)">` whose tspans sit around the origin reports a bbox around the origin. Meanwhile a REAL defect was hiding behind the false one: the same probe's text-vs-text overlaps used local coords too, so the true collision (edge label on a node label) was invisible until the probe was fixed.
- **Fix:** map each text's SCREEN rect through `svg.getScreenCTM().inverse()` (corner points via `DOMPoint.matrixTransform`) so every measurement lands in true scene coordinates, transforms included.
- **Rule:** never trust `getBBox()` for scene-space geometry on transformed elements — either map through the inverse CTM or strip transforms in a fixture. And when a measurement reports two problems where the user reported one, suspect the probe before believing the bonus bug.

### 2026-10-07 — A prompt contract that never said what a block looks like
- **Symptom:** the first real-LLM compile run produced two near-empty pages while reporting a *clean* run: section validation passed every section (0 repairs, 0 dropped, `valid: true`), and `renderDocument` then dropped 52 and 88 of ~60–90 blocks as `[invalid-block] missing "type"`. The `[checks]` audit added a misleading second symptom: "declared a check but placed no quiz" on sections whose quiz was present but keyed `kind`.
- **Root cause:** no prompt surface states the block discriminator. `sectionSystemPrompt`, `systemPromptSnippet` and `documentSystemPromptSnippet` all show `Shape: { ... "blocks": Block[] }` and a payload-only list (`- heading: { text }`) — the string `"type"` occurred **zero times** in any of them, while `kind` primed the wrong guess inside chart/figure/diagram payload lines. The model guessed, and produced **three envelopes in one document**: `{ "kind": ... }` (16), `{ "heading": { ... } }` (36), `{ "type": ... }` (8). Three layers hid it: (1) the demo's stub replays hand-written JSON that uses `type` correctly, so orchestration tests prove nothing about the contract; (2) `documentSectionSchema.blocks` is `z.array(z.unknown())` by design, so the repair loop structurally cannot observe block-level violations; (3) the registry tests pinned types with bare-name `toContain("text")`, which passes vacuously on unrelated prose. A second gap in the same family surfaced in the same run: `- text:` / `- code:` were appended only to `systemPromptSnippet`, so the compiler never taught the paragraph block — the model invented type `description` and wrote a 90-block document with zero paragraphs.
- **Fix:** one line at the head of `BLOCK_TYPE_DOCS` stating the envelope (`{ "type": "heading", ... }`, payload beside it, *never nested*) — the one string all three prompt surfaces embed verbatim — and the `- text:` / `- code:` lines moved into it. Registry pins upgraded from bare substrings to the `- <type>:` doc line; `tests/block-discriminator.test.ts` pins all four surfaces. TDD: watched 8 assertions fail first. Re-run: **156/156 blocks valid, 0 render warnings, 0 compile warnings.**
- **Rule:** a contract a model must *guess* is broken even when every test is green — a stub replaying correct JSON validates the orchestration, never the contract. **Run prompts against a real model before trusting them** (this experiment costs ~90 seconds and pennies). Pin discriminating strings (`- text:`, `{ "type":`), never bare substrings. And when a pipeline reports a perfectly clean run whose output is visibly garbage, read the raw model reply before believing the validation — "valid" only ever means "passed the schema you wrote", and this schema deliberately passes blocks through.

### 2026-10-07 — `launchctl submit` re-ran a one-shot script after every clean exit
- **Symptom:** a scratch experiment submitted once ran **three times**; each relaunch truncated the shared log (`>`) mid-run, so the surviving log belonged to whichever run wrote last, while output files were a mix of runs. No second `submit` was ever issued.
- **Root cause:** the submitted job stayed registered after exiting, and launchd started it again after each clean exit — one `launchctl submit`, three process starts about 90–120 seconds apart. The `>` redirect made every relaunch destructive to the previous run's log.
- **Fix:** `launchctl remove explanations-real-compile` immediately after the run, verified with `launchctl list` and `ps` before trusting anything on disk. The duplicate runs were harmless here (identical inputs, same model) and the mixed artifacts were caught by timestamps plus a log that restarted at `[0s]`.
- **Rule:** one-shot work under `launchctl submit` must remove its own job **as part of the run**, not after inspection — the job re-executes. If a log suddenly starts at `[0s]` again while you are still reading it, you are reading a different run. For repeated experiments, `node --env-file=... script` in a plain SYNC call is enough — this one only needed launchd because a misjudged multi-minute runtime was feared; it actually finishes in ~90 seconds.

### 2026-10-05 — A stability claim answered by probe, and a probe that named a type that does not exist
- **Symptom:** asked whether the library was stable enough to build other apps on, and the obvious way to answer — read the schemas, reason about what an added field would do — produced no usable answer at all. Separately, the first probe run reported that `paragraph` was an unknown block type, which reads as a bug in the library.
- **Root cause, two independent things.** (1) *Stability is not a property you can read off a schema*; it is a property of the composed path (strip-then-render-then-warn-then-throw), and each stage is individually unremarkable. The interesting result was the opposite of the intuition: unknown **fields** are stripped silently and survive even `failOnWarning`, while an unknown **type** produces a warning — which `failOnWarning` converts into an exception, so **adding a block type is breaking**. Nobody would have predicted the asymmetry from the code. (2) `paragraph` simply is not a block type; the probe invented it, and the library correctly reported an unknown type. The library was right and the probe was wrong — the failure was trusting a plausible-sounding name.
- **Fix:** measured six cases against the built `dist/` (added field ± `failOnWarning` ± `strict`, new type ± `failOnWarning`, `version: 2` ± `failOnWarning`) instead of asserting from reading. Results became the README's `## Compatibility` table and are pinned by `tests/compat.test.ts`, so the next change cannot silently alter them. Recorded as open threads 19 and 20. Before concluding the probe was wrong, checked the registry — `blockTypes.ts` lists 20 types and `paragraph` is not among them.
- **Rule:** for a compatibility or stability claim, **run the probe against the built artifact** and vary one option at a time; a hand-built "future IR" that includes a type the registry has never heard of will report *two* unknowns, and the invented one hides the real one. Check every name in a probe against `blockTypes.ts` first — an unknown-type warning is evidence about the probe as well as the input. And when a probe surprises you, verify the probe before you file it as a defect.

### 2026-10-05 — A regression gate that would have failed for the wrong reason
- **Symptom:** the image-`body` spec made "the corpus diff must be byte-identical" its load-bearing check, on the reasoning that a `body`-less block must render exactly as before. Running it produced a large diff across the `demoDocIr` fixture — and every hunk was an *intended* change.
- **Root cause:** `.superpowers/render-fixtures.mjs` calls `renderDocument(ir)` with **no options**, so the corpus has no `images` catalog and every image block in the demo *degrades*. The gate was therefore comparing two things that both moved: the build **and** the fixtures. Two fixture changes were in play (bodies added to the image blocks, plus a second demo image), and the diff said nothing about whether the renderer had changed.
- **Fix:** hold the fixtures constant and vary only the build — `git show main:demo/examples.js` over the new `dist`, diffed against the baseline. That came out **byte-identical**, which is the actual invariant: for every pre-existing input, the new renderer emits the same bytes. The demo diff was then confirmed separately to be confined to the three image figures in one section, with the warnings count moving 5 → 6 for exactly one added block.
- **Rule:** a diff gate is only evidence for the claim it isolates. When one side of the comparison is also being edited, the gate measures the sum. **Vary one variable.** Also worth noting from the same run: the corpus render *is* the degradation path for images, which makes it a free end-to-end check that a miss still warns — 5 → 6 warnings with all three image warnings intact.
- **The rule did not take on first reading.** The very next cycle (the `heading` block) ran the same broken comparison and got a difference that looked like a regression: the "baseline" file left by the image cycle had been rendered with `c497a75` fixtures, while the new run used `fc728cc` fixtures, so the image-body demo prose surfaced as a diff. `c497a75` and `fc728cc` differ only by two docs commits, which is exactly why it looked safe. Fixed by building the pre-change commit in a throwaway `git worktree` and rendering **both builds against the same fixtures** — then byte-identical. **Practical form: when the baseline is a file left by an earlier cycle, check which fixtures it was rendered with before believing it. When unsure, build both sides from git.**

### 2026-10-05 — A backlog item nobody had ever seen, kept alive by being written down
- **Symptom:** asked what a long-standing ROADMAP item ("display-mode centering for a formula on its own paragraph") actually involved, and found it could not be explained without guessing — because it was one line written while surveying gaps after Temml replaced a hand-rolled subset, never discussed, never seen on a page.
- **Root cause:** the item was a note-to-self promoted into the backlog by the act of recording it. Nobody had reported it, and nothing in the demo disliked it. Attempts to illustrate it made this worse: three "variant" screenshots came out **byte-identical**, because the injected `margin: 0 auto` computed to `0px` and the element never moved.
- **Fix:** measured instead of screenshotting — the formula is 43px inside a 702px step, and a step's formula and note share a left edge at 92px by design. There is no display-mode path in this library, so there was nothing to centre. Item dropped, with the measurement recorded so it is not re-added from memory.
- **Rule:** a backlog item that nobody has reported is a hypothesis, not a task. Before building one, check whether anyone actually saw the problem — and measure the element rather than rendering a picture of it. **Compare the bytes**: three identical PNGs looked like three designs and would have been presented as evidence.

### 2026-10-05 — A correct-looking fix that reported nothing, because children render after parents read
- **Symptom:** three React surfaces reported no degradations at all, so `failOnWarning` did not throw for a quiz containing an unparseable formula — the output was byte-identical with and without a sink, so nothing observable had changed. Threading the parent's `warnings` array into `Quiz` as a prop compiled, type-checked, and **still** reported nothing; `Quiz` given an array directly reported perfectly.
- **Root cause:** a child component's side effects land after the parent's body has finished. Minimal repro: a parent that reads a shared array during its own render and renders a child that pushes to it reports `[]`, while the array holds `["from-child"]` after the render completes. The array was correct; the timing was not. This is also why `Document` never had the bug — it calls `renderBlock`/`renderInline` directly and never delegates.
- **Fix:** a synchronous pre-pass in the parent's own body, keeping the warnings and discarding the HTML. An effect was considered and rejected: effects do not run under `renderToStaticMarkup`, so reporting from one would have stopped `onWarning` firing under SSR entirely.
- **Rule:** when a parent collects diagnostics during render, **collect them by calling the renderer itself, not by delegating to a child.** And before believing "the fix did not work," reproduce the child's behaviour in isolation — if it works alone and not through the parent, the problem is the render boundary, not the child. Three of my four wrong conclusions this session came from probes that were wrong rather than code that was; the tell in every case was a measurement of zero.

### 2026-10-05 — A scripted `.focus()` reported a working keyboard path as dead
- **Symptom:** the element popover opened on hover but never on focus. `document.activeElement` was the node and its `tabindex` was `0`, yet no popover and no element event — twice, on two independently written probes.
- **Root cause:** the probes were at fault, not the product. Programmatic `.focus()` fires **no** `focusin` on an injected SVG element — confirmed with a *native* listener on the stage div, which recorded zero events — so `onFocusCapture` had nothing to receive. A dispatched Tab keypress reached the node, fired `focusin`, and opened the popover. A second, separate probe error compounded it: it cleared state between cases with `popover.remove()`, which rips a React-managed node out of the tree, so React patched the detached node and nothing appeared even on the working path.
- **Fix:** probe with `Input.dispatchKeyEvent` Tab presses, and reload between cases instead of removing nodes. Both are recorded in Part 1.
- **Rule:** a probe that reports "the accessibility path is broken" is making a claim about the *product* from a measurement of the *harness*. Before believing it, instrument with a native listener and confirm the event exists at all — if the native listener sees nothing, the harness is the thing that is wrong. Two of my three conclusions this session were wrong for exactly this reason, and in both cases I had a working story that explained the symptom without checking it.

### 2026-10-04 — A `$…$` scanner that rendered prices as formulas

**Symptom.** None, at first. The point of adding inline math is that formulas
appear inside sentences, so nothing looks broken. The defect only becomes
visible when someone reads the prose closely — and it is worst in the one
place it is least expected.

**Root cause.** `$` occurs literally in prose: currency, shell variables, regex
anchors. Feeding the naive capture to temml shows why this is the worst
available failure rather than an ugly one:

| prose | naive capture | temml |
|---|---|---|
| `It costs $5 and returns $10.` | ` and returns` | four `<mi>`, **zero warnings** |
| `Set $HOME and $PATH` | `OME and` | four `<mi>`, zero warnings |
| `Revenue was $5M, up from $4M.` | `M, up from` | three `<mi>`, zero warnings |

Zero warnings is the load-bearing part. `mathOrLiteral` degrades on
`MathParseError`, and open thread 2 already records that prose is *valid* TeX
— so the existing degradation structurally cannot catch this class, and neither
can any test asserting on warnings.

**Fix.** Two delimiters with different rules. `\(…\)` is honored
unconditionally, because backslash-paren does not occur in prose. `$…$` must
clear Pandoc's two delimiter rules plus a plausibility check. Both arms of that
check are needed, and dropping either reintroduces a different bug:

- strong signals only (`\ ^ _ { } = < >`) rejects `f(x)`;
- a tight whitespace-free expression alone accepts `5-` out of
  `costs $5-$3`, because `-` looks like an operator — requiring a letter is
  what separates symbolic expressions from arithmetic accidents.

A candidate failing any gate is left as literal text, byte-identical to the
pre-math output, which makes a false negative the status quo rather than a
degradation. Verified before implementing: 27/27 hand-built cases, and 0 of the
410 strings in the demo/README/ROADMAP corpus change.

**Rule.** Before shipping a scanner for a delimiter that also occurs in
ordinary text, run the real corpus through it and look at what it captures.
Gate toward false negatives. And put a literal-`$` sentence next to a math
sentence in the demo fixture, so the gate is visible on the page and not only
in a test that already agrees with it.

### 2026-10-04 — A `ParseError`-only catch let malformed TeX crash the render

**Symptom.** `renderExplanation` threw
`TypeError: Cannot read properties of null (reading 'type')` and returned
nothing, for a `derivation` step of `x^`. No degradation, no warning, no
partial output — the whole explanation was gone.

**Root cause.** `mathOrLiteral` caught `MathParseError` and rethrew everything
else, on the assumption that anything else was a bug in our code rather than in
the input. temml's parser disagrees: a dangling super/subscript dereferences a
null group. Seven shapes do it — `x^`, `x_`, `^`, `_`, `x^{^{^}}`, `x^&`,
`x_^{\` — and none of them is a `ParseError`.

**Fix.** Catch every failure and degrade, with the error's constructor name in
the warning so a genuinely novel failure stays visible under `failOnWarning`
instead of being silently swallowed. The same narrow existed in the new inline
boundary, where it would have been reachable from ambient prose.

**Rule.** An engine's error *type* is part of its contract. Enumerate what it
actually throws before narrowing a catch to one class and rethrowing "the
rest" — the rethrow is only safe if everything else is a bug in your code.

### 2026-10-04 — A figure scaled UP because it had no intrinsic size
- **Symptom:** the top-down demo diagram rendered at **26px labels filling 1753px of vertical space**, next to 16px body text. A figure far *too big*, the mirror of the "figures scale down, they don't overflow" entry above.
- **Root cause:** `.exp-figure` was `width: 100%; height: auto` on an `<svg>` that carried only a `viewBox`. With no intrinsic size, "fill the column" is the only sizing the browser has — so it stretched a 333×865 figure up 2.03×. Every warning in the playbook was about the *downward* direction, so the upward one read as a layout bug rather than a sizing-model bug.
- **Fix:** emit `width`/`height` alongside `viewBox`, and change the rule to `max-width: 100%; height: auto`. Scaling now responds to overflow only. Measured across `/`, `/document` and `/interactive`: narrow figures 1.00× at 13px, wide ones 0.87–0.94× (unchanged), **0 figures overflowing**.
- **Rule:** three lessons. (1) **A CSS cap is not a fix when `width:100%` sets the box.** All four caps tried (`max-height`, `+object-fit`, shrink-to-fit, and combinations) letterboxed the content down to 7.8px labels — worse than the 26px problem. The box has to be allowed to shrink first. (2) **Measure the scale, don't reason about it.** `box.width / viewBox.width` and `getScreenCTM().a` answered in one line what four CSS theories could not; on `lr` the same arithmetic is the "825px legibility budget" check, so it is the same tool pointed the other way. (3) **Check the emit layer before the layout when a figure is the wrong SIZE.** Wrong geometry and wrong scale look identical on the page and have opposite fixes.
- **Also worth recording:** making the demo exposed that `tb` had never been exercised (every fixture pinned `lr`) and carried two real bugs — see the sibling-spacing and scene-width entries. A demo request turned into a bug hunt, which is the point of adding demos at all.

### 2026-10-04 — A cycle inflated the ranks, and a clamp then desynced the arrows from the nodes
- **Symptom:** on `/`, the pipeline diagram's arrows pointed at the **top** of their nodes instead of the middle, and the figure was so small the text was barely legible. Reported as two separate problems; one cause.
- **Root cause:** the diagram contains a feedback loop (`reval → cache`). Layering used capped relaxation, which cannot terminate on a cycle — that 5-node graph reached layer 16, leaving 13 *empty* ranks that still consumed column gutters, so the scene came out 1556px wide and `viewBox` scaling shrank it to 0.49×. The same inversion put `cache` right of `origin`, giving their edge a gutter of **−538**, which clamped to 8 and wrapped `"miss / stale"` into `["miss","/","stal","e"]`. Four lines made that label block hang 21px above the origin, so the scene clamp shifted node boxes down — but `ArrowEl.d`/`head` were already serialized path strings and were never translated with them. Nodes moved, arrows stayed, and every arrow floated 21px above its centre.
- **Fix:** break cycles for ranking with DFS back-edge classification (relax over the acyclic remainder, which terminates by construction), draw back edges as return paths around the outside, and resolve the clamp on **node placement** before serializing any path. A cubic's true extremum is `y0 + 0.75·(ly − y0)`, not its control line, so the scene is sized from the sampled depth.
- **Rule:** two lessons, both about ordering. (1) A relaxation loop over model-authored input must not be made to terminate by a pass cap — a cap hides non-termination instead of fixing it, and the old comment claimed cyclic layers "stabilized" when they did not. Break the cycle explicitly. (2) When a layout pass has to move geometry, it must move **all** of it, and the safest moment is before serialization. A clamp that adjusts the fields it remembers and silently skips the ones already written to strings will desync, and the symptom points at the wrong thing entirely (it looks like an alignment bug, not a state bug). **Corollary on the diagnosis:** the visible symptom and the actual cause were two and a half steps apart. Print the *scene* dimensions next to the rendered ones — 1556 vs 748 — before theorising about CSS.
- **Also worth recording:** three of my own tests in this cycle passed against the *pre-fix* code for the wrong reason — I asserted distinct `x` per node when same-rank nodes legitimately share one, and I bounded curves by their control points, which is the very bug being fixed. Both were caught by running the new suite against the baseline worktree. Eight of the ten bite; the two that do not are deliberate guards.

### 2026-10-04 — A duplicated predicate that silently diverged from its original
- **Symptom:** the degradation-policy cycle shipped, all 534 tests green, and `<Document>` still reported **zero** warnings for a non-object IR where `renderDocument` reported three. Dropped-section warnings were missing from the React side entirely.
- **Root cause:** to give React the same warnings as the string renderer, I copied `renderDocument`'s document-level checks into `Document.tsx` — and wrote the guard as `if (rec !== null)` where the original tests `!rec ||` on *every* condition. The copy was correct for the happy path and wrong for the broken one, which is exactly the path warnings exist to describe.
- **Fix:** extracted `documentDiagnostics()` and `sectionOk()` into `renderDocument.ts` and pointed both renderers at them, mirroring how `renderSalvagedBlock` is already shared for block rendering. Six parity cases pin the agreement, including the non-object IR.
- **Rule:** never reimplement a sibling renderer's decision logic in a component — extract the shared helper instead. This codebase already established the pattern (`renderSalvagedBlock`, `collectAnchors`); a hand-copy is a fork that will drift. **Corollary that bit three times in one cycle:** a fixture that is *more* broken than intended produces a *different* warning than expected and the test passes for the wrong reason — `series: []` yielded `[invalid-block]` not `[dataset]`, `stack` children live under `blocks` not `children`, and an explanation IR without `version` degrades with `[wrong-version]`. Probe a fixture's actual warning before asserting on it.

### 2026-10-04 — A side-effecting map evaluated after the check that reads its output
- **Symptom:** `failOnWarning` on `<Explanation>` and `<Document>` never threw. The option was threaded correctly and every test that targeted it passed.
- **Root cause:** `renderBlock` populates the warnings array as a side effect of the block `.map()`, and both components ran the policy check *before* the `return` containing that map. The array was always empty at the check, so the guard was correct code reading a value that did not exist yet.
- **Fix:** build the block list into a `const body = …` first, then run the policy check, then return the JSX containing `body`.
- **Rule:** if a value is produced as a side effect of building output, the check that reads it must come after the build, not adjacent to it. JSX makes this trap easy to hit, because the "build" is syntactically inside the return. When hoisting, move the *whole* map — a partial hoist reintroduces the same bug one level down.

### 2026-10-03 — A security test that passed because every case threw
- **Symptom:** the math boundary's injection test was green, and it would have stayed green against a boundary that did nothing at all. The loop over hostile TeX (`\href`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlId`, `\def`-abuse) wrapped each case in `try { render } catch { continue }` and then asserted no `<a href>` / `<img src>` / no `onerror` — but Temml *throws* on every one of those constructs, so each iteration hit `continue` and no assertion ever executed.
- **Root cause:** the assertions were written in the negative ("output does not contain X") and the hostile inputs were stronger than the output. A throw satisfies every negative assertion trivially. Three deliberate stub boundaries (passthrough, `throwOnError: false`, wrapped-unsanitized) were then run against the test: all three passed it. The only assertion that separates them is the *positive* one — that the boundary rejects.
- **Fix:** assert `expect(() => renderMath(tex)).toThrow(MathParseError)` for each hostile construct, and add `INJECTION_TEX` — payload that **parses** (`\text{<script>…}`, a bare `&`, an unpaired `_`) — so there is at least one case where the boundary must actually return a string and the escaping is exercised. Note that `\text{<script>}` legitimately produces `&lt;script&gt;`, so substring assertions like "no onerror" are wrong for escaped text; assert on tag- and attribute-shaped output instead.
- **Rule:** a negative assertion passes vacuously whenever the input fails earlier than the output. Prove a security test bites by running it against a deliberately broken stub (passthrough, then a wrapped-but-unsanitized one) — a test that cannot fail is not a test. The same shape bites assertions about "no X in output" generally: check that each case reaches the assertion.

### 2026-10-04 — Correct CSS on markup that never carried the class
- **Symptom:** the mind-map's nested-list form rendered as a flat, unmarked
  stack. No indent, no left rule, no dot markers on second-level items — while
  the unit tests, the themes coverage gate and the `## Block types` docs were
  all green.
- **Root cause:** the stylesheet was right and the *markup* was wrong.
  `listHtml` put `class="exp-mind-map-list"` on the outermost `<ul>` only, so
  the two rules that express nesting — `.exp-mind-map-list .exp-mind-map-list`
  (indent + left rule) and `.exp-mind-map-list > li` (the dot marker) — matched
  nothing below the first level. The list still nested *structurally*, so every
  structural assertion passed. Only the paint was wrong, which is the worst
  kind of wrong: it looks like a deliberate design choice.
- **Why no test caught it.** All four CSS tests asserted that a *rule exists in
  the stylesheet*. None asserted that the *markup carries the class the rule
  selects on*. Those are different claims, and only the second one is about
  whether the feature works. The existing 2026-10-03 entry is the mirror image
  (rule written, class absent from the page); this one is class written,
  markup missing it.
- **Fix:** every level emits the class, plus a test asserting each `<ul>` in the
  output carries it and that none is bare. A Chrome probe that injects the real
  markup and reads back `getComputedStyle` confirmed it — `innerMarginLeft: 8px`,
  `innerBorderLeft: 1px`, dot `6px` in the accent colour.
- **Rule:** a stylesheet test proves the CSS parses, never that it applies. For
  anything expressed through a class, assert the class is *in the emitted
  markup* as well — and when the structure is recursive, assert it at every
  level, because the outermost element is the one that always looks right.

### 2026-10-03 — A CSS rule that matched nothing, and a spec claim that was simply false
- **Symptom:** after the math size bump, nothing on `/math` changed size, and the user saw no difference at all. Separately, a test asserting that `renderDocument(ir, { strict: true })` throws on a `[math]` degradation warning could not be made to pass.
- **Root cause, two independent bugs.** (1) The rule was scoped `.exp-derivation-expr math`, but on `/math` the `<math>` sits in a bare `<td class="exp">` — zero occurrences of that class on the page, so the selector matched nothing. The token lives on `.exp`, so the rule consuming it belongs on `.exp`. (2) The `strict` claim was inferred from reading two different functions, each of which checks a warnings array: `renderDocument`'s validation gate (populated *before* any block renders) and `renderMath`'s degradation (which happens *during* rendering). A render-time warning can never appear in the array the gate checks, in either entry point. The spec was wrong; the implementation was right.
- **Fix:** `.exp math { … }`, verified by grepping the served HTML for the class and by reading the value back out of `dist/`. Spec §7 and the plan's task were corrected, and the corrected claim became open thread 1.
- **Rule:** a CSS selector that matches nothing fails silently and forever — verify the selector against real served output, not against the component you imagined. And when a spec states a cross-component behaviour, check that the two components actually share state; two same-named locals are not the same thing. Prefer writing the test first: if the spec's claim cannot be made to fail, the spec is the suspect, not the code.

### 2026-10-02 — innerHTML subtree swaps destroy keyboard focus
- **Symptom:** the drag-to-vary handle moved one step per arrow key, then lost focus to `<body>`; every subsequent keypress went nowhere. Focus survives the first press and is gone by the second.
- **Root cause:** the Scene compiler emits markup, not React elements, so the SVG is injected via `dangerouslySetInnerHTML`. Every parameter edit re-solves the scene, React replaces that subtree, and the focused `.exp-el` is destroyed. Two wrong turns on the way: reading `document.activeElement` in `onBlurCapture` yields `<body>` because the swap has already happened, and **React's `onFocusCapture` never fires at all** for innerHTML-injected nodes — React never wired them into its synthetic event system. Native `focusin`/`focusout` on the host div are required.
- **Fix:** `FocusPreservingSvg` records the focused element's `data-el-id` on native `focusin` and re-focuses the element carrying the same id after each commit. Pre-existing for tip handles; drag merely made it obvious.
- **Rule:** markup injected via `innerHTML`/`dangerouslySetInnerHTML` is invisible to React's synthetic events — attach native listeners for anything inside it. And when re-rendering a focused subtree, focus is part of the state you must restore; a control that works exactly once is not accessible.

### 2026-10-02 — An interactive control that worked but felt inverted
- **Symptom:** the drag-to-vary demo rendered, the suite was green, and a real pointer drag moved the handle — in the wrong direction. Dragging left 64px slid the weight right.
- **Root cause:** the figure mapped position as `rest - stretch`, a self-consistent negation. Every unit test passed because the geometry was internally correct; only the *direction of causality* was wrong. An inverted mapping is indistinguishable from a correct one when the only assertions are "the value changed" and "the shape matches".
- **Fix:** position became the param itself (`bx = stretch`), so a drag maps to cursor movement 1:1. Verified by driving a real drag through Chrome DevTools Protocol and reading the handle rect and slider value back out of the DOM.
- **Rule:** assert the SIGN of an interaction, not just that it changed. For a drag, the test is "drag +N ⇒ element moves +N", which an inverted mapping fails immediately. Self-consistent geometry is not evidence of a working control; when the assertion could pass with the sign flipped, it is too weak.

### 2026-10-02 — Timeline labels overlapped; the figure was the wrong answer
- **Symptom:** timeline event labels were placed at even offsets and never measured, so a long `what` overlapped its same-side neighbour (124px of shortfall per pair at 8 events) and the end labels were clipped by the viewBox. The demo's 3 short events fit by accident.
- **Root cause:** `layoutTimeline` spaced events with `step = (width - PAD*2) / n` and centred each label on its tick, never comparing the label to the space it occupied. Two failed fixes followed, both because I treated "make it fit" as the only axis: capping the step at 320px and *dropping* over-long labels produced a 2,472px figure, and wrapping produced 4-line shreds that tripped the line cap and dropped the label anyway — all while the suite stayed green, because the spacing assertions pass vacuously when labels are absent.
- **Fix:** the auto presentation rule now *measures* (`timelineFigureFits`) and degrades to the existing text list when the scene would exceed ~825px — the width at which `width: 100%` scaling shrinks the 11px labels below ~8px. `layoutTimeline` itself never drops a label; an explicit `presentation` is always honoured. Also fixed: `renderTimeline` discarded `layoutTimeline`'s `warnings`, so a host could not see a degrade.
- **Rule:** when a figure can't hold its content legibly, degrading to the *other* rendering of the same block beats distorting the figure — and the degrade must be visible (`ctx.addWarning`), never a silent omission. Measure before predicting: my "3 × 40-char labels don't fit" claim was wrong (712px, ~9px, genuinely fine), and my "no dead space" fix was wrong until a byte-diff against `main` caught 107px of empty spine. Compare rendered output against `main` in a worktree; eyeballing arithmetic is not verification.

### 2026-10-02 — Figure labels overlapped whatever they were centred in
- **Symptom:** reported with screenshots from `/editorial`: a diagram edge label was eclipsed by the node boxes beside it; chart value labels collided with their neighbours and the last one clipped past the SVG edge.
- **Root cause:** two layouts placed label text at fixed coordinates without ever measuring it. `layoutFlow` centred `labelX` on a fixed 64px gutter — a 231px label overhung ~90px each side, and nodes (emitted after edges, with an opaque fill) painted over it. `layoutChart.fmtValue` concatenated the unit onto every value (`0.62relative intensity`) and placed labels with no check against the band or the scene bounds. Only node labels were ever measured, via `wrapLabel` ("pre-wrapped lines (layout-owned)").
- **Fix:** wrap edge labels to the gutter they are routed through, widening that gutter to fit the label up to a 140px cap — wrapping *to the gutter* is what makes the overlap structurally impossible, so no collision pass is needed. Print the chart unit once on its own row above the plot, and omit any value label wider than its mark's slot.
- **Rule:** every piece of text a layout emits must be measured against the space it will occupy, and the layout — not the CSS — owns fitting it. If a label can be positioned but never sized, it is a bug waiting for longer content. Watch for the same shape in TOC entries and axis ticks. Two follow-ups: a fixed-width gutter *fixed the overlap but read as damaged text* ("back-scatt" / "ered"), so a wrap target should be wide enough to break on word boundaries; and the tests asserting `">240ms</text>"` were pinning the defect, not a contract — re-derive them from the spec rather than bending the fix to match.

### 2026-10-01 — SAST flagged the whole output pipeline; four rule groups, one real action
- **Symptom:** `rafter run` on the sources-block cycle reported 35 findings: "XSS" in the demo server, `dangerouslySetInnerHTML` ×13, "unsafe regex" ×2.
- **Root cause:** the scanner inferred flows, not paths: demo responses are static constants (no `req.*` in any body); React sinks are fed exclusively by the library's escape-then-render pipeline (the library *is* the sanitizer — that's the architecture, per the link-inline security walk); the flagged regexes are linear-shaped, but `highlightCode` did run an unbounded attacker-controlled string.
- **Fix:** three false-positive verdicts with traced dataflow (recorded, not suppressed); one real hardening — `code` payload capped at 20k in the schema + render-time truncation warning, closing the ReDoS-input class regardless of regex internals.
- **Rule:** triage SAST output by tracing input→sink in *this* codebase — scanners flag families, not exploits; but treat "unbounded input to a regex pass" as a real finding even when the regex itself is safe.
- **Corollary (suppression mechanics):** the remote scanner applies `.rafter.yml` from the *pushed* repo, not the working tree; rule ids must be the canonical identifiers from the scan JSON (`rafter get <id> --format json` → `vulnerabilities[].rule_id`) — the markdown report's short `R-xxxx` hashes and truncated dotted names don't match. List both id forms; verify with a fresh scan's JSON, not the report header.

### 2026-10-01 — Emphasis markup leaked into link hrefs
- **Symptom:** GREEN run failed one test — `[x](https://e.com/a*b*c)` rendered as `<a href="https://e.com/a<em>b</em>c">x</a>`: a paired `*…*` inside the URL was emphasized *before* the link pass matched, so the href candidate carried `<em>` into the attribute.
- **Root cause:** two passes over the same escaped string (emphasis, then links) — ordering prevents markup pairing *into* an already-emitted href, but not markup *inside a future* href. The link pass sees post-emphasis text, so its "literal fallback" is also post-emphasis (original stars unrecoverable at that layer).
- **Fix:** the href gate rejects any candidate containing a raw `<` — only the library's own emphasis markup can produce one (real `<` arrives escaped as `&lt;`) — degrading the link instead of emitting a corrupted attribute.
- **Rule:** when consecutive passes transform overlapping text, test their interaction (paired markers spanning a boundary), not just each pass in isolation; a structural tell like "only our own pass emits `<`" is a cheap, complete guard.

### 2026-10-01 — Popover pinned past the left edge on narrow stages
- **Symptom:** unit RED — expected `4`, got `-64`, for a 200px-wide stage.
- **Root cause:** `placePopover` clamped `min(max(left, stage.left+4), stage.right-MAX_W-4)`; when the stage is narrower than the popover the clamp interval degenerates and the negative upper bound wins.
- **Fix:** clamp the lower bound last — `max(min(left, hi), lo)`. Provably identical output whenever `lo < hi`.
- **Rule:** every clamp gets a narrow/extreme-case test; the two clamp orderings differ exactly on degenerate intervals.

### 2026-10-01 — Host `dataset` key silently ignored
- **Symptom:** dataset tests RED with literal fields rendered and *no warnings*.
- **Root cause:** non-strict zod object schemas strip unknown keys — `dataset` wasn't declared on the block schemas, so salvage discarded it before render ever saw it.
- **Fix:** declared `dataset?: string` on `chart`/`data-callout`/`timeline` schemas; the resolver then worked unchanged.
- **Rule:** extend schema surfaces before tests can observe new fields; a silently-stripped key mimics "renderer bug".

### 2026-10-01 — Override test asserted the wrong survivor
- **Symptom:** one dataset test failed against a spec-correct implementation (`"kept"` not in HTML).
- **Root cause:** the fixture's dataset *defined* `label`, so the literal label had to be overridden; the real surviving literal was `delta` (omitted by the dataset).
- **Fix:** corrected the test to assert the actual contract — overridden label, surviving delta.
- **Rule:** when code matches the spec, the test is the suspect; re-derive expectations from the spec, not from what the fixture happens to contain.

### 2026-10-01 — `renderDocument` missed in an option pass-through
- **Symptom:** RED was 4/4 where the plan predicted 3/4 (the `renderDocument` test was expected to pass already).
- **Root cause:** the plan threaded `datasets` through `renderExplanation`/`renderBlock` but omitted `renderDocument.ts` from Task 1's file list.
- **Fix:** threaded it; plan and ledger amended.
- **Rule:** enumerate call sites of shared helpers by grep when threading an option through an entry-point family; a *wider*-than-predicted RED is information, not noise.

### 2026-10-01 — Demo smoke grep matched a non-rendering value
- **Symptom:** `grep -c "deploys-true"` on the served page returned 0 while the page demonstrably worked.
- **Root cause:** block `id`s never appear in rendered HTML; the grep targeted an IR field name, not output.
- **Fix:** grep the dataset-derived value (`4deploys`) instead.
- **Rule:** smoke assertions target what the renderer *emits* — check the HTML, not the IR.

### 2026-09-30 — Param named `PI`/`E`/`TAU` silently shadowed
- **Symptom:** a param or derived binding with a reserved constant name behaves as the constant.
- **Root cause:** the expression evaluator resolves its constants (`PI`, `E`, `TAU`) before the param/derived environment.
- **Fix:** schemas reject those names outright; prompts document them.
- **Rule:** reserved-name collisions between two namespaces get schema-level rejection, not documentation alone.

### 2026-09-29 — Plan assumed `compileFigure` parses
- **Symptom:** identity-gate tests failed against the planned compile-side placement.
- **Root cause:** the plan assumed `compileFigure` parses figures; it doesn't — parsing happens at render/emit — so the gate had to live compile-side.
- **Fix:** gate moved to where the data actually flows; deviation recorded.
- **Rule:** verify what a helper actually does before writing tests against an assumption; helper names mislead.

### 2026-09-29 — `/interactive` served 200 but blank in browser
- **Symptom:** route 200; console full of module-resolution errors.
- **Root cause:** `dist/react` imports `roughjs`/`zod`; the demo importmap didn't map them, breaking the browser module graph.
- **Fix:** importmap entries added; later demo pages copy the full set.
- **Rule:** a demo importmap must cover every bare specifier reachable from the served bundle — and a 200 says nothing about a module graph.

### 2026-09-28 — SVG path grammar edge cases
- **Symptom:** plan's path-grammar tests failed on valid inputs before implementation.
- **Root cause:** plan bugs — lowercase commands are valid SVG, and arc flags are positional with no separators (`a1 1 0 011 1` is legal).
- **Fix:** grammar implemented to the SVG spec; plan corrected pre-implementation.
- **Rule:** when hand-rolling a grammar, generate tests from the *spec's* grammar definition, not from intuition — the weird corners are where the bugs hide.

### 2026-09-27 — Prototype-pollution surface in the primitive registry
- **Symptom:** security review flagged `registry["constructor"]`-style lookups.
- **Root cause:** default-prototype objects inherit `constructor`/`__proto__`/`toString`; a type string from LLM output could hit inherited values.
- **Fix:** `Object.create(null)` registry; same pattern applied to the datasets resolver's `Object.hasOwn` guard.
- **Rule:** records keyed by external strings get a null prototype plus own-property checks — make it the default, not a retrofit.

### 2026-09-27 — tsup build exited 0 with a broken artifact
- **Symptom:** dist entry missing/wrong after a green build (entry collision, side-effect elision, missing `@types/node`).
- **Root cause:** bundler optimizations and entry naming collided in ways the build step doesn't check.
- **Fix:** `sideEffects` field, entry resolution, type deps — and a dist-exports verification step added to plan tasks.
- **Rule:** verify the built artifact's *exports* after touching entries/config; a green build is not a correct build.

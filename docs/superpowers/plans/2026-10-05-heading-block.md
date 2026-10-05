# Plan — the `heading` block

Spec: `docs/superpowers/specs/2026-10-05-heading-block-design.md`

Baseline: `fc728cc`, 819 tests / 62 files, `tsc --noEmit` clean.

**Atomicity constraint, from the README rule and `tests/llm.test.ts`:** a new
block type cannot be split across commits. Schema, `Block` union,
`blockUnionSchema`, `BLOCK_TYPE_DOCS`, `registerAll.ts`, the README block list,
and the README's `N primitives` count all land **together**, or the suite goes
red. Task 1 is therefore indivisible and must end green.

**Corpus gate, settled in the image-body cycle:** hold the fixtures constant
and vary only the build. `.superpowers/render-fixtures.mjs` passes no options,
so a whole-corpus diff moves on *any* fixture that gains a heading. That is not
a regression — read the diff, don't diff the total.

---

### Task 1 — Schema, primitive, contract, registration (atomic)

**Files:** `src/core/schema.ts`, `src/primitives/heading.ts` (new),
`src/core/blockTypes.ts`, `src/core/registerAll.ts`, `src/index.ts`,
`tests/heading.test.ts` (new), `tests/block-union-types.test.ts`,
`README.md`.

- [ ] Write the failing tests first (spec §6, schema + render rows).
- [ ] Confirm RED.
- [ ] `headingBlockSchema` after `textBlockSchema`; add `HeadingBlock` to the
      `Block` union and `headingBlockSchema` to `blockUnionSchema`.
- [ ] `src/primitives/heading.ts` — `renderHeading`, registered as `"heading"`.
      `id="h-${escapeHtml(id)}"` **only when `block.id` is truthy**; no empty
      `id=""`.
- [ ] The `BLOCK_TYPE_DOCS` line from spec §4.4.
- [ ] Register in `registerAll.ts`; export the schema + type from `index.ts`.
- [ ] README: add `heading` to the `## Block types` list **and** bump the
      primitive count 19 → 20, in this same commit.
- [ ] `npx vitest run tests/heading.test.ts tests/llm.test.ts tests/readme.test.ts`
      → PASS. `tests/readme.test.ts` is the one that will bite if the count is
      missed; `tests/llm.test.ts` if the contract line is.

### Task 2 — Theme and fixture

**Files:** `src/themes/tokens.css`, `tests/fixtures.ts`, `tests/themes.test.ts`.

- [ ] Add a heading to `tests/fixtures.ts` — this is what makes the
      class-coverage gate see `.exp-heading`.
- [ ] `npx vitest run tests/themes.test.ts` → **RED** on `exp-heading`. Confirm
      that is the reason.
- [ ] Add the `.exp-heading` rule from spec §4.3.
- [ ] `npx vitest run tests/themes.test.ts` → PASS.
- [ ] Add a case pinning `font-size: 1.15em`, so a future edit cannot quietly
      desynchronise the heading from `.exp-title` at the same outline level.

### Task 3 — Demo

**Files:** `demo/examples.js`.

- [ ] Put a heading or two in the document demo so `/document` shows the outline
      filling in: h1 → h2 (section) → **h3** → h4 (figure title).
- [ ] Give one of them an `id` so the `h-` anchor is visible in the DOM, and
      leave another without so both paths are exercised on screen.
- [ ] `npm run build`, relaunch the server, verify 6/6 routes 200 from a
      separate tool call.

### Task 4 — Full gate

```bash
npx vitest run && npx tsc --noEmit && npm run build
```

### Task 5 — Corpus diff, correctly scoped

```bash
cp demo/examples.js /tmp/ex-head.js
git show fc728cc:demo/examples.js > demo/examples.js
node .superpowers/render-fixtures.mjs dist /tmp/ws-head-oldfix.txt
cp /tmp/ex-head.js demo/examples.js
diff /tmp/ws-before.txt /tmp/ws-head-oldfix.txt && echo IDENTICAL
```

Expected: **byte-identical.** The new primitive must not move a single byte of
any pre-existing input — with no fixture carrying a heading, it is unreachable.

Then render with the new fixtures and confirm by inspection that the only
differences are the added heading elements.

### Task 6 — Docs, then the merge gate

- [ ] `docs/ROADMAP.md`: Shipped entry for the block, and update the Luma thread
      — the heading gap there is now closed, so it must not keep reading as
      open.
- [ ] `docs/OPEN_THREADS.md`: only if a judgement call worth keeping emerged.
- [ ] Fresh-eyes review against the spec, then present and stop.

## Branch finish — MERGE GATE

Verify on the **merged** result, not the branch. Append the "Branch finished"
line to `.superpowers/sdd/progress.md` as part of the finish. Keep the branch
until the merge is approved.
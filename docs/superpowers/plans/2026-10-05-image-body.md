# Plan — image `body`

Spec: `docs/superpowers/specs/2026-10-05-image-body-design.md`

Baseline: `c497a75`, 805 tests / 62 files, `tsc --noEmit` clean.

**The one invariant that governs task order:** a document with no `body` must
render byte-identically to `main`. Tasks 1–3 are additive only; the corpus diff
in Task 7 is the check that proves it, and a unit-level twin of it lands in
Task 2 so a regression fails fast rather than at the end.

---

### Task 1 — Schema and the shared contract

**Files:** `src/core/schema.ts` (`imageBlockSchema`), `src/core/blockTypes.ts`.

- [ ] Add `body: z.string().min(1).max(1200).optional()` to `imageBlockSchema`
      after `caption`, with a comment naming this spec.
- [ ] Update the `- image:` line in `BLOCK_TYPE_DOCS` to `{ image, caption?, body? }`
      plus one clause on when to reach for `body`.
- [ ] Append (do not reword) one clause to the catalog menu's editorial line in
      `src/compiler/prompts.ts:15` saying the explanation of a picture belongs
      in `body`. The two existing substring pins must survive verbatim.
- [ ] `npx vitest run tests/llm.test.ts tests/image-compiler.test.ts`
      → PASS. The byte-identical no-catalog prompt pins are the ones to watch;
      if they moved, the menu clause was added in the wrong place.

### Task 2 — Render, including the no-`body` twin of the corpus check

**Files:** `src/primitives/image.ts`, `tests/image.test.ts`.

- [ ] Write the failing tests first (spec §7 Render + Degradation + Security).
      Include one `toBe`-level assertion that a `body`-less block renders
      today's exact markup — that is the unit-level corpus pin.
- [ ] Confirm RED.
- [ ] Rewrite `renderImage` to emit `exp-image-body` + `.exp-image-prose` only
      when `body` is present, keeping the existing branch byte-for-byte
      otherwise. On a miss with a `body`, emit prose + caption and **omit**
      `exp-image-missing` (spec §3.6).
- [ ] `npx vitest run tests/image.test.ts` → PASS.

### Task 3 — Theme

**Files:** `src/themes/tokens.css`, `tests/fixtures.ts`.

- [ ] Add `body: "A **host** image with prose beside it."` to the image fixture
      in `tests/fixtures.ts` — this is what makes `themes.test.ts` see the new
      classes.
- [ ] `npx vitest run tests/themes.test.ts` → **RED** on
      `exp-image-body` / `exp-image-prose`. Confirm it fails for that reason.
- [ ] Add the flex rules from spec §4.3 to `tokens.css` after `.exp-image-missing`.
- [ ] `npx vitest run tests/themes.test.ts` → PASS.
- [ ] Add a `themes.test.ts` case pinning `flex-wrap: wrap` on `.exp-image-body`,
      the same way the TOC and math cases pin their rules.

### Task 4 — Docs, in the same commit as the code

**Files:** `README.md`, `docs/ROADMAP.md`, `docs/OPEN_THREADS.md`.

- [ ] README `### Images`: document `body`, the two-column layout, and that a
      missed image leaves the prose readable.
- [ ] README: the note telling hosts to withhold a block until its image exists,
      so a mid-flight render does not trip `failOnWarning`.
- [ ] README: extend the existing upgrade note — the `BLOCK_TYPE_DOCS` change is
      a system-prompt diff for every host.
- [ ] ROADMAP: strike shape (c) `analogy` **with the measurement** from spec §1,
      matching how the math-centering item was dropped.
- [ ] OPEN_THREADS thread 5: add the generated-image case, and record that the
      schema deliberately does not change.

### Task 5 — Demo

**Files:** `demo/examples.js`, `demo/server.mjs`.

- [ ] Add a second self-hosted SVG asset so the "series of images" case is
      visible, not just one lonely example.
- [ ] Give both image blocks in the `fig-images` section a `body`.
- [ ] `npm run build && launchctl remove explanations-demo; launchctl submit -l
      explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"`
- [ ] From a **separate** tool call:
      `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/document`
      → 200, and the other five routes.
- [ ] Look at `/document` and judge the 42/58 split by eye. This is the
      human check the spec's risk 2 says is missing; record the verdict in the
      commit message.

### Task 6 — Full gate

```bash
npx vitest run && npx tsc --noEmit && npm run build
```

Expected: all green (805 baseline + new), typecheck clean, build green.

### Task 7 — Corpus diff (the load-bearing check)

```bash
node .superpowers/render-fixtures.mjs dist /tmp/ws-after.txt
diff /tmp/ws-before.txt /tmp/ws-after.txt && echo IDENTICAL
```

Expected: **byte-identical.** Any difference means a `body`-less block moved,
which is a regression regardless of what the suite says.

### Task 8 — Commit, then present at the merge gate

Per `AGENTS.md`: README and ROADMAP travel with the code in the same commit.
Then stop and present — demo URL, what to look at, diff stat — and merge only
on explicit go-ahead. Append the "Branch finished" line to
`.superpowers/sdd/progress.md` as part of the finish, not after.
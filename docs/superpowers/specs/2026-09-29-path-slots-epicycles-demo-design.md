# Path Expression Slots + Fourier Epicycles Showcase

Date: 2026-09-29
Status: Approved (brainstorming 2026-09-29)
Follows: 2026-09-28-bespoke-figures-design.md (shipped)

## Problem

The bespoke `figure` block lets an LLM author parametrized drawings, but path
`d` strings are literal: every coordinate inside a path is fixed, so parametric
outline shapes — waveforms, sampled functions, outlines traced from params —
cannot be authored. The demo's only bespoke figure is a single ellipse; the
upper limit of the format (derived chains, groups, every numeric field as an
expression) is not on display anywhere.

## Goal

Two changes, neither breaking:

1. **Engine: expression slots in path `d`.** The `path` element's `d` accepts
   `{{expr}}` slots; each slot is evaluated against params/derived and the
   expanded string must still pass the existing `isSafePathD` grammar.
2. **Demo: one maximal figure.** A Fourier epicycles drawing of a square wave,
   added beside the orbit ellipse in `figuresIr`, exercising params, derived
   chains, arcs, dots, curves, path slots, groups, and labels at once.

## Non-Goals (YAGNI)

- Expressions inside `box`/`dot`/etc. labels (text stays text).
- Expression slots anywhere except `path.d` (other string fields stay literal).
- Interactive runtime, animation, new element kinds, new tones.
- Raising MAX_ELEMENTS, MAX_LEN, or any other existing limit.

## Design

### 1. Path slots (`src/figures/authored.ts`)

- Syntax: `{{ expr }}` — double curly braces, optional inner whitespace,
  expression length after trim ≤ 80 chars (same cap as `parseNum`).
- Compile-time expansion in the `path` case of `compileEl`: split `d` on
  slot syntax, evaluate each slot against the same env, splice numbers via
  the existing `nf()` formatter, then validate the **expanded** string with
  the existing `isSafePathD` as today. The grammar remains the final gate;
  no new syntax ever reaches SVG unvalidated.
- Salvage (element dropped with a warning, rest of scene renders):
  - unparseable/unresolvable slot expression → drop
  - slot count > 64 → drop
  - expanded string fails `isSafePathD` (grammar or 4096 MAX_LEN after
    expansion) → drop
- `{` and `}` were never legal path-grammar characters, so every `d` that
  contains slots was previously rejected and now renders; every plain `d`
  behaves exactly as before. Backward compatible by construction.
- No changes to `pathGrammar.ts`, `expr.ts`, `svg.ts`, `sketch.ts`, schema,
  or system prompt beyond the guidance note below.

### 2. Fourier epicycles figure (demo)

One `figure` block appended to `figuresIr` in `demo/examples.js`, beside the
existing orbit figure (nothing replaced). Contents:

- params: `t` (phase angle, degrees) and `r` (base radius). Both are live:
  `t` rotates the whole epicycle stack, `r` scales it. (A harmonic-count
  param is impossible here — slot expressions cannot loop, so the waveform
  is a fixed sum of the first four odd harmonics 1·3·5·7 regardless.)
- derived chain: rim point of circle k feeds the center of circle k+1 —
  `a1 = t·PI/180`, rim offsets via `cos`/`sin` scaled by per-harmonic radii
  `r, r/3, r/5, r/7`, so the sum drives both the epicycle dots and the
  waveform samples.
- elements: arcs for each epicycle circle, dots on each rim, a tracing line
  from the outermost rim to the wave, a `path` with ~16 sampled points whose
  slot expressions sum the odd harmonics, grouped labels annotating radii.
- rendered in both the plain and sketch sections of the demo like the other
  figures, kept schema-valid by `tests/demo-examples.test.ts`.

### 3. Authoring guidance (`src/core/llm.ts`)

`systemPromptSnippet` gains two sentences: slot syntax with one inline
example, and when to prefer slots (sampled parametric outlines) over plain
path data.

## Testing (TDD)

- `tests/figures/authored.test.ts` — slot expansion table: happy path, nested
  braces, unparseable slot, too many slots, expanded-`d` grammar rejection,
  MAX_LEN overflow after expansion, plain `d` unchanged, salvage isolation.
- `tests/figure.test.ts` — `figure` block with slotted paths renders; bad
  slots drop the element and the rest renders (salvage path).
- `tests/demo-examples.test.ts` — `figuresIr` epicycles figure schema-valid.
- Existing suites green: `tests/figures/path-grammar.test.ts`,
  `tests/figures/svg.test.ts`, `tests/figures/sketch.test.ts`,
  `tests/presentation.test.ts`.

## Roadmap Position

Demo-gallery polish from the roadmap backlog, plus a small format extension
that stays inside the locked decisions (Scene IR + grammar validation, no LLM
text becomes markup — expansion output is grammar-gated).

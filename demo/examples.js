// Demo IR fixtures — exactly what an LLM would emit. Kept schema-valid by
// tests/demo-examples.test.ts (except capabilitiesIr, whose unknown/invalid
// blocks are intentional). Plain ESM so the server (node) can import them.

// Retrieval-practice demo (quiz spec §8): one authored quiz with
// misconception-targeting whys; rendered statically on /document and graded
// interactively on /interactive.
const quizBlock = {
  type: "quiz",
  id: "quiz-frequency",
  question: "A signal repeats 50 times per second. Which view shows that **directly**?",
  options: [
    { text: "A time-series plot", why: "The waveform wiggles 50 times a second, but counting those wiggles is work." },
    { text: "A **Fourier** view", why: "Correct — energy per frequency, and 50 Hz stands out as a single peak." },
    { text: "A histogram of sample values", why: "Bins amplitudes; the 50-per-second rhythm disappears." },
    { text: "A moving average", why: "Smooths the time series; it can't reveal frequency." },
  ],
  answer: 1,
  explanation: "The Fourier view is the frequency lens this document keeps reaching for.",
}

export const quizIr = {
  version: 1,
  title: "Retrieval practice",
  blocks: [quizBlock],
}

export const educationIr = {
  version: 1,
  title: "Why does dividing by a fraction multiply?",
  summary: "A classic confusion, resolved with a picture you can hold in your head.",
  blocks: [
    { type: "text", body: "Division asks a **counting** question: *how many of these fit in that?* The surprise is what happens when `these` is smaller than one. See [fraction division, visually](https://mathworld.wolfram.com/Fraction.html) for more." },
    {
      type: "step-list",
      steps: [
        { title: "Reframe the question", detail: "`8 ÷ 1/4` asks: how many quarters make a whole?" },
        { title: "Count in a concrete case", detail: "A pizza cut in quarters has 4 pieces, so one pizza holds `4` quarters." },
        { title: "Scale to the numerator", detail: "`3 ÷ 1/4` is three pizzas of quarters — 12 of them." },
      ],
    },
    {
      type: "stack",
      blocks: [
        {
          type: "concept",
          term: "Dividing by a fraction",
          definition: "Asking how many of that fraction fit into the whole.",
          intuition: "If a half-cup fills the jug, the jug holds two half-cups.",
          analogy: "Like counting pizza slices — smaller slices mean more of them.",
        },
        {
          type: "worked-example",
          problem: "How many 1/2-cup servings are in 3 cups?",
          steps: [
            { title: "One serving is 1/2 cup", detail: "So each cup holds `2` servings." },
            { title: "3 cups means 3 × 2 servings", detail: "Count the half-cups: six of them." },
          ],
          result: "3 ÷ 1/2 = 6 servings",
        },
        {
          type: "derivation",
          steps: [
            { expression: "3 ÷ (1/2)", note: "Split the division." },
            { expression: "3 × 2", note: "Dividing by 1/2 is multiplying by 2." },
            { expression: "= 6", note: "Six half-cups fit in three cups." },
          ],
          conclusion: "3 ÷ (1/2) = 3 × 2 = 6",
        },
        {
          type: "callout",
          variant: "tip",
          body: "The **smaller** the piece you divide by, the *more* of it fits — that's why the number grows.",
        },
      ],
    },
  ],
}

export const dataIr = {
  version: 1,
  title: "Why did activation spike?",
  summary: "Activations tripled in the week of Sep 14 — here is the breakdown.",
  blocks: [
    {
      type: "data-callout",
      metric: "3,412",
      label: "Activations",
      delta: "+212%",
      trend: "up",
      context: "Week of Sep 14 vs prior week",
    },
    {
      type: "data-callout",
      metric: "1.9 days",
      label: "Time to activate",
      delta: "-0.8 days",
      trend: "down",
      context: "Faster onboarding shipped Sep 12",
    },
    {
      type: "data-callout",
      metric: "38%",
      label: "Sales-led share",
      delta: "+0.1%",
      trend: "flat",
      context: "Mix unchanged — growth came from self-serve",
    },
    {
      type: "comparison",
      items: [{ name: "Self-serve" }, { name: "Sales-led" }],
      dimensions: [
        { name: "Activations", values: ["2,980", "432"] },
        { name: "Median time to activate", values: ["1.2 days", "6.4 days"] },
        { name: "Top driver", values: ["New onboarding", "Quarter-end push"] },
      ],
    },
    {
      type: "cause-effect",
      chain: [
        {
          because: "The 3-step onboarding shipped Sep 12",
          therefore: "More signups reach the aha moment before dropping off.",
        },
        {
          because: "Quarter-end pushed sales-led outreach",
          therefore: "A secondary bump from demo requests.",
        },
      ],
    },
    {
      type: "timeline",
      events: [
        { when: "Sep 12", what: "Onboarding redesign ships", detail: "Activation steps cut from 7 to 3." },
        { when: "Sep 14", what: "Week-over-week activations triple", detail: "Self-serve segment leads." },
        { when: "Sep 18", what: "Retention holds at day 7", detail: "Confirms quality, not just volume." },
      ],
    },
    {
      // Same block type, opposite outcome. These milestone names are long
      // enough that drawing them would shrink the labels past legibility (the
      // SVG has a viewBox and no width, so a wide figure scales DOWN rather
      // than overflowing), so `presentation: auto` renders the text list
      // instead — which also surfaces each `detail`. The block above is the
      // figure form; together they show the boundary.
      type: "timeline",
      events: [
        {
          when: "Q3 2023",
          what: "Discovery interviews surface the activation drop-off",
          detail: "Eleven of fourteen testers stalled before the second step.",
        },
        {
          when: "Q4 2023",
          what: "The instrumentation lands and the funnel is finally visible",
          detail: "No team had measured step two before this point.",
        },
        {
          when: "Q1 2024",
          what: "A working prototype of the three-step flow is tested",
          detail: "First run where testers reached the aha moment unprompted.",
        },
        {
          when: "Q2 2024",
          what: "Cross-functional team forms to own the activation funnel",
          detail: "Growth, design and engineering, with a shared metric.",
        },
      ],
    },
    {
      type: "callout",
      variant: "warning",
      body: "The spike overlaps a `pricing-page` experiment — part of the lift may not be onboarding-related. Latency context: [the latency study](#source-latency-numbers).",
    },
    {
      type: "sources",
      id: "refs",
      title: "Sources",
      items: [
        { id: "latency-numbers", title: "Frontend latency study", url: "https://web.dev/articles/vitals", detail: "Where the p95 thresholds come from." },
        { id: "deploy-log", title: "Deploy log, week 38", detail: "Internal — the deploy-day spike is visible in the raw log." },
      ],
    },
  ],
}

// Not schema-valid on purpose: demonstrates lenient rendering. The unknown
// block renders as a styled fallback; the invalid block is skipped with a
// warning (visible in the server console, not the page).
export const capabilitiesIr = {
  version: 1,
  title: "What an imperfect LLM response looks like",
  summary: "The library degrades gracefully: fallbacks instead of crashes.",
  blocks: [
    { type: "text", body: "Below, the model invented a `gauge` block type the library doesn't know, and forgot the body of a text block. Neither breaks the page." },
    { type: "gauge", title: "Weekly activations", series: [3, 4, 12] },
    { type: "text" },
    { type: "callout", variant: "note", body: "Known types around it render normally — and `note` is the third callout variant." },
  ],
}

// Drawing-layer showcase — every figure rendered from semantic specs only.
export const figuresIr = {
  version: 1,
  title: "How a slow deploy gets rolled back",
  summary: "Diagrams and charts straight from the model — no coordinates anywhere.",
  blocks: [
    {
      type: "diagram",
      nodes: [
        { id: "dep", label: "Deploy ships", shape: "pill", tip: "Every incident review starts here" },
        { id: "lat", label: "p95 latency spikes", tip: "p95 — the number the SLO watches" },
        { id: "err", label: "Error rate climbs", shape: "note" },
        { id: "alert", label: "Alert fires", shape: "round" },
        { id: "rb", label: "Canary rollback", shape: "round", tip: "Automated canary revert" },
      ],
      edges: [
        { from: "dep", to: "lat", kind: "causes" },
        { from: "lat", to: "err", kind: "causes" },
        { from: "err", to: "alert", kind: "leads" },
        { from: "dep", to: "rb", label: "canary only" },
        { from: "dep", to: "err", label: "risk", kind: "conflict" },
      ],
      direction: "lr",
    },
    {
      type: "chart",
      kind: "bar",
      points: [
        { label: "Mon", value: 120 },
        { label: "Tue", value: 118 },
        { label: "Wed", value: 240, tip: "Deploy day — 2× the weekly median" },
        { label: "Thu", value: 95 },
        { label: "Fri", value: 90 },
      ],
      unit: "ms",
      caption: "p95 latency by day",
    },
    {
      type: "figure",
      title: "Orbit anatomy",
      caption: "A bespoke drawn figure — every number is an expression over rx and ry.",
      params: [
        { name: "rx", min: 40, max: 140, step: 5, initial: 120 },
        { name: "ry", min: 20, max: 90, step: 5, initial: 70 },
      ],
      derived: [
        { name: "cx", expr: "180" },
        { name: "cy", expr: "120" },
      ],
      elements: [
        { kind: "arc", cx: "cx", cy: "cy", rx: "rx", ry: "ry", start: 0, end: 180, tone: "accent", width: 2 },
        { kind: "arc", cx: "cx", cy: "cy", rx: "rx", ry: "ry", start: 180, end: 360, tone: "accent", width: 2 },
        { kind: "line", x1: "cx - rx - 10", y1: "cy", x2: "cx + rx + 10", y2: "cy", tone: "muted" },
        { kind: "line", x1: "cx", y1: "cy - ry - 10", x2: "cx", y2: "cy + ry + 10", tone: "muted" },
        { kind: "dot", cx: "cx + rx * cos(PI / 4)", cy: "cy - ry * sin(PI / 4)", tone: "ink" },
        { kind: "label", x: "cx + rx * cos(PI / 4) + 8", y: "cy - ry * sin(PI / 4) - 6", text: "θ = 45°", anchor: "start" },
        { kind: "label", x: 12, y: 20, text: "rx × ry ellipse", anchor: "start" },
      ],
    },
    // The upper limit of the format: every number is an expression over two
    // params, the circle stack is one expression-offset group, and the wave
    // is 16 sampled points written as path slots summing the odd harmonics.
    {
      type: "figure",
      title: "Fourier epicycles",
      caption:
        "Three circles spinning at 1×, 3× and 5× speed sum to a square wave — the pen dot traces it on the right.",
      width: 720,
      height: 260,
      sweep: "t",
      params: [
        { name: "t", min: 0, max: 360, step: 5, initial: 45 },
        { name: "r", min: 20, max: 60, step: 5, initial: 40 },
      ],
      derived: [
        { name: "a", expr: "t * PI / 180" },
        { name: "cx", expr: "150" },
        { name: "cy", expr: "130" },
        { name: "px", expr: "cx + r * (1.2732 * cos(a) + 0.4244 * cos(3 * a) + 0.2546 * cos(5 * a))" },
        { name: "py", expr: "cy - r * (1.2732 * sin(a) + 0.4244 * sin(3 * a) + 0.2546 * sin(5 * a))" },
      ],
      elements: [
        { kind: "line", x1: 300, y1: "cy", x2: 700, y2: "cy", tone: "muted", width: 1 },
        {
          kind: "group",
          dx: "cx",
          dy: "cy",
          elements: [
            { kind: "line", x1: "-r * 1.5", y1: 0, x2: "r * 1.5", y2: 0, tone: "muted", width: 1 },
            { kind: "line", x1: 0, y1: "-r * 1.5", x2: 0, y2: "r * 1.5", tone: "muted", width: 1 },
            { kind: "arc", cx: 0, cy: 0, rx: "r * 1.2732", ry: "r * 1.2732", start: 0, end: 180, tone: "accent" },
            { kind: "arc", cx: 0, cy: 0, rx: "r * 1.2732", ry: "r * 1.2732", start: 180, end: 360, tone: "accent" },
            {
              kind: "arc",
              cx: "r * 1.2732 * cos(a)",
              cy: "-r * 1.2732 * sin(a)",
              rx: "r * 0.4244",
              ry: "r * 0.4244",
              start: 0,
              end: 180,
              tone: "accent",
            },
            {
              kind: "arc",
              cx: "r * 1.2732 * cos(a)",
              cy: "-r * 1.2732 * sin(a)",
              rx: "r * 0.4244",
              ry: "r * 0.4244",
              start: 180,
              end: 360,
              tone: "accent",
            },
            {
              kind: "arc",
              cx: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              cy: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              rx: "r * 0.2546",
              ry: "r * 0.2546",
              start: 0,
              end: 180,
              tone: "accent",
            },
            {
              kind: "arc",
              cx: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              cy: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              rx: "r * 0.2546",
              ry: "r * 0.2546",
              start: 180,
              end: 360,
              tone: "accent",
            },
            { kind: "line", x1: 0, y1: 0, x2: "r * 1.2732 * cos(a)", y2: "-r * 1.2732 * sin(a)", tone: "muted", width: 1 },
            {
              kind: "line",
              x1: "r * 1.2732 * cos(a)",
              y1: "-r * 1.2732 * sin(a)",
              x2: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              y2: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              tone: "muted",
              width: 1,
            },
            {
              kind: "line",
              x1: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              y1: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              x2: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a) + 0.2546 * cos(5 * a))",
              y2: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a) + 0.2546 * sin(5 * a))",
              tone: "muted",
              width: 1,
            },
            { kind: "dot", cx: "r * 1.2732 * cos(a)", cy: "-r * 1.2732 * sin(a)", r: 2, tone: "ink", id: "epi-1" },
            {
              kind: "dot",
              cx: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              cy: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              r: 2,
              tone: "ink",
              id: "epi-2",
            },
            {
              kind: "dot",
              cx: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a) + 0.2546 * cos(5 * a))",
              cy: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a) + 0.2546 * sin(5 * a))",
              r: 3,
              tone: "ink",
              id: "pen",
              tip: "Sum of the three circular motions — traced right as the square wave",
            },
          ],
        },
        { kind: "line", x1: "px", y1: "py", x2: 320, y2: "py", tone: "accent", width: 1 },
        {
          kind: "path",
          tone: "ink",
          width: 2,
          d: "M 320 {{cy - r * (1.2732 * sin(a) + 0.4244 * sin(3*a) + 0.2546 * sin(5*a))}} L 344 {{cy - r * (1.2732 * sin(a-0.4) + 0.4244 * sin(3*a-1.2) + 0.2546 * sin(5*a-2))}} L 368 {{cy - r * (1.2732 * sin(a-0.8) + 0.4244 * sin(3*a-2.4) + 0.2546 * sin(5*a-4))}} L 392 {{cy - r * (1.2732 * sin(a-1.2) + 0.4244 * sin(3*a-3.6) + 0.2546 * sin(5*a-6))}} L 416 {{cy - r * (1.2732 * sin(a-1.6) + 0.4244 * sin(3*a-4.8) + 0.2546 * sin(5*a-8))}} L 440 {{cy - r * (1.2732 * sin(a-2) + 0.4244 * sin(3*a-6) + 0.2546 * sin(5*a-10))}} L 464 {{cy - r * (1.2732 * sin(a-2.4) + 0.4244 * sin(3*a-7.2) + 0.2546 * sin(5*a-12))}} L 488 {{cy - r * (1.2732 * sin(a-2.8) + 0.4244 * sin(3*a-8.4) + 0.2546 * sin(5*a-14))}} L 512 {{cy - r * (1.2732 * sin(a-3.2) + 0.4244 * sin(3*a-9.6) + 0.2546 * sin(5*a-16))}} L 536 {{cy - r * (1.2732 * sin(a-3.6) + 0.4244 * sin(3*a-10.8) + 0.2546 * sin(5*a-18))}} L 560 {{cy - r * (1.2732 * sin(a-4) + 0.4244 * sin(3*a-12) + 0.2546 * sin(5*a-20))}} L 584 {{cy - r * (1.2732 * sin(a-4.4) + 0.4244 * sin(3*a-13.2) + 0.2546 * sin(5*a-22))}} L 608 {{cy - r * (1.2732 * sin(a-4.8) + 0.4244 * sin(3*a-14.4) + 0.2546 * sin(5*a-24))}} L 632 {{cy - r * (1.2732 * sin(a-5.2) + 0.4244 * sin(3*a-15.6) + 0.2546 * sin(5*a-26))}} L 656 {{cy - r * (1.2732 * sin(a-5.6) + 0.4244 * sin(3*a-16.8) + 0.2546 * sin(5*a-28))}} L 680 {{cy - r * (1.2732 * sin(a-6) + 0.4244 * sin(3*a-18) + 0.2546 * sin(5*a-30))}}",
        },
        { kind: "label", x: 12, y: 20, text: "Square wave = sum of odd harmonics (1×, 3×, 5×)", size: 11 },
        { kind: "label", x: "cx", y: "cy + r * 1.5 + 16", text: "three circles, one pen", anchor: "middle", size: 10 },
        { kind: "label", x: 320, y: 20, text: "pen height, sampled rightward", size: 10 },
      ],
    },
    {
      type: "cause-effect",
      presentation: "figure",
      chain: [
        { because: "Cache warmed at boot", therefore: "First requests stay fast." },
        { because: "Circuit breaker opens", therefore: "Retries back off instead of stampeding." },
      ],
    },
    {
      type: "callout",
      variant: "tip",
      body: "The renderer owns all geometry — the model only names nodes, edges, and values.",
    },
  ],
}

// Step-by-step how-to: numbered instructions paired with a pipeline diagram,
// a timing chart, and an outcome metric — a recipe-style explanation.
export const howToIr = {
  version: 1,
  title: "How to cut p95 latency with a stale-while-revalidate cache",
  summary: "Four steps: wrap the handler, warm the cache, set the TTL, watch the number.",
  blocks: [
    {
      type: "step-list",
      steps: [
        {
          title: "Wrap the slow handler",
          detail: "Decorate `getProfile` with a 60-second `stale-while-revalidate` window.",
        },
        {
          title: "Warm the cache at boot",
          detail: "Pre-fetch the top 100 profiles so the first users never hit the origin.",
        },
        {
          title: "Set the TTL per route",
          detail: "Hot routes get `ttl: 60s`; long-tail routes `ttl: 300s`.",
        },
        {
          title: "Watch the p95",
          detail: "Compare the week-over-week p95 before rolling out to all traffic.",
        },
      ],
    },
    {
      type: "code",
      language: "ts",
      code: "import { withSWR } from './cache'\n\nexport const getProfile = withSWR(getProfile, { ttlSeconds: 60 })",
    },
    {
      type: "diagram",
      nodes: [
        { id: "req", label: "Request", shape: "pill" },
        { id: "cache", label: "Cache lookup" },
        { id: "fresh", label: "Fresh return" },
        { id: "origin", label: "Origin fetch" },
        { id: "reval", label: "Background revalidate", shape: "note" },
      ],
      edges: [
        { from: "req", to: "cache", kind: "leads" },
        { from: "cache", to: "fresh", kind: "leads", label: "hit" },
        { from: "cache", to: "origin", kind: "leads", label: "miss / stale" },
        { from: "origin", to: "reval", kind: "leads" },
        { from: "reval", to: "cache", kind: "part-of" },
      ],
      direction: "lr",
    },
    {
      type: "chart",
      kind: "bar",
      points: [
        { label: "Before", value: 240 },
        { label: "Week 1", value: 140 },
        { label: "Week 2", value: 95 },
      ],
      unit: "ms",
      caption: "p95 latency after each rollout step",
    },
    {
      type: "data-callout",
      metric: "95ms",
      label: "p95 latency",
      delta: "-60%",
      trend: "down",
      series: [240, 210, 180, 140, 120, 95],
      context: "Week 2 after full rollout",
    },
    {
      type: "callout",
      variant: "warning",
      body: "Stale-while-revalidate serves *old* data for up to the TTL window — skip it on endpoints that must be exactly current (e.g. billing).",
    },
  ],
}

// Curio-style editorial page: the four existing explanations composed as one
// multi-section document. Schema-checked by tests/demo-examples.test.ts.
export const demoDocIr = {
  version: 1,
  title: "How signals become pictures",
  summary: "Six angles on one pipeline — the concept, the data, the drawing, the rollout, true numbers from the host, and a retrieval check.",
  sections: [
    { id: "fig-concept", title: "The concept", blocks: educationIr.blocks },
    { id: "fig-data", title: "What the data says", blocks: dataIr.blocks },
    { id: "fig-figures", title: "Drawing it", blocks: figuresIr.blocks },
    { id: "fig-epicycles", title: "Epicycles", blocks: howToIr.blocks },
    {
      id: "fig-real-data",
      title: "Real data",
      blocks: [
        { type: "text", body: "The same chart block twice: the first one carries a `dataset` key, so its numbers come from the host — not from the model. The second is the literal IR, model-guessed." },
        { type: "chart", id: "deploys-true", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "weekly-deploys" },
        { type: "chart", id: "deploys-guessed", kind: "bar", points: [{ label: "Mon", value: 120 }] },
        { type: "timeline", id: "milestones-true", events: [{ when: "someday", what: "model-guessed" }], dataset: "milestones" },
      ],
    },
    { id: "fig-quiz", title: "Retrieval practice", blocks: [quizBlock] },
  ],
}

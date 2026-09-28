// Demo IR fixtures — exactly what an LLM would emit. Kept schema-valid by
// tests/demo-examples.test.ts (except capabilitiesIr, whose unknown/invalid
// blocks are intentional). Plain ESM so the server (node) can import them.

export const educationIr = {
  version: 1,
  title: "Why does dividing by a fraction multiply?",
  summary: "A classic confusion, resolved with a picture you can hold in your head.",
  blocks: [
    { type: "text", body: "Division asks a **counting** question: *how many of these fit in that?* The surprise is what happens when `these` is smaller than one." },
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
      type: "callout",
      variant: "warning",
      body: "The spike overlaps a `pricing-page` experiment — part of the lift may not be onboarding-related.",
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

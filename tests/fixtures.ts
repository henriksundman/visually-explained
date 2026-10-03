export const allPrimitivesIr = {
  version: 1,
  title: "All primitives",
  summary: "One of each",
  blocks: [
    { type: "text", body: "Plain text" },
    {
      type: "step-list",
      steps: [{ title: "Step one", detail: "Detail" }, { title: "Step two" }],
    },
    { type: "worked-example", problem: "P", steps: [{ title: "S" }], result: "R" },
    { type: "derivation", steps: [{ expression: "x = 1", note: "n" }], conclusion: "y = 2" },
    { type: "concept", term: "T", definition: "D", intuition: "I", analogy: "A" },
    {
      type: "comparison",
      items: [{ name: "A" }, { name: "B" }],
      dimensions: [{ name: "Dim", values: ["1", "2"] }],
    },
    { type: "cause-effect", chain: [{ because: "B", therefore: "T" }] },
    { type: "data-callout", metric: "42%", label: "L", delta: "+1", trend: "up", context: "C" },
    { type: "timeline", events: [{ when: "1990", what: "W", detail: "D" }] },
    { type: "callout", variant: "note", body: "Body" },
    { type: "callout", variant: "tip", body: "Body" },
    { type: "callout", variant: "warning", body: "Body" },
    { type: "stack", blocks: [{ type: "stack", blocks: [{ type: "text", body: "Nested" }] }] },
    {
      type: "diagram",
      nodes: [
        { id: "a", label: "Input" },
        { id: "b", label: "Transform" },
        { id: "c", label: "Output" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    },
    { type: "chart", kind: "bar", points: [{ label: "A", value: 1 }, { label: "B", value: 2 }] },
    {
      type: "figure",
      title: "Damped oscillation",
      caption: "Authored scene: an expression-driven curve with a labeled marker.",
      params: [{ name: "k", min: 1, max: 5, step: 0.5, initial: 2 }],
      elements: [
        { kind: "path", d: "M 10 110 C 60 10 120 210 170 110", tone: "ink", width: 2 },
        { kind: "dot", cx: "10 + 40 * k", cy: 60 },
        { kind: "label", x: "10 + 40 * k", y: 50, text: "peak", anchor: "middle" },
      ],
    },
    { type: "image", id: "fixture-image", image: "fixture-platform", caption: "A **host** image." },
  ],
} as const

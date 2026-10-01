// Stub LlmClient for the /compile demo: proves the orchestration end-to-end
// with zero API keys. The "Reading the data" section deliberately fails
// validation once, then repairs — the loop is visible in the returned events.
function goodReadingSection() {
  return JSON.stringify({
    title: "Reading the data",
    blocks: [
      { type: "text", body: "The same weekly numbers, drawn:" },
      {
        type: "chart",
        kind: "bar",
        points: [
          { label: "Mon", value: 4 },
          { label: "Tue", value: 9 },
          { label: "Wed", value: 18 },
          { label: "Thu", value: 11 },
          { label: "Fri", value: 7 },
        ],
        unit: "deploys",
        caption: "Deploys per weekday — deploy day towers.",
      },
    ],
  })
}

/** paced=true delays every reply ~300-600ms so the streamed progression is
 *  visible in the browser; default unpaced for fast SSR/audit consumers. */
export function stubClient(paced = false) {
  let readingCalls = 0
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  return async ({ user }) => {
    if (paced) await wait(300 + Math.random() * 300)
    if (/Design the outline/.test(user)) {
      return JSON.stringify({
        version: 1,
        title: "How signals become pictures",
        summary: "Compiled live in your browser from a stub LLM.",
        sections: [
          { title: "The concept", goal: "Define signals and why pictures help.", visual: "diagram" },
          { title: "Reading the data", goal: "Show a small dataset as a chart.", visual: "chart" },
          { title: "Drawing it", goal: "Compose what we learned into one bespoke figure.", visual: "figure" },
        ],
      })
    }
    if (/Write section .*"The concept"/.test(user)) {
      return JSON.stringify({
        title: "The concept",
        blocks: [
          { type: "text", body: "A **signal** is any quantity that carries information — voltage, sound pressure, pixels." },
          {
            type: "diagram",
            nodes: [
              { id: "src", label: "Source", tip: "Where the signal originates" },
              { id: "ch", label: "Channel", tip: "Where noise creeps in" },
              { id: "sink", label: "Receiver", tip: "Where it is decoded" },
            ],
            edges: [
              { from: "src", to: "ch", kind: "leads" },
              { from: "ch", to: "sink", kind: "leads" },
            ],
          },
        ],
      })
    }
    if (/Write section .*"Reading the data"/.test(user)) {
      readingCalls++
      if (readingCalls === 1) {
        // Malformed on purpose: blocks is a string, not an array.
        return JSON.stringify({ title: "Reading the data", blocks: "oops" })
      }
      return goodReadingSection()
    }
    if (/failed validation/.test(user)) {
      // Repair re-ask: only "Reading the data" ever fails in this stub, so
      // the repair prompt always gets the corrected section back.
      return goodReadingSection()
    }
    if (/Write section .*"Drawing it"/.test(user)) {
      return JSON.stringify({
        title: "Drawing it",
        blocks: [
          { type: "text", body: "One bespoke figure, generated from parameters — the arc's height follows the slider." },
          {
            type: "figure",
            title: "A sine from circles",
            caption: "Half a sine arc — height driven by the amp slider.",
            params: [{ name: "amp", min: 10, max: 60, step: 1, initial: 40 }],
            sweep: "amp",
            elements: [
              { kind: "curve", from: { x: 20, y: "120 - amp" }, cp1: { x: 60, y: "120 - amp * 2" }, cp2: { x: 100, y: "120 + amp * 2" }, to: { x: 140, y: "120" } },
              { kind: "dot", cx: 20, cy: "120 - amp", r: 4 },
            ],
          },
        ],
      })
    }
    return "unexpected prompt"
  }
}

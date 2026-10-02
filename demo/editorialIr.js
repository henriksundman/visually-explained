// The article rendered at /editorial — a purpose-written document IR, shaped
// to exercise seven primitives in the order an editor would actually use them
// (concept → derivation → worked example → diagram → chart → quiz → sources).
//
// Every value here must satisfy documentSchema; the demo renderer degrades
// rather than throws, so an invalid block would silently render as a fallback.
// Source urls are example.com placeholders, per the existing demo fixtures.

export const editorialDocIr = {
  version: 1,
  title: "Why the sky is blue at noon and red at dusk",
  summary:
    "One mechanism — Rayleigh scattering — plus the changing length of a ray's path through the atmosphere, accounts for both.",
  sections: [
    {
      id: "short-answer",
      title: "The short answer",
      blocks: [
        {
          type: "text",
          body:
            "The familiar answer is that air scatters blue light more than red. That is true, and on its own it does not explain the sunset — because at sunset the sun is no brighter, and the sky is not darker.",
        },
        {
          type: "concept",
          term: "Rayleigh scattering",
          definition:
            "Scattering by particles much smaller than the wavelength of light, at an intensity proportional to the inverse fourth power of that wavelength.",
          intuition:
            "Short wavelengths are deflected far more readily than long ones. Blue light is bounced around the sky many times over; red light mostly travels straight through.",
          analogy:
            "Like a pond: ripples much smaller than a wave are scattered strongly, while long swells pass through untouched.",
        },
        {
          type: "text",
          body:
            "So the zenith looks blue. What is missing from that answer is the **path length** — how far through the atmosphere the light actually travels before it reaches your eye.",
        },
      ],
    },
    {
      id: "scattering",
      title: "Scattering and wavelength",
      blocks: [
        {
          type: "derivation",
          steps: [
            {
              expression: "I(λ) ∝ 1 / λ^4",
              note: "Scattered intensity against wavelength.",
            },
            {
              expression: "I(450) / I(700) = (700 / 450)^4 ≈ 5.9",
              note: "Blue is scattered nearly six times harder than deep red.",
            },
            {
              expression: "I(400) / I(700) = (700 / 400)^4 ≈ 9.4",
              note: "Violet, at the short end, is scattered hardest of all.",
            },
          ],
          conclusion:
            "Violet scatters more than blue, yet the zenith reads blue: the sun's own spectrum, light scattered in from the rest of the sky, and the eye's sensitivity all pull the perceived colour away from violet.",
        },
        {
          type: "worked-example",
          problem:
            "How much harder does 480nm light scatter than 640nm light, and what does that imply for a horizon view?",
          steps: [
            {
              title: "Write the ratio",
              detail: "`I(480) / I(640) = (640 / 480)^4`",
            },
            {
              title: "Evaluate it",
              detail: "`(4/3)^4 = 256/81 ≈ 3.16`",
            },
            {
              title: "Interpret it",
              detail:
                "Looking up at noon, blue wins by a factor of about three. Toward the horizon the path is far longer, and that is where the effect gets decisive.",
            },
          ],
          result: "A factor of ≈3.2 — real, but nowhere near enough to explain a sunset.",
        },
      ],
    },
    {
      id: "long-path",
      title: "The long path at dusk",
      blocks: [
        {
          type: "text",
          body:
            "When the sun sits low, light reaching you has crossed the atmosphere **sideways**. At the extreme — the sun on the horizon — it passes through roughly 38 times the air that a noon ray does.",
        },
        {
          type: "diagram",
          direction: "lr",
          nodes: [
            {
              id: "sun",
              label: "Sun",
              shape: "round",
              tip: "Low on the horizon — the geometry that matters",
            },
            {
              id: "air",
              label: "Atmosphere",
              shape: "box",
              tip: "About 8 km deep; the whole crossing happens here",
            },
            {
              id: "eye",
              label: "Your eye",
              shape: "pill",
              tip: "Looking along the horizon, into the scattering volume",
            },
          ],
          edges: [
            {
              from: "sun",
              to: "air",
              label: "slant path — up to 38× the vertical",
              kind: "leads",
            },
            {
              from: "air",
              to: "eye",
              label: "back-scattered light, blue mostly gone",
              kind: "leads",
            },
          ],
        },
        {
          type: "text",
          body:
            "Raise the factor from 3 to 38 and the arithmetic turns over. The short wavelengths are scattered out of the beam almost completely; what survives the journey to your eye is what scattering spared — the long reds and oranges.",
        },
      ],
    },
    {
      id: "numbers",
      title: "What the numbers say",
      blocks: [
        {
          type: "text",
          body:
            "Relative scattered intensity across the visible range, normalized to 400nm. Read it twice: once as the noon bias towards blue, and once as the filter a long path applies.",
        },
        {
          type: "chart",
          kind: "bar",
          unit: "relative intensity",
          caption:
            "Scattered intensity ∝ 1/λ^4, normalized to 400nm. A factor of 9.4 separates the two ends of the spectrum.",
          points: [
            { label: "400nm", value: 1, tip: "Violet — scattered hardest" },
            { label: "450nm", value: 0.62, tip: "Blue" },
            { label: "500nm", value: 0.41, tip: "Cyan-green" },
            { label: "550nm", value: 0.28, tip: "Green" },
            { label: "600nm", value: 0.2, tip: "Orange" },
            { label: "650nm", value: 0.14, tip: "Red" },
            { label: "700nm", value: 0.11, tip: "Deep red — scattered least" },
          ],
        },
        {
          type: "callout",
          variant: "note",
          body:
            "Scattering is not the whole story. Aerosols, which are larger than air molecules, scatter much more evenly across wavelengths — dust and pollution are why a hazy sunset is pale rather than fiery.",
        },
      ],
    },
    {
      id: "check",
      title: "Check yourself",
      blocks: [
        {
          type: "quiz",
          question: "The sun is no dimmer at sunset. So why does the horizon look red?",
          options: [
            {
              text: "The light travels much further through the atmosphere",
              why: "Correct — a longer path strips out the short wavelengths, leaving the long ones.",
            },
            {
              text: "The atmosphere gets thicker as the sun sets",
              why: "The air is the same; only the angle of the path through it changes.",
            },
            {
              text: "Red light is produced only near the horizon",
              why: "There is no mechanism that would turn red light into red light — it is a filtering story.",
            },
            {
              text: "Dust in the air scatters blue away",
              why: "Aerosols do scatter, but they scatter all wavelengths about equally — they wash the sunset out rather than redden it.",
            },
          ],
          answer: 0,
          explanation:
            "Scattering favours short wavelengths, so distance through the atmosphere selects for the long ones. The sun's brightness is a red herring.",
        },
      ],
    },
    {
      id: "sources",
      title: "Sources",
      blocks: [
        {
          type: "sources",
          title: "Sources",
          items: [
            {
              id: "rayleigh-notes",
              title: "Rayleigh scattering — reference notes",
              url: "https://example.com/rayleigh-scattering",
              detail:
                "Where the inverse fourth-power relation and its derivation are set out.",
            },
            {
              id: "airmass",
              title: "Air mass and airmass factors",
              url: "https://example.com/air-mass",
              detail:
                "The roughly 38× horizon-to-zenith figure used in the path-length argument.",
            },
          ],
        },
      ],
    },
  ],
}
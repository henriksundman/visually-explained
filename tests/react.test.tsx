import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Explanation } from "../src/react/Explanation"
import type { TextBlock } from "../src/core/schema"

const ir = {
  version: 1,
  title: "T",
  summary: "S",
  blocks: [{ type: "text", body: "hello **world**" }],
}

describe("Explanation", () => {
  it("renders server-side with the default light theme", () => {
    const html = renderToStaticMarkup(<Explanation ir={ir} />)
    expect(html).toContain(`class="exp exp-theme-light"`)
    expect(html).toContain("exp-title")
    expect(html).toContain("<strong>world</strong>")
  })

  it("renders leniently by default and throws in strict mode", () => {
    const bad = { version: 2, blocks: [] }
    expect(renderToStaticMarkup(<Explanation ir={bad} />)).toContain(`class="exp exp-theme-light"`)
    expect(() => renderToStaticMarkup(<Explanation ir={bad} strict />)).toThrow()
  })

  it("lets consumers override a primitive with a custom component", () => {
    const MyText = ({ block }: { block: TextBlock }) => <em data-test="my-text">{block.body}</em>
    const html = renderToStaticMarkup(
      <Explanation ir={ir} theme="none" components={{ text: MyText }} />,
    )
    expect(html).toContain(`data-test="my-text"`)
    expect(html).not.toContain("exp-text")
  })

  it("renders unknown types through the core fallback", () => {
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [{ type: "chart", title: "Sales" }] }} theme="none" />,
    )
    expect(html).toContain("exp-fallback")
  })
})

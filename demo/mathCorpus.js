/** One corpus, both engines. These are the constructs a derivation actually
 *  needs; the parity test and the /math route both read this list, so the demo
 *  can never drift from what the tests cover. */
export const MATH_CORPUS = [
  { tex: String.raw`\frac{a+b}{c}`, note: "fraction" },
  { tex: String.raw`\frac{\pi^2}{6} = \sum_{i=1}^{\infty} \frac{1}{i^2}`, note: "sum + limits" },
  { tex: String.raw`x^{2n} = (x^2)^n`, note: "superscript" },
  { tex: String.raw`a_{ij} + b_{ij}`, note: "subscript" },
  { tex: String.raw`\sqrt{x^2 + y^2}`, note: "radical" },
  { tex: String.raw`\theta = \pi/4`, note: "greek" },
  { tex: String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`, note: "integral" },
  { tex: String.raw`\hat{y} = \beta_0 + \beta_1 x`, note: "accent" },
  { tex: String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, note: "matrix" },
  { tex: String.raw`\frac{1}{`, note: "malformed — degrades" },
]

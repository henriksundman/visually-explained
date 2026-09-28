/** FNV-1a 32-bit, base36 — deterministic content-hash for sketch seeds. */
export function hashSeed(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** rough.js seed must be a uint32; derive it from a base36 hash string. */
export function seedNumber(hash: string, salt: number): number {
  return Number.parseInt(hashSeed(`${hash}:${salt}`), 36) % 0xffffffff
}

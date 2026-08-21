/**
 * Minimal frontmatter parser for the simple `key: value` YAML used by our
 * skills (single-line scalar values only). If skills ever grow richer YAML
 * (lists, nested objects), swap this for a real parser like js-yaml.
 */
export function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const frontmatter: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    let value = line.slice(sep + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key !== '') frontmatter[key] = value
  }
  return frontmatter
}

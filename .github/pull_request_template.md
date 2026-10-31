## Submission checklist

One entry per PR, editing `marketplace.json` only. Confirm each item:

- [ ] This PR adds/changes exactly **one** entry in `entries[]` and touches nothing else
- [ ] The package is **not** in `blocklist.json` (no archived `@modelcontextprotocol/server-*`, no `postmark-mcp@1.0.16`, no `server.smithery.ai` hosting) — checked at the version I'm submitting
- [ ] Any package spec is pinned to an **exact version** — no `@latest`, no ranges, no unpinned specs
- [ ] The `config_template` contains **no secrets**; everything the server needs is declared in `required_secrets`
- [ ] Community entry: `featured: false`, `verified: false`, `config_template` is empty `{}`, `source_url` points at the upstream project
- [ ] The entry `id` is short kebab-case, so tool names fit the `mcp_<server>_<tool>` 64-character budget
- [ ] `description`, `key_badge`, `license` and `risk_notes` honestly reflect the upstream project (access, keys, costs)

**Entry id:**
**Upstream source URL:**
**Why this belongs in the catalog:**

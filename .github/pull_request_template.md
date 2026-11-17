<!--
What kind of submission is this? Delete the section that does not
apply. The full rules live in CONTRIBUTING.md — this template is
the short version of them.
-->

## MCP catalog entry

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

## Bot listing

One listing per PR: one package file under `packages/<your-github-login>/`, its entry in `bots.json`, and the regenerated `bot-index.json`. Run `node scripts/validate-bots.mjs --root .` before opening the PR — it is the same gate CI runs. Confirm each item:

- [ ] The package is under `packages/<my-login>/`, `author.handle` is my GitHub login, and the `bots.json` entry's `sha256` is the hash of the package file's exact bytes
- [ ] I regenerated the component index (`node scripts/generate-bot-index.mjs`) and included `bot-index.json`
- [ ] **License declared** in both the package and the index entry (my choice of license; MIT is the pre-filled suggestion)
- [ ] `price.amount` is `0` in both files, and I did not set `featured: true` (Featured is a maintainer decision)
- [ ] The listing text is Vietnamese or English
- [ ] If this changes an existing listing, `version` is bumped (semver, strictly greater) in the package **and** the entry, with a refreshed `sha256`
- [ ] Optional discovery fields, if I used them: `keywords` are terms specific to what this bot does, and `domains` lists only hosts this bot genuinely works with

**Security — the package carries the recipe and nothing else. Confirm:**

- [ ] No credentials of any kind (keys, tokens, passwords, cookies, OAuth grants, SSH keys, webhook secrets), no channel bindings or chat ids, no `provider_id`/`model`, no `ssh_host_ids`, no `sender_allowlist`, no memory facts or chat history
- [ ] Bundled skills are SKILL.md text only (no scripts, no extra files) and none reuses the name of a skill Boom ships
- [ ] Routines are data only (`name`, `prompt`, schedule or trigger kind) — they arrive switched off on the installer's machine
- [ ] The instructions do not tell a bot to bypass or conceal anything from Boom's approvals, secret shield or audit, or from its owner

**Listing key (`gh-<login>/<slug>`):**
**What the bot does, in one line:**
**License:**

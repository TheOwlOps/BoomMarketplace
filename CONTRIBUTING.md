# Contributing to BoomMarketplace

This repo is data-first. A submission is a **pull request**: MCP entries edit `marketplace.json` only (one entry per PR); bot listings add one package file under `packages/<your-login>/` plus one entry in `bots.json` (see **Bots** below). Changes to `blocklist.json` are made by maintainers (it is safety data with its own process), and Featured promotions are maintainers-only. The only code in the repo is the bot-listing validation gate in `scripts/`, which runs in CI and never inside the Boom app.

New submissions land as **Community** entries. Featured is a maintainer decision, not something a PR can request into existence.

## Hard rules (a PR violating any of these will not merge)

1. **Exact version pins only.** Every package spec in a `config_template` must pin one exact version (e.g. `some-server@1.2.3`). No `@latest`, no ranges (`^`, `~`, `>=`, `*`), no unpinned specs, no branch/commit-floating git references without a full commit SHA.
2. **Blocked packages and hosts are never listable.** Check `blocklist.json` before submitting: the archived `@modelcontextprotocol/server-*` packages, `postmark-mcp@1.0.16`, anything hosted on `server.smithery.ai`, and any future entries there are banned as listings and as install targets — at any version, under any name.
3. **No secrets in config templates.** A `config_template` must never contain API keys, tokens, passwords or personal values. Declare what the server needs in the entry's `required_secrets` (key names and what they're for); users supply the values on their own machine at install time.
4. **Respect the tool-name budget.** Boom exposes an installed server's tools to the model as `mcp_<server>_<tool>`, hard-capped at **64 characters**. Keep the entry `id` short and kebab-case so real tool names fit; names that overflow the cap get truncated with a hash suffix, which is a degraded experience you can design away.
5. **Community entries are metadata only.** `featured: false`, `verified: false`, and `config_template` **must be empty** (`{}`). Provide an accurate `source_url` so users can inspect and install manually. Do not submit a `config_template` hoping for a Featured-style listing — that requires maintainer review and an exact pin (rule 1).
6. **Describe honestly.** `description` says what the server actually does; `risk_notes` discloses what it can touch (filesystem paths, network access, credentials it handles, cost/API-key requirements). `key_badge` must reflect reality (`keyless` only if it truly needs no key). `license` is the upstream project's license, copied accurately.
7. **One entry per PR.** Keep the diff to your single entry object in `entries[]`. PRs that reorder, reformat or touch other entries will be asked to rebase down to the one entry.

## Entry fields

Each entry is an object with: `id` (unique, kebab-case), `name`, `publisher`, `description`, `category`, `license`, `source_url`, `transport` (`stdio` or `http`), `version` (the exact upstream version the pin refers to; empty for Community metadata), `key_badge`, `required_secrets`, `risk_notes`, `config_template`, `featured`, `verified`.

## What happens after you submit

A maintainer checks the entry against the rules above and against `blocklist.json`, verifies the pin exists upstream, and sanity-checks the description against the upstream project. Merging makes the entry visible to Boom clients on their next catalog refresh — it does **not** grant the entry "verified" or Featured status, and every install still goes through the user's own review modal and hash approval on their machine.

## Bots (community bot listings)

A bot listing is a **recipe** — the bot's instructions and presentation, as one JSON file — that other Boom users will be able to install as their own independent bot. Your GitHub account is your identity: your listings live under `packages/<your-github-login>/` forever, and `author.handle` in the package must be your login.

### How to submit (the manual door)

Until the in-app exporter ships, submissions are two files in one pull request:

1. **The package** — `packages/<your-login>/<slug>.json`, in the format below.
2. **The index entry** — one object appended to `bots[]` in `bots.json`, with `"package"` pointing at your file and `"sha256"` set to the SHA-256 of the package file's exact bytes (`sha256sum packages/<your-login>/<slug>.json`). Never compute it by editing a previous hash — the app refuses an entry whose hash does not match its package.

Before opening the PR, run the same gate CI will run:

```
node scripts/validate-bots.mjs --root .
```

### Package format (summary)

```json
{
  "format": "boom.bot-package",
  "format_version": 1,
  "key": "<slug>",
  "version": "1.0.0",
  "name": "My Bot",
  "description": "≤1024 characters",
  "instructions": "the bot's system prompt",
  "avatar_variant": "blob",
  "avatar_color": "#3b82f6",
  "denied_tools": [],
  "skill_names": [],
  "skills": [{ "name": "my-skill", "skill_md": "<full SKILL.md text>" }],
  "routines": [{ "name": "Morning brief", "prompt": "…", "schedule": { "kind": "daily_at", "time": "07:00" } }],
  "requires": ["gmail"],
  "author": { "handle": "<your-login>", "name": "Your Name" },
  "category": "Productivity",
  "license": "MIT",
  "price": { "amount": 0, "currency": "USD" }
}
```

### Hard rules for bots (a PR violating any of these will not merge)

1. **Declare a license.** The `license` field is mandatory in both the package and the index entry. The choice is yours (any SPDX id or plain text); the publish flow pre-fills **MIT** as the suggestion. A listing without a license gives installers no stated right to use what they installed.
2. **Vietnamese or English only.** Listings are accepted in Vietnamese or English at launch, because the maintainer reviews every listing by reading its instructions diff himself — the one step that cannot be automated. A listing in another language is returned with a request for a Vietnamese or English version; it is never machine-translated and accepted unread.
3. **Free means free, mechanically.** `price.amount` must be `0` in the package and the index entry. CI rejects any non-zero amount until paid listings exist.
4. **Featured is maintainers-only.** One shelf for everyone; `featured: true` only moves a listing to the front of it, and a PR that sets it on its own entry is rejected by CI.
5. **A package carries the recipe and nothing else.** Never include: credentials of any kind (API keys, tokens, passwords, cookies, OAuth grants, SSH keys, webhook secrets); channel bindings or channel/chat ids; `provider_id` or `model`; `ssh_host_ids`; `sender_allowlist`; memory facts or chat history; avatar images or local paths; or your bot's id. The format has no fields for these, the schema rejects unknown fields, and CI greps for them besides.
6. **Bundled skills are SKILL.md text only** — no scripts, no reference files — at most 10 per package, each passing the same spec rules Boom enforces at install (valid name, description ≤1024 chars, body within the token ceiling). A bundled skill may not reuse the name of a skill Boom already ships.
7. **Routines travel as data and arrive switched off.** At most 10, each just `name`, `prompt`, and a `schedule` (`every_minutes` / `daily_at` / `weekly_at`) or a `channel_message` trigger (kind + channel name only). No `deliver_to`, no webhook data, no enabled state.
8. **Any content change is a new version.** Bump `version` (semver, strictly greater) in both the package and the index entry, and refresh the `sha256`, in the same PR. In-place edits under an existing version are rejected by CI.
9. **Reserved names are not claimable** — Boom, Boom Team, Official, Admin, Support, Moderator, TheOwlOps — in your handle claim, bot name or author name.
10. **Prohibited content:** instructions that tell a bot to bypass, weaken or conceal actions from Boom's approval prompts, secret shield or audit — or from its owner; wrongdoing enablement (credential theft, spam, fraud, unauthorized access, harassment, impersonation); destructive actions presented as defaults without explicit user confirmation in the flow; undisclosed collection of the user's data; third parties' personal data.

### What happens after you submit a bot

The `validate-bots` CI gate runs nine checks in order (diff scope; parse + schema; identity + naming; caps; version discipline; credential scan; safety-pattern scan; skill validation; cross-consistency) and reports findings as annotations on the PR. Then the maintainer reads the instructions diff and merges — the human read is a real step, not a formality. To withdraw your own listing, open a PR that removes your entry from `bots.json` and deletes your package file.

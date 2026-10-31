# Contributing to BoomMarketplace

This repo is data, not code. A submission is a **pull request that edits `marketplace.json` only** — one entry per PR. Changes to `blocklist.json` are made by maintainers (it is safety data with its own process), and Featured promotions are maintainers-only.

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

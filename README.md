# BoomMarketplace

The official, data-only catalog for [Boom](https://github.com/TheOwlOps/Boom) — MCP servers, plugins and skills.

This repository is the first-party marketplace source that Boom reads to populate its Marketplace: the listings live here as JSON so the catalog can be updated by pull request, on its own cadence, without a Boom app release.

Almost no code: the listings are data, maintained by pull request. The one exception is `scripts/validate-bots.mjs` and its workflow — the CI gate every community **bot** submission must pass before a maintainer reviews it. That script never runs inside the Boom app; the app re-validates everything itself, on the user's machine, at install time.

## Files and what is canonical

| File | Canonical for | Contents |
| --- | --- | --- |
| `marketplace.json` | **Listings** | The catalog entries (`version`, `registry_synced_at`, `entries[]`). |
| `blocklist.json` | **Safety data** | Package rules and URL/host patterns that must never be listed or installed. Has its own update path, independent of the listings. |
| `skills.json` | **Skill listings** | Skill entries (`name`, `publisher`, `description`, `license`, `category`, `source` git URL, `kind`: `skill` or `pack`). Installing one runs Boom's existing skill pipeline: clone → security scan → staged human approval → install. |
| `bots.json` | **Bot listings (index)** | One entry per community bot: metadata (`key` `gh-<handle>/<slug>`, `name`, `author`, `description`, `category`, `version`, `license`, dormant `price`) plus a pin — the `package` path and its `sha256`. |
| `packages/<handle>/<slug>.json` | **Bot listings (content)** | One JSON package per bot: the installable recipe (instructions, avatar variant/color, denied tools, bundled SKILL.md texts, suggested routines, `requires`). The format structurally cannot carry credentials, channel bindings, provider/model, SSH grants or other owner-only data. |
| `scripts/validate-bots.mjs`, `.github/workflows/validate-bots.yml` | **CI gate** | The nine-check validator every bot PR must pass (diff scope, schema, identity, caps, version discipline, credential scan, safety patterns, skill validation, cross-consistency). Runs on `pull_request_target` over API-fetched snapshots — PR content is never checked out or executed. |

Structural note: in Boom's current embedded catalog (`plugins/boom-mcp/catalog.json` in the Boom repo) the blocklist lives inside the same file as the listings. In this repository it is **split out into `blocklist.json`** so safety data can move faster than listings. `marketplace.json` therefore deliberately does **not** carry a copy of the blocklist — there is exactly one blocklist in this repo, and it is `blocklist.json`. Until the Boom app finishes migrating to this repo as its source, the app also keeps its own embedded catalog (including its embedded blocklist copy) as an offline fallback; maintainers keep that embedded copy and this repo in sync during the transition. Longer term, `blocklist.json` is the intended home for signed, out-of-band safety updates.

## How Boom consumes this repo

1. Boom fetches `marketplace.json` and `blocklist.json` from this repository (raw file URLs) and caches them locally.
2. The cached copy is used when the network is unavailable; the catalog embedded in the app binary is the final offline fallback.
3. Every entry — from this repo or anywhere else — is installed through Boom's existing pipeline: importer hygiene checks (blocklist enforced at preview **and** install), exact version pins, a mandatory human review modal showing the full command/URL, and hash-bound approval after install (any later change to a server's config or tool surface pauses it until the user re-approves).

## Trust rules — read this before adding a catalog anywhere

- **This repository is the only official / first-party catalog.** Boom's "verified / official" treatment, badges and reserved names apply **only** to listings from this repo.
- Catalogs hosted elsewhere are third-party sources. Boom labels them as external and unreviewed; they never inherit the official badges, and the blocklist is only ever taken from this repo (or the copy embedded in the app) — never from a third-party catalog.
- A listing here is data, not a code audit. Featured entries are maintainer-reviewed and pinned to exact versions; the blocklist is enforced at preview and install time regardless of where an install request originates.

## Featured vs Community

- **Featured** (12 entries): maintainer-reviewed, `verified: true`, pinned to an exact version, and directly installable from the Marketplace — each has a complete `config_template`. Featured changes are maintainers-only.
- **Community** (12 entries): metadata snapshots (name, publisher, description, source link) with an **empty `config_template` and `verified: false`**. They are a discovery shelf, not one-click installs: installing one today means pasting a configuration manually, which still passes through the same review modal, blocklist and hash-approval pipeline.

## Bot listings

Community **bots** are listed through `bots.json` + `packages/` (see the file table above). Anyone with a GitHub account can submit one by pull request; the `validate-bots` CI gate checks the submission mechanically, and a maintainer reads the instructions diff before merging — there is no auto-merge. Listings are free (`price.amount` is pinned to `0` by CI), carry a declared license, and are written in Vietnamese or English at launch. Submission rules live in [CONTRIBUTING.md](CONTRIBUTING.md) under **Bots**.

Rollout status: the catalog side (format, index, CI gate) is live in this repo. In-app browsing and one-click install of bot listings ship in a later Boom release — until then, a merged bot listing is catalog data, not yet an in-app shelf.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: MCP submissions are pull requests that edit `marketplace.json` only, with exact version pins, no secrets in templates, and an honest description of what the server does and what it needs; bot submissions follow the **Bots** section of the same file.

## License

MIT — see [LICENSE](LICENSE).

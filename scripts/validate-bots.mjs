#!/usr/bin/env node
/**
 * validate-bots.mjs — the CI gate for community bot packages.
 *
 * Implements the nine checks of the Boom bot-marketplace design
 * (Boom repo: docs — marketplace-open/DESIGN.md §7.3) IN ORDER, failing
 * fast: the first check that produces an error stops the run, so a red
 * PR names exactly one check. Warnings never fail the run.
 *
 * One source of logic for both worlds:
 *   - Local / catalog mode (no --author): validate a whole catalog
 *     snapshot (a repo checkout or a directory shaped like one).
 *       node scripts/validate-bots.mjs --root .
 *   - PR mode (what .github/workflows/validate-bots.yml runs): the PR's
 *     data files are fetched through the GitHub API into a snapshot
 *     directory — PR content is NEVER checked out or executed — and
 *     the base branch gets its own snapshot for the version checks.
 *       node scripts/validate-bots.mjs --root head-snapshot \
 *         --base-root base-snapshot --author <pr-login> \
 *         --files changed-files.txt
 *
 * Pattern lists below are copied AS DATA from the Boom app's Rust
 * sources (paths noted per list) per DESIGN §7.3 note (a): drift is
 * tolerable because the receiving app re-runs the real Rust validators
 * at install time; this gate is a pre-filter, the app is the last word.
 *
 * No dependencies beyond the Node standard library.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

// ---------------------------------------------------------------------------
// Data copied from the Boom app (source pointers to the Rust originals)
// ---------------------------------------------------------------------------

// DESIGN §5.2 — the closed category set (the Share dialog's suggestions).
const CATEGORIES = [
  "Engineering",
  "Research",
  "Writing",
  "Communication",
  "Operations",
  "Media",
  "Personal",
  "Productivity",
];

// Boom repo: crates/boom-core/src/server/routes/bot_templates.rs (BOT_TEMPLATES).
const BUILTIN_KEYS = [
  "coder",
  "researcher",
  "writer",
  "translator",
  "email",
  "devops",
  "reviewer",
  "tester",
  "media",
  "assistant",
  "shopper",
  "tech-lead",
];

// DESIGN §11 — names that may not be claimed as a handle, in a bot's
// display name, or in an author name.
const RESERVED_CLAIMS = [
  "boom",
  "boom team",
  "boom-team",
  "official",
  "admin",
  "support",
  "moderator",
  "theowlops",
];

// DESIGN §5.3 — the cannot-carry list, as field names. (The schema in
// check 2 already rejects every unknown top-level field; naming these
// explicitly buys a clearer error message — belt and braces, as the
// design prescribes.)
const CANNOT_CARRY_FIELDS = [
  "channel_bindings",
  "deliver_to",
  "provider_id",
  "model",
  "ssh_host_ids",
  "sender_allowlist",
  "bot_id",
  "source_bot_id",
  "avatar_emoji",
  "avatar_image",
  "memory",
  "memory_facts",
  "chat_history",
  "webhook_secret",
  "webhook_token",
  "credentials",
  "api_key",
  "password",
  "oauth_token",
  "cookies",
];

const PACKAGE_FIELDS = [
  "format",
  "format_version",
  "key",
  "version",
  "name",
  "description",
  "instructions",
  "avatar_variant",
  "avatar_color",
  "allowed_tools",
  "denied_tools",
  "skill_names",
  "skills",
  "routines",
  "requires",
  "author",
  "category",
  "license",
  "price",
  "example",
  "does",
  "does_not",
];

const INDEX_FIELDS = [
  "key",
  "name",
  "author",
  "description",
  "category",
  "version",
  "license",
  "price",
  "package",
  "sha256",
  "featured",
];

const AUTHOR_FIELDS = ["handle", "name", "url"];
const SKILL_FIELDS = ["name", "skill_md"];
const ROUTINE_FIELDS = ["name", "prompt", "schedule", "trigger"];
const PRICE_FIELDS = ["amount", "currency"];
const TRIGGER_FIELDS = ["trigger", "channel"];

// Boom repo: crates/boom-core/src/tools/bot_skills.rs
// (credential_shape_findings + has_prefixed_token). Labels are static
// strings — the matched value is never reported, here either.
// `sk-ant-` is tested before `sk-`, mirroring the Rust else-if chain:
// the generic `sk-` branch only runs when the Anthropic one did not hit.
const CREDENTIAL_SHAPES = [
  { prefix: "sk-ant-", minTail: 16, label: "Anthropic API key shape (sk-ant-…)", group: "openai" },
  { prefix: "sk-proj-", minTail: 16, label: "OpenAI-style API key shape (sk-…)", group: "openai" },
  { prefix: "sk-", minTail: 32, label: "OpenAI-style API key shape (sk-…)", group: "openai" },
  { prefix: "ghp_", minTail: 30, label: "GitHub personal access token shape (ghp_…)" },
  { prefix: "gho_", minTail: 30, label: "GitHub OAuth token shape (gho_…)" },
  { prefix: "github_pat_", minTail: 30, label: "GitHub fine-grained token shape (github_pat_…)" },
  { prefix: "AKIA", minTail: 16, label: "AWS access key id shape (AKIA/ASIA…)" },
  { prefix: "ASIA", minTail: 16, label: "AWS access key id shape (AKIA/ASIA…)" },
  { prefix: "xoxb-", minTail: 10, label: "Slack token shape (xox…)" },
  { prefix: "xoxa-", minTail: 10, label: "Slack token shape (xox…)" },
  { prefix: "xoxp-", minTail: 10, label: "Slack token shape (xox…)" },
  { prefix: "xoxr-", minTail: 10, label: "Slack token shape (xox…)" },
  { prefix: "xoxs-", minTail: 10, label: "Slack token shape (xox…)" },
  { prefix: "AIza", minTail: 35, label: "Google API key shape (AIza…)" },
  { prefix: "glpat-", minTail: 18, label: "GitLab token shape (glpat-…)" },
];

// DESIGN §7.3 check 7 splits Boom's pattern sets: the phrases that
// target Boom's own safeguards — instructing a bot to bypass approvals,
// conceal actions from its owner, or exfiltrate data — FAIL; everything
// else in the sets WARNS (a PR annotation for the maintainer's eye).
// FAIL set = the injection entries of skills::DANGEROUS_PATTERNS
// (crates/boom-core/src/tools/skills.rs) plus bot_skills.rs's
// INJECTION_EXTRA_PATTERNS (crates/boom-core/src/tools/bot_skills.rs).
const SAFEGUARD_FAIL_PATTERNS = [
  ["ignore previous instructions", "prompt injection phrase"],
  ["ignore all previous instructions", "prompt injection phrase"],
  ["disregard previous instructions", "prompt injection phrase"],
  ["disregard all previous", "prompt injection phrase"],
  ["you are now", "possible prompt-injection phrase"],
  ["forget your instructions", "possible prompt-injection phrase"],
  ["reveal your system prompt", "possible prompt-injection phrase"],
  ["print your system prompt", "possible prompt-injection phrase"],
  ["do not tell the user", "possible prompt-injection phrase"],
  ["don't tell the user", "possible prompt-injection phrase"],
  ["without asking the user", "possible prompt-injection phrase"],
  ["override your instructions", "possible prompt-injection phrase"],
  ["exfiltrate", "possible prompt-injection phrase"],
];

// WARN set = the rest of skills::DANGEROUS_PATTERNS + WARNING_PATTERNS
// (crates/boom-core/src/tools/skills.rs).
const WARN_PATTERNS = [
  ["rm -rf /", "destructive: 'rm -rf /'"],
  ["rm -rf ~", "destructive: 'rm -rf ~'"],
  ["rm -rf $HOME", "destructive: 'rm -rf $HOME'"],
  [":(){ :|:& };:", "fork bomb pattern"],
  ["mkfs.", "destructive: filesystem format"],
  ["dd if=", "destructive: raw disk write"],
  ["| sh", "piped remote code execution (| sh)"],
  ["| bash", "piped remote code execution (| bash)"],
  ["curl --proto", "piped remote code execution via curl"],
  ["curl ", "network fetch (curl)"],
  ["wget ", "network fetch (wget)"],
  ["os.environ", "reads process environment (possible secret exfiltration)"],
  ["process.env", "reads process environment (possible secret exfiltration)"],
  ["eval(", "dynamic code evaluation (eval)"],
  ["subprocess", "spawns subprocesses"],
  ["shell=True", "shell command execution"],
  ["requests.post", "outbound HTTP POST (possible data exfiltration)"],
  ["http.post", "outbound HTTP POST (possible data exfiltration)"],
  ["fetch(", "outbound network fetch"],
];

// Boom's shipped skill names (frontmatter `name` of every SKILL.md under
// skills/ in the Boom repo @ bac3fa4e). A bundled marketplace skill may
// not shadow one of these (DESIGN §5.5); `skill_names` may reference
// them (§5.2).
const SHIPPED_SKILL_NAMES = [
  "airtable", "arxiv", "blocked-page-recovery", "boom-agent-skill-authoring",
  "box", "code-review", "codebase-inspection", "competitor-news-monitor",
  "document-to-action-items", "docx", "dogfood", "email-inbox-triage",
  "gif-search", "git-workflow", "github", "google-workspace",
  "grounded-citations", "himalaya", "inspecting-boom-desktop-dom",
  "llm-wiki", "local-search", "maps", "meeting-action-items",
  "motion-design", "motion-template-card", "motion-template-kinetic",
  "motion-template-showcase", "node-inspect-debugger", "notion", "pdf",
  "powerpoint", "product-price-monitor", "python-debugpy",
  "requesting-code-review", "sec-api-security", "sec-auth-session",
  "sec-crypto-pitfalls", "sec-hardening", "sec-incident-response",
  "sec-llm-agent-security", "sec-pentest-methodology",
  "sec-recon-attack-surface", "sec-secrets-supply-chain",
  "sec-secure-code-review", "sec-threat-modeling", "sec-web-vulns",
  "security-audit", "simplify-code", "songsee", "spike",
  "systematic-debugging", "teams-meeting-pipeline", "test-driven-development",
  "test-writer", "video-creator", "web-ordering", "weekly-review-planning",
  "xlsx", "youtube-content",
];

// DESIGN §7.3 note (b): `requires` names are checked against the
// connector/channel id list the validator ships; unknown names warn,
// never fail. Sources: crates/boom-core/src/connectors/mod.rs
// (ALL_CONNECTOR_IDS) and crates/boom-core/src/server/channels/mod.rs.
const CONNECTOR_IDS = [
  "gmail", "gcalendar", "gdrive", "github", "spotify", "social",
  "places", "flightaware", "duffel", "ticketmaster", "health", "canva",
  "finances", "meta_ads", "shopify", "stripe", "tailscale", "email",
];
const CHANNEL_IDS = [
  "telegram", "discord", "slack", "whatsapp", "line", "feishu", "zalo",
  "messenger", "zalo-personal", "whatsapp-personal", "facebook-personal",
];

// Logins exempt from the PR diff-scope check (DESIGN §7.3 check 1:
// "Maintainer PRs are exempt"). The catalog owner's own logins.
const DEFAULT_MAINTAINERS = ["ryanowlops", "theowlops"];

// Caps (DESIGN §5.2/§5.5/§7.3 check 4).
const MAX_PACKAGE_BYTES = 512 * 1024;
const MAX_SKILL_MD_BYTES = 256 * 1024;
const MAX_BODY_TOKENS = 20_000;
const MAX_DESCRIPTION_CHARS = 1024;
const MAX_COMPATIBILITY_CHARS = 500;
const MAX_BUNDLED_SKILLS = 10;
const MAX_ROUTINES = 10;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const charCount = (s) => [...s].length;
// The Rust estimate: ceil(chars / 4) (bot_skills.rs est_tokens).
const estTokens = (s) => Math.ceil(charCount(s) / 4);

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// The spec name grammar (bot_skills.rs validate_skill_name): 1–64 chars
// of lowercase alphanumeric + hyphens, no leading/trailing hyphen, no
// consecutive hyphens. Used for slugs and skill names (DESIGN §5.5/§7.3).
function validateNameGrammar(name) {
  const chars = [...name];
  if (chars.length === 0 || chars.length > 64) {
    return `name '${name}' must be 1–64 characters (got ${chars.length})`;
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return `name '${name}' must not start or end with a hyphen`;
  }
  if (name.includes("--")) {
    return `name '${name}' must not contain consecutive hyphens`;
  }
  for (const c of chars) {
    if (c === "-") continue;
    if (c !== c.toLowerCase() && c.toUpperCase() === c && /\p{L}/u.test(c)) {
      return `name '${name}' must be lowercase (found '${c}')`;
    }
    if (!/[\p{L}\p{N}]/u.test(c) || c !== c.toLowerCase()) {
      // Mirror the Rust rule: lowercase alphanumeric only (its
      // is_alphanumeric admits Unicode letters; uppercase already
      // returned above, so what remains is: not alphanumeric at all).
      if (!/[a-z0-9]/u.test(c) && !/\p{Ll}/u.test(c)) {
        return `name '${name}' contains invalid character '${c}' (lowercase letters, digits and hyphens only)`;
      }
    }
  }
  return null;
}

// GitHub login grammar: 1–39 chars, alphanumeric + hyphens, no
// leading/trailing hyphen.
function validateHandleGrammar(handle) {
  if (typeof handle !== "string" || handle.length === 0 || handle.length > 39) {
    return `handle '${handle}' must be 1–39 characters`;
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(handle)) {
    return `handle '${handle}' must be alphanumeric + hyphens, with no leading/trailing hyphen`;
  }
  if (handle.includes("--")) {
    return `handle '${handle}' must not contain consecutive hyphens`;
  }
  return null;
}

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function isSemver(v) {
  return typeof v === "string" && SEMVER_RE.test(v);
}

// Semver precedence compare (build metadata ignored). Returns -1/0/1.
function compareSemver(a, b) {
  const pa = SEMVER_RE.exec(a);
  const pb = SEMVER_RE.exec(b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const ra = pa[4] ? pa[4].split(".") : null;
  const rb = pb[4] ? pb[4].split(".") : null;
  if (ra === null && rb === null) return 0;
  if (ra === null) return 1; // a release outranks a prerelease
  if (rb === null) return -1;
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    if (i >= ra.length) return -1;
    if (i >= rb.length) return 1;
    const na = /^\d+$/.test(ra[i]);
    const nb = /^\d+$/.test(rb[i]);
    if (na && nb) {
      const d = Number(ra[i]) - Number(rb[i]);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (na) return -1;
    else if (nb) return 1;
    else if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
  }
  return 0;
}

// Port of bot_skills.rs has_prefixed_token: `prefix` at a token
// boundary (preceding char not ASCII alphanumeric) followed by at
// least `minTail` token chars [A-Za-z0-9_-].
function hasPrefixedToken(text, prefix, minTail) {
  const tailOk = (c) => /[A-Za-z0-9_-]/.test(c);
  let searchFrom = 0;
  for (;;) {
    const idx = text.indexOf(prefix, searchFrom);
    if (idx === -1) return false;
    const before = idx === 0 ? "" : text[idx - 1];
    const boundary = before === "" || !/[A-Za-z0-9]/.test(before);
    if (boundary) {
      let tail = 0;
      for (let i = idx + prefix.length; i < text.length && tailOk(text[i]); i++) {
        tail++;
      }
      if (tail >= minTail) return true;
    }
    searchFrom = idx + prefix.length;
  }
}

// Port of bot_skills.rs credential_shape_findings (labels only).
function credentialShapeFindings(text) {
  const out = [];
  if (text.includes("-----BEGIN ") && text.includes("PRIVATE KEY-----")) {
    out.push("private key material (PEM block)");
  }
  let openaiHit = false;
  for (const shape of CREDENTIAL_SHAPES) {
    if (shape.group === "openai") {
      if (!openaiHit && hasPrefixedToken(text, shape.prefix, shape.minTail)) {
        out.push(shape.label);
        openaiHit = true;
      }
      continue;
    }
    if (hasPrefixedToken(text, shape.prefix, shape.minTail)) {
      if (!out.includes(shape.label)) out.push(shape.label);
    }
  }
  return out;
}

// --- SKILL.md frontmatter (subset port of bot_skills.rs parse_skill_md) ---

function parseScalar(raw) {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  const hashIdx = v.indexOf(" #");
  return (hashIdx === -1 ? v : v.slice(0, hashIdx)).trimEnd();
}

function splitKeyValue(line) {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  if (key === "" || !/^[A-Za-z0-9_-]+$/.test(key)) return null;
  return [key, line.slice(idx + 1).trimStart()];
}

// Returns { frontmatter: {name?, description?, license?, compatibility?,
// allowedTools?}, body } or { error }.
function parseSkillMd(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if ((lines[0] ?? "").trim() !== "---") {
    return { error: "SKILL.md must start with a '---' frontmatter fence" };
  }
  const fmLines = [];
  let bodyStart = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      bodyStart = i + 1;
      break;
    }
    fmLines.push(lines[i]);
  }
  if (bodyStart === -1) {
    return { error: "SKILL.md frontmatter is never closed with '---'" };
  }
  const fm = {};
  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i++];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (line.startsWith(" ") || line.startsWith("\t")) continue;
    const kv = splitKeyValue(line);
    if (!kv) continue;
    const [key, rawValue] = kv;
    let value;
    if (["|", ">", "|-", "|+", ">-", ">+"].includes(rawValue)) {
      const folded = rawValue.startsWith(">");
      const parts = [];
      while (i < fmLines.length) {
        const next = fmLines[i];
        if (next.trim() === "") {
          parts.push("");
          i++;
          continue;
        }
        if (!next.startsWith(" ") && !next.startsWith("\t")) break;
        parts.push(next.trim());
        i++;
      }
      while (parts.length && parts[parts.length - 1] === "") parts.pop();
      value = folded ? parts.join(" ") : parts.join("\n");
    } else if (rawValue === "" && key === "metadata") {
      continue; // the map form carries nothing this validator reads
    } else {
      value = parseScalar(rawValue);
    }
    if (key === "name") fm.name = value;
    else if (key === "description") fm.description = value;
    else if (key === "license") fm.license = value;
    else if (key === "compatibility") fm.compatibility = value;
    else if (key === "allowed-tools") fm.allowedTools = value;
  }
  const body = lines.slice(bodyStart).join("\n").replace(/^\n+/, "");
  return { frontmatter: fm, body };
}

// validate_skill_md's hard rules (bot_skills.rs), minus its soft notes.
// `keyName` is the skill's key in the package's skills array — the spec
// requires frontmatter name == folder name; a package entry's array key
// plays the folder's role (DESIGN §5.5).
function validateSkillMd(text, keyName) {
  const errors = [];
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_MD_BYTES) {
    errors.push(
      `SKILL.md is ${Buffer.byteLength(text, "utf8")} bytes — over the ${MAX_SKILL_MD_BYTES}-byte import cap`,
    );
    return errors;
  }
  const parsed = parseSkillMd(text);
  if (parsed.error) return [parsed.error];
  const fm = parsed.frontmatter;
  if (!fm.name || fm.name.trim() === "") {
    errors.push("frontmatter must include a 'name'");
  } else {
    const n = fm.name.trim();
    const g = validateNameGrammar(n);
    if (g) errors.push(g.replaceAll("name", "skill name"));
    if (keyName !== undefined && keyName !== n) {
      errors.push(
        `frontmatter name '${n}' does not match its key in the package's skills array '${keyName}' (the spec requires them to be identical)`,
      );
    }
  }
  if (!fm.description || fm.description.trim() === "") {
    errors.push(
      "frontmatter must include a non-empty 'description' (what the skill does and when to use it)",
    );
  } else if (charCount(fm.description.trim()) > MAX_DESCRIPTION_CHARS) {
    errors.push(
      `description is ${charCount(fm.description.trim())} characters — the spec allows at most ${MAX_DESCRIPTION_CHARS}`,
    );
  }
  if (fm.compatibility && charCount(fm.compatibility) > MAX_COMPATIBILITY_CHARS) {
    errors.push(
      `compatibility is ${charCount(fm.compatibility)} characters — the spec allows at most ${MAX_COMPATIBILITY_CHARS}`,
    );
  }
  const bodyTokens = estTokens(parsed.body);
  if (bodyTokens > MAX_BODY_TOKENS) {
    errors.push(
      `the instruction body is ~${bodyTokens} tokens — over the ${MAX_BODY_TOKENS}-token import ceiling`,
    );
  }
  return errors;
}

// DESIGN §11 + §7.4: listings are Vietnamese or English only at launch,
// because the maintainer's own read is the one non-automatable gate.
// A CI script cannot judge language the way the maintainer does; this
// is a deliberately small pre-filter: Vietnamese (with its diacritics)
// always passes, plain Latin text passes unless it carries a cluster
// of function words distinctive to another language. The maintainer's
// read remains the real gate — this only stops the obvious cases from
// costing him a round-trip.
// Only characters that are distinctive to Vietnamese count as proof
// of Vietnamese: đ/ă/ơ/ư and the double-diacritic vowels. The plain
// Latin-1 accents (à, é, í…) are shared with French/Spanish/… and
// must NOT pass a French listing off as Vietnamese.
const VIETNAMESE_RE =
  /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹĂĐƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]/;
const OTHER_LANGUAGE_STOPWORDS = {
  French: ["le", "la", "les", "des", "une", "pour", "vous", "votre", "avec", "qui", "est", "dans", "aux", "chez", "sur"],
  German: ["der", "die", "das", "und", "für", "mit", "ist", "ein", "eine", "den", "von", "zu", "im", "sich", "nicht"],
  Spanish: ["el", "la", "los", "las", "para", "con", "una", "por", "que", "del", "los", "está", "como", "más", "pero"],
  Portuguese: ["o", "a", "os", "as", "para", "com", "uma", "por", "que", "do", "da", "em", "não", "como", "mais"],
  Italian: ["il", "lo", "la", "gli", "per", "con", "una", "che", "di", "del", "della", "sono", "come", "più", "anche"],
};

function listingLanguageProblem(text) {
  if (VIETNAMESE_RE.test(text)) return null;
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-zà-ÿ]+/i)
      .filter(Boolean),
  );
  for (const [lang, stops] of Object.entries(OTHER_LANGUAGE_STOPWORDS)) {
    const hits = stops.filter((w) => words.has(w));
    if (hits.length >= 3) {
      return `listing text looks like ${lang} (function words: ${hits.slice(0, 5).join(", ")}) — listings are accepted in Vietnamese or English only at launch (DESIGN §11); please provide a Vietnamese or English version`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Catalog snapshot loading
// ---------------------------------------------------------------------------

function readJsonFile(path) {
  const raw = readFileSync(path);
  try {
    return { raw, value: JSON.parse(raw.toString("utf8")), error: null };
  } catch (e) {
    return { raw, value: null, error: e.message };
  }
}

// A snapshot = { root, index: {version, bots[]} | null, indexError,
// packages: Map<relPath, {handle, slug, raw, value, parseError}> }.
function loadSnapshot(root) {
  const snap = { root, index: null, indexError: null, packages: new Map() };
  const indexPath = join(root, "bots.json");
  if (!existsSync(indexPath)) {
    snap.indexError = "bots.json not found";
    return snap;
  }
  const parsed = readJsonFile(indexPath);
  if (parsed.error) {
    snap.indexError = `bots.json does not parse: ${parsed.error}`;
  } else {
    snap.index = parsed.value;
  }
  const pkgRoot = join(root, "packages");
  if (existsSync(pkgRoot)) {
    for (const handle of readdirSync(pkgRoot)) {
      const handleDir = join(pkgRoot, handle);
      if (!statSync(handleDir).isDirectory()) continue;
      for (const file of readdirSync(handleDir)) {
        if (!file.endsWith(".json")) continue;
        const slug = file.slice(0, -".json".length);
        const rel = `packages/${handle}/${file}`;
        const p = readJsonFile(join(handleDir, file));
        snap.packages.set(rel, {
          handle,
          slug,
          rel,
          raw: p.raw,
          value: p.value,
          parseError: p.error,
        });
      }
    }
  }
  return snap;
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

const CHECK_NAMES = [
  "diff scope",
  "parse + schema",
  "identity + naming",
  "caps",
  "version discipline",
  "credential scan",
  "safety-pattern scan",
  "skill validation",
  "cross-consistency",
];

function runGate(opts) {
  const findings = []; // {check, level: 'error'|'warning', file?, message}
  const err = (check, message, file) => findings.push({ check, level: "error", message, file });
  const warn = (check, message, file) => findings.push({ check, level: "warning", message, file });
  const hasError = (check) => findings.some((f) => f.check === check && f.level === "error");

  const head = loadSnapshot(opts.root);
  const base = opts.baseRoot ? loadSnapshot(opts.baseRoot) : null;
  const prMode = Boolean(opts.author);
  const maintainers = opts.maintainers ?? DEFAULT_MAINTAINERS;
  const authorLower = opts.author?.toLowerCase();
  const isMaintainer = prMode && maintainers.includes(authorLower);

  const headEntries = Array.isArray(head.index?.bots) ? head.index.bots : [];
  const baseEntries = Array.isArray(base?.index?.bots) ? base.index.bots : [];
  const baseEntryByKey = new Map(baseEntries.map((e) => [e?.key, e]));

  // Keys the PR added or changed (for author-binding checks in PR mode).
  let changedKeys = null;
  if (prMode && base) {
    changedKeys = new Set();
    for (const e of headEntries) {
      const b = baseEntryByKey.get(e?.key);
      if (!b || JSON.stringify(b) !== JSON.stringify(e)) changedKeys.add(e?.key);
    }
    for (const e of baseEntries) {
      if (!headEntries.some((h) => h?.key === e?.key)) changedKeys.add(e?.key);
    }
  }

  // ---- Check 1: diff scope (PR mode only) -------------------------------
  if (prMode) {
    if (!opts.files) {
      err(1, "PR mode requires --files (the PR's changed-file list)");
    } else if (isMaintainer) {
      // Exempt per DESIGN §7.3 check 1 — noted in the report, not silent.
    } else {
      for (const path of opts.files) {
        if (path === "bots.json") continue;
        if (path.startsWith(`packages/${authorLower}/`)) continue;
        err(
          1,
          `PR touches '${path}' — a submission PR may only touch bots.json and its own packages/${authorLower}/ folder`,
          path,
        );
      }
      if (changedKeys) {
        for (const key of changedKeys) {
          if (typeof key === "string" && !key.startsWith(`gh-${authorLower}/`)) {
            err(
              1,
              `bots.json entry '${key}' was added/changed/removed but does not belong to the PR author (@${opts.author})`,
              "bots.json",
            );
          }
        }
      }
    }
  }

  // ---- Check 2: parse + schema -------------------------------------------
  if (!hasError(1)) {
    if (head.indexError) {
      err(2, head.indexError, "bots.json");
    } else {
      if (!isPlainObject(head.index)) {
        err(2, "bots.json must be a JSON object", "bots.json");
      } else {
        for (const f of Object.keys(head.index)) {
          if (!["version", "bots"].includes(f)) {
            err(2, `bots.json has unknown top-level field '${f}'`, "bots.json");
          }
        }
        if (head.index.version !== 1) {
          err(2, "bots.json 'version' must be 1", "bots.json");
        }
        if (!Array.isArray(head.index.bots)) {
          err(2, "bots.json 'bots' must be an array", "bots.json");
        }
      }
    }

    for (const entry of headEntries) {
      const at = `bots.json entry '${entry?.key ?? "?"}'`;
      if (!isPlainObject(entry)) {
        err(2, "bots.json entries must be objects", "bots.json");
        continue;
      }
      for (const f of Object.keys(entry)) {
        if (!INDEX_FIELDS.includes(f)) {
          err(2, `${at}: unknown field '${f}'`, "bots.json");
        }
      }
      for (const req of ["key", "name", "author", "description", "category", "version", "license", "price", "package", "sha256"]) {
        if (entry[req] === undefined) err(2, `${at}: missing required field '${req}'`, "bots.json");
      }
      if (typeof entry.key !== "string" || !/^gh-[^/]+\/[^/]+$/.test(entry.key ?? "")) {
        err(2, `${at}: 'key' must look like 'gh-<handle>/<slug>'`, "bots.json");
      }
      if (typeof entry.name !== "string" || entry.name.trim() === "") {
        err(2, `${at}: 'name' must be a non-empty string`, "bots.json");
      }
      if (!isPlainObject(entry.author)) {
        err(2, `${at}: 'author' must be an object {handle, name, url?}`, "bots.json");
      } else {
        for (const f of Object.keys(entry.author)) {
          if (!AUTHOR_FIELDS.includes(f)) err(2, `${at}: author has unknown field '${f}'`, "bots.json");
        }
        if (typeof entry.author.handle !== "string" || entry.author.handle === "") {
          err(2, `${at}: author.handle must be a non-empty string`, "bots.json");
        }
        if (typeof entry.author.name !== "string" || entry.author.name === "") {
          err(2, `${at}: author.name must be a non-empty string`, "bots.json");
        }
      }
      if (typeof entry.description !== "string") {
        err(2, `${at}: 'description' must be a string`, "bots.json");
      }
      if (!CATEGORIES.includes(entry.category)) {
        err(2, `${at}: category '${entry.category}' is not one of ${CATEGORIES.join(", ")}`, "bots.json");
      }
      if (!isSemver(entry.version)) {
        err(2, `${at}: version '${entry.version}' is not valid semver`, "bots.json");
      }
      if (typeof entry.license !== "string" || entry.license.trim() === "") {
        err(2, `${at}: 'license' must be declared and non-empty (mandatory since the 2026-11-12 ruling)`, "bots.json");
      }
      if (!isPlainObject(entry.price)) {
        err(2, `${at}: 'price' must be an object {amount, currency}`, "bots.json");
      } else {
        for (const f of Object.keys(entry.price)) {
          if (!PRICE_FIELDS.includes(f)) err(2, `${at}: price has unknown field '${f}'`, "bots.json");
        }
        if (typeof entry.price.amount !== "number") {
          err(2, `${at}: price.amount must be a number`, "bots.json");
        }
        if (typeof entry.price.currency !== "string" || entry.price.currency === "") {
          err(2, `${at}: price.currency must be a non-empty string`, "bots.json");
        }
      }
      if (typeof entry.package !== "string" || !/^packages\/[^/]+\/[^/]+\.json$/.test(entry.package ?? "")) {
        err(2, `${at}: 'package' must be a path like 'packages/<handle>/<slug>.json'`, "bots.json");
      }
      if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
        err(2, `${at}: 'sha256' must be 64 lowercase hex characters`, "bots.json");
      }
      if (entry.featured !== undefined && typeof entry.featured !== "boolean") {
        err(2, `${at}: 'featured' must be a boolean`, "bots.json");
      }
    }

    for (const pkg of head.packages.values()) {
      const at = pkg.rel;
      if (pkg.parseError) {
        err(2, `package does not parse: ${pkg.parseError}`, at);
        continue;
      }
      const p = pkg.value;
      if (!isPlainObject(p)) {
        err(2, "package must be a JSON object", at);
        continue;
      }
      for (const f of Object.keys(p)) {
        if (CANNOT_CARRY_FIELDS.includes(f)) {
          err(
            2,
            `package carries '${f}' — that is on the cannot-carry list (DESIGN §5.3): credentials, bindings, provider/model, SSH grants and owner-only data never travel in a package`,
            at,
          );
        } else if (!PACKAGE_FIELDS.includes(f)) {
          err(2, `package has unknown top-level field '${f}' (the schema is closed — DESIGN §5.2/§5.3)`, at);
        }
      }
      if (p.format !== "boom.bot-package") {
        err(2, `package 'format' must be "boom.bot-package" (got ${JSON.stringify(p.format)})`, at);
      }
      if (p.format_version !== 1) {
        err(2, `package 'format_version' must be 1 (got ${JSON.stringify(p.format_version)})`, at);
      }
      for (const req of ["key", "version", "name", "description", "instructions", "avatar_variant", "avatar_color", "author", "category", "license", "price"]) {
        if (p[req] === undefined) err(2, `package is missing required field '${req}'`, at);
      }
      if (typeof p.key !== "string" || p.key === "") {
        err(2, "package 'key' must be a non-empty string (the slug)", at);
      }
      if (!isSemver(p.version)) {
        err(2, `package version '${p.version}' is not valid semver`, at);
      }
      if (typeof p.name !== "string" || p.name.trim() === "") {
        err(2, "package 'name' must be a non-empty string", at);
      }
      if (typeof p.description !== "string") {
        err(2, "package 'description' must be a string", at);
      }
      if (typeof p.instructions !== "string") {
        err(2, "package 'instructions' must be a string", at);
      }
      if (typeof p.avatar_variant !== "string" || p.avatar_variant === "") {
        err(2, "package 'avatar_variant' must be a non-empty string (a Rogue variant name, never an image)", at);
      }
      if (typeof p.avatar_color !== "string" || p.avatar_color === "") {
        err(2, "package 'avatar_color' must be a non-empty string", at);
      }
      if (p.allowed_tools !== undefined && !(Array.isArray(p.allowed_tools) && p.allowed_tools.length === 0)) {
        err(
          2,
          "package 'allowed_tools' must be absent or [] — since 2026-11-09 every bot uses every tool; a package may not fossilize a tool list (DESIGN §5.2)",
          at,
        );
      }
      for (const arr of ["denied_tools", "skill_names", "requires"]) {
        if (p[arr] !== undefined && !isStringArray(p[arr])) {
          err(2, `package '${arr}' must be an array of strings`, at);
        }
      }
      if (!CATEGORIES.includes(p.category)) {
        err(2, `package category '${p.category}' is not one of ${CATEGORIES.join(", ")}`, at);
      }
      if (typeof p.license !== "string" || p.license.trim() === "") {
        err(2, "package 'license' must be declared and non-empty (mandatory since the 2026-11-12 ruling; MIT is the pre-filled suggestion)", at);
      }
      if (!isPlainObject(p.author)) {
        err(2, "package 'author' must be an object {handle, name, url?}", at);
      } else {
        for (const f of Object.keys(p.author)) {
          if (!AUTHOR_FIELDS.includes(f)) err(2, `package author has unknown field '${f}'`, at);
        }
        if (typeof p.author.handle !== "string" || p.author.handle === "") {
          err(2, "package author.handle must be a non-empty string", at);
        }
        if (typeof p.author.name !== "string" || p.author.name === "") {
          err(2, "package author.name must be a non-empty string", at);
        }
        if (p.author.url !== undefined && typeof p.author.url !== "string") {
          err(2, "package author.url must be a string", at);
        }
      }
      if (!isPlainObject(p.price)) {
        err(2, "package 'price' must be an object {amount, currency} (dormant payments seam, DESIGN §12)", at);
      } else {
        for (const f of Object.keys(p.price)) {
          if (!PRICE_FIELDS.includes(f)) err(2, `package price has unknown field '${f}'`, at);
        }
        if (typeof p.price.amount !== "number") {
          err(2, "package price.amount must be a number", at);
        }
        if (typeof p.price.currency !== "string" || p.price.currency === "") {
          err(2, "package price.currency must be a non-empty string", at);
        }
      }
      for (const opt of ["example", "does", "does_not"]) {
        if (p[opt] !== undefined && typeof p[opt] !== "string") {
          err(2, `package '${opt}' must be a string`, at);
        }
      }
      if (p.skills !== undefined) {
        if (!Array.isArray(p.skills)) {
          err(2, "package 'skills' must be an array of {name, skill_md}", at);
        } else {
          for (const s of p.skills) {
            if (!isPlainObject(s)) {
              err(2, "each bundled skill must be an object {name, skill_md}", at);
              continue;
            }
            for (const f of Object.keys(s)) {
              if (!SKILL_FIELDS.includes(f)) {
                err(2, `bundled skill '${s.name ?? "?"}' has unknown field '${f}' — v1 bundles are SKILL.md text only (DESIGN §5.5)`, at);
              }
            }
            if (typeof s.name !== "string" || typeof s.skill_md !== "string") {
              err(2, "each bundled skill needs string 'name' and 'skill_md'", at);
            }
          }
        }
      }
      if (p.routines !== undefined) {
        if (!Array.isArray(p.routines)) {
          err(2, "package 'routines' must be an array", at);
        } else {
          for (const r of p.routines) {
            if (!isPlainObject(r)) {
              err(2, "each routine must be an object {name, prompt, schedule|trigger}", at);
              continue;
            }
            for (const f of Object.keys(r)) {
              if (!ROUTINE_FIELDS.includes(f)) {
                err(
                  2,
                  `routine '${r.name ?? "?"}' has unknown field '${f}' — routines travel as data only: name, prompt, and a schedule or trigger kind (never deliver_to, accept_mode, enabled or webhook data — DESIGN §5.6)`,
                  at,
                );
              }
            }
            if (typeof r.name !== "string" || r.name === "" || typeof r.prompt !== "string") {
              err(2, "each routine needs a non-empty string 'name' and a string 'prompt'", at);
            }
            const hasSchedule = r.schedule !== undefined;
            const hasTrigger = r.trigger !== undefined;
            if (hasSchedule === hasTrigger) {
              err(2, `routine '${r.name ?? "?"}' must carry exactly one of 'schedule' or 'trigger'`, at);
            }
            if (hasSchedule) {
              const s = r.schedule;
              if (!isPlainObject(s)) {
                err(2, `routine '${r.name}' schedule must be an object (the CronSchedule shape)`, at);
              } else if (s.kind === "every_minutes") {
                if (!Number.isInteger(s.minutes) || s.minutes <= 0) {
                  err(2, `routine '${r.name}' schedule every_minutes needs a positive integer 'minutes'`, at);
                }
              } else if (s.kind === "daily_at") {
                if (typeof s.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) {
                  err(2, `routine '${r.name}' schedule daily_at needs 'time' as HH:MM`, at);
                }
              } else if (s.kind === "weekly_at") {
                if (
                  !Array.isArray(s.weekdays) ||
                  s.weekdays.length === 0 ||
                  !s.weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) ||
                  typeof s.time !== "string" ||
                  !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)
                ) {
                  err(2, `routine '${r.name}' schedule weekly_at needs 'weekdays' (1–7) and 'time' as HH:MM`, at);
                }
              } else {
                err(2, `routine '${r.name}' schedule kind '${s.kind}' is not one of every_minutes, daily_at, weekly_at`, at);
              }
            }
            if (hasTrigger) {
              const t = r.trigger;
              if (!isPlainObject(t)) {
                err(2, `routine '${r.name}' trigger must be an object {trigger, channel}`, at);
              } else {
                for (const f of Object.keys(t)) {
                  if (!TRIGGER_FIELDS.includes(f)) {
                    err(2, `routine '${r.name}' trigger has unknown field '${f}' — kind and channel name only (DESIGN §5.6)`, at);
                  }
                }
                if (t.trigger !== "channel_message") {
                  err(2, `routine '${r.name}' trigger kind must be "channel_message" in v1`, at);
                }
                if (typeof t.channel !== "string" || t.channel === "") {
                  err(2, `routine '${r.name}' trigger needs a channel name`, at);
                }
              }
            }
          }
        }
      }
      // Listing language (DESIGN §11): Vietnamese or English only.
      if (typeof p.name === "string" && typeof p.description === "string" && typeof p.instructions === "string") {
        const problem = listingLanguageProblem(`${p.name}\n${p.description}\n${p.instructions}`);
        if (problem) err(2, problem, at);
      }
    }
  }

  // ---- Check 3: identity + naming ----------------------------------------
  if (!hasError(2)) {
    const seenKeys = new Map();
    for (const entry of headEntries) {
      if (typeof entry?.key !== "string") continue;
      if (seenKeys.has(entry.key)) {
        err(3, `duplicate listing key '${entry.key}' in bots.json`, "bots.json");
      }
      seenKeys.set(entry.key, entry);
    }
    for (const pkg of head.packages.values()) {
      const p = pkg.value;
      const at = pkg.rel;
      const handleErr = validateHandleGrammar(p.author.handle);
      if (handleErr) err(3, handleErr, at);
      if (p.author.handle !== pkg.handle) {
        err(
          3,
          `author.handle '${p.author.handle}' does not match the folder name '${pkg.handle}' — handle (lowercase) == folder == package path`,
          at,
        );
      }
      const slugErr = validateNameGrammar(p.key);
      if (slugErr) err(3, slugErr.replace("name", "slug"), at);
      if (p.key !== pkg.slug) {
        err(3, `package key '${p.key}' does not match its file name '${pkg.slug}.json'`, at);
      }
      const fullKey = `gh-${pkg.handle}/${pkg.slug}`;
      if (BUILTIN_KEYS.includes(fullKey)) {
        err(3, `listing key '${fullKey}' collides with a builtin bot key`, at);
      }
      if (RESERVED_CLAIMS.includes(pkg.handle.toLowerCase())) {
        err(3, `handle '${pkg.handle}' claims a reserved name (DESIGN §11)`, at);
      }
      for (const [what, text] of [
        ["bot name", p.name],
        ["author name", p.author.name],
      ]) {
        const lower = String(text).toLowerCase();
        for (const claim of RESERVED_CLAIMS) {
          const re = new RegExp(`(^|[^a-z0-9])${claim.replace(/[- ]/g, "[- ]")}([^a-z0-9]|$)`);
          if (re.test(lower)) {
            err(3, `${what} '${text}' claims the reserved name '${claim}' (DESIGN §11)`, at);
            break;
          }
        }
      }
      if (p.author.url !== undefined && p.author.url !== `https://github.com/${p.author.handle}`) {
        err(3, `author.url must be the handle's own GitHub profile (https://github.com/${p.author.handle})`, at);
      }
      if (prMode && changedKeys && !isMaintainer) {
        if (changedKeys.has(fullKey) && p.author.handle.toLowerCase() !== authorLower) {
          err(3, `package author.handle '${p.author.handle}' is not the PR author (@${opts.author})`, at);
        }
      }
    }
    for (const entry of headEntries) {
      if (typeof entry?.key !== "string") continue;
      const pkg = head.packages.get(entry.package);
      if (pkg && pkg.value) {
        const derived = `gh-${pkg.handle}/${pkg.value.key}`;
        if (entry.key !== derived) {
          err(3, `index key '${entry.key}' disagrees with its package (derived key '${derived}')`, "bots.json");
        }
      }
    }
  }

  // ---- Check 4: caps -------------------------------------------------------
  if (!hasError(3)) {
    for (const pkg of head.packages.values()) {
      const p = pkg.value;
      const at = pkg.rel;
      if (pkg.raw.length > MAX_PACKAGE_BYTES) {
        err(4, `package is ${pkg.raw.length} bytes — over the ${MAX_PACKAGE_BYTES}-byte (512 KiB) cap`, at);
      }
      if (typeof p.description === "string" && charCount(p.description) > MAX_DESCRIPTION_CHARS) {
        err(4, `description is ${charCount(p.description)} characters — the cap is ${MAX_DESCRIPTION_CHARS} (DESIGN §5.2)`, at);
      }
      if (typeof p.instructions === "string" && estTokens(p.instructions) > MAX_BODY_TOKENS) {
        err(4, `instructions are ~${estTokens(p.instructions)} tokens — over the ${MAX_BODY_TOKENS}-token cap (DESIGN §5.2)`, at);
      }
      if (Array.isArray(p.skills)) {
        if (p.skills.length > MAX_BUNDLED_SKILLS) {
          err(4, `package bundles ${p.skills.length} skills — the cap is ${MAX_BUNDLED_SKILLS} (a bot, not a suite)`, at);
        }
        for (const s of p.skills) {
          if (typeof s.skill_md === "string" && Buffer.byteLength(s.skill_md, "utf8") > MAX_SKILL_MD_BYTES) {
            err(4, `bundled skill '${s.name}' SKILL.md is over the ${MAX_SKILL_MD_BYTES}-byte cap`, at);
          }
        }
      }
      if (Array.isArray(p.routines) && p.routines.length > MAX_ROUTINES) {
        err(4, `package suggests ${p.routines.length} routines — the cap is ${MAX_ROUTINES}`, at);
      }
    }
  }

  // ---- Check 5: version discipline ----------------------------------------
  if (!hasError(4) && base) {
    for (const pkg of head.packages.values()) {
      const at = pkg.rel;
      const basePkg = base.packages.get(pkg.rel);
      if (!basePkg || !basePkg.value) continue; // new listing: any valid semver
      if (basePkg.raw.equals(pkg.raw)) continue; // bytes unchanged: no bump owed
      const entry = seenEntry(headEntries, pkg);
      const baseEntry = baseEntryByKey.get(entry?.key);
      if (compareSemver(pkg.value.version, basePkg.value.version) <= 0) {
        err(
          5,
          `package bytes changed but version '${pkg.value.version}' is not strictly greater than the version on main ('${basePkg.value.version}') — any content change is a new version (DESIGN §5.4)`,
          at,
        );
      }
      if (entry && baseEntry && compareSemver(entry.version, baseEntry.version) <= 0) {
        err(5, `index version for '${entry.key}' must also be bumped past '${baseEntry.version}'`, "bots.json");
      }
      if (entry && entry.sha256 !== sha256Hex(pkg.raw)) {
        err(5, `index sha256 for '${entry.key}' does not match the new package bytes — the entry must be updated in the same PR`, "bots.json");
      }
    }
  }

  function seenEntry(entries, pkg) {
    return entries.find((e) => e?.package === pkg.rel);
  }

  // ---- Check 6: credential scan (Block tier) ------------------------------
  if (!hasError(5)) {
    for (const pkg of head.packages.values()) {
      const text = pkg.raw.toString("utf8");
      for (const label of credentialShapeFindings(text)) {
        err(6, `package contains ${label} — credentials never travel in a package (DESIGN §5.3)`, pkg.rel);
      }
    }
  }

  // ---- Check 7: safety-pattern scan (split tier) ---------------------------
  if (!hasError(6)) {
    for (const pkg of head.packages.values()) {
      const lower = pkg.raw.toString("utf8").toLowerCase();
      for (const [pat, label] of SAFEGUARD_FAIL_PATTERNS) {
        if (lower.includes(pat)) {
          err(7, `safety pattern (${label}): '${pat}' — a listing may not instruct a bot to bypass, weaken or conceal actions from Boom's safeguards or its owner (DESIGN §11)`, pkg.rel);
        }
      }
      for (const [pat, label] of WARN_PATTERNS) {
        if (lower.includes(pat)) {
          warn(7, `pattern (${label}): '${pat}' — maintainer: please eyeball this in review`, pkg.rel);
        }
      }
    }
  }

  // ---- Check 8: skill validation -------------------------------------------
  if (!hasError(7)) {
    for (const pkg of head.packages.values()) {
      const p = pkg.value;
      const at = pkg.rel;
      const bundledNames = new Set();
      if (Array.isArray(p.skills)) {
        for (const s of p.skills) {
          if (typeof s.name !== "string" || typeof s.skill_md !== "string") continue;
          if (bundledNames.has(s.name)) {
            err(8, `bundled skill name '${s.name}' appears twice in one package`, at);
          }
          bundledNames.add(s.name);
          if (SHIPPED_SKILL_NAMES.includes(s.name)) {
            err(
              8,
              `bundled skill '${s.name}' collides with a skill Boom ships — a marketplace install may not silently shadow a shipped skill (DESIGN §5.5)`,
              at,
            );
          }
          for (const e of validateSkillMd(s.skill_md, s.name)) {
            err(8, `bundled skill '${s.name}': ${e}`, at);
          }
        }
      }
      if (Array.isArray(p.skill_names)) {
        for (const name of p.skill_names) {
          if (!bundledNames.has(name) && !SHIPPED_SKILL_NAMES.includes(name)) {
            err(
              8,
              `skill_names references '${name}', which is neither bundled by this package nor a skill Boom ships — a dangling reference would silently no-op on the receiver's machine (DESIGN §5.2)`,
              at,
            );
          }
        }
      }
      if (Array.isArray(p.requires)) {
        for (const name of p.requires) {
          if (!CONNECTOR_IDS.includes(name) && !CHANNEL_IDS.includes(name)) {
            warn(
              8,
              `requires names '${name}', which is not a known connector/channel id — warn-only by design (DESIGN §7.3 note b); the app renders requires names verbatim`,
              at,
            );
          }
        }
      }
    }
  }

  // ---- Check 9: cross-consistency -------------------------------------------
  if (!hasError(8)) {
    const pointedPaths = new Set();
    for (const entry of headEntries) {
      if (!isPlainObject(entry)) continue;
      const at = "bots.json";
      const pkg = head.packages.get(entry.package);
      if (!pkg) {
        err(9, `index entry '${entry.key}' points at '${entry.package}', which does not exist`, at);
        continue;
      }
      pointedPaths.add(entry.package);
      if (pkg.value) {
        if (entry.version !== pkg.value.version) {
          err(9, `index version '${entry.version}' for '${entry.key}' disagrees with the package version '${pkg.value.version}'`, at);
        }
        if (isPlainObject(pkg.value.price) && pkg.value.price.amount !== 0) {
          err(9, `package '${entry.key}' has price.amount ${pkg.value.price.amount} — CI rejects any non-zero amount until payments ship (DESIGN §5.2)`, pkg.rel);
        }
      }
      if (entry.price?.amount !== 0) {
        err(9, `index entry '${entry.key}' has price.amount ${entry.price?.amount} — non-zero prices are rejected until payments ship`, at);
      }
      if (entry.sha256 !== sha256Hex(pkg.raw)) {
        err(9, `index sha256 for '${entry.key}' does not match the package file bytes`, at);
      }
      // featured is maintainer-only (DESIGN §7.2): in PR mode, a
      // non-maintainer PR may not introduce featured: true on an
      // entry that did not already carry it on main. (Without a PR
      // context there is no "self" to grant it, so the check is
      // PR-mode only.)
      const baseEntry = baseEntryByKey.get(entry.key);
      if (
        prMode &&
        !isMaintainer &&
        base &&
        entry.featured === true &&
        baseEntry?.featured !== true
      ) {
        err(9, `index entry '${entry.key}' sets featured: true — Featured is maintainer-only and cannot be requested into existence (DESIGN §7.2)`, at);
      }
    }
    for (const pkg of head.packages.values()) {
      if (!pointedPaths.has(pkg.rel)) {
        err(9, `package file '${pkg.rel}' has no index entry in bots.json (orphan file)`, pkg.rel);
      }
    }
  }

  return { findings, head, base, prMode, isMaintainer };
}

// ---------------------------------------------------------------------------
// CLI + reporting
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { root: ".", baseRoot: null, author: null, files: null, maintainers: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") opts.root = argv[++i];
    else if (a === "--base-root") opts.baseRoot = argv[++i];
    else if (a === "--author") opts.author = argv[++i];
    else if (a === "--files") {
      opts.files = readFileSync(argv[++i], "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--maintainers") {
      opts.maintainers = argv[++i].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/validate-bots.mjs [--root DIR] [--base-root DIR] [--author LOGIN] [--files LIST] [--maintainers a,b]",
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function escapeAnnotation(s) {
  return String(s).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inActions = process.env.GITHUB_ACTIONS === "true";
  const { findings, head, prMode, isMaintainer } = runGate(opts);

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  const failedChecks = [...new Set(errors.map((f) => f.check))].sort((a, b) => a - b);
  const firstFailed = failedChecks[0] ?? null;

  const mode = prMode ? `PR by @${opts.author}${isMaintainer ? " (maintainer)" : ""}` : "local snapshot";
  console.log(`validate-bots: ${mode}, root=${opts.root}${opts.baseRoot ? `, base=${opts.baseRoot}` : ""}`);
  for (let c = 1; c <= 9; c++) {
    let status;
    if (c === 1 && !prMode) status = "skipped (no PR context)";
    else if (c === 5 && !opts.baseRoot) status = "skipped (no base snapshot)";
    else if (errors.some((f) => f.check === c)) status = "FAIL";
    else if (firstFailed !== null && c > firstFailed) status = "not reached (fail-fast)";
    else status = "OK";
    const w = warnings.filter((f) => f.check === c).length;
    console.log(`check ${c}/9 ${CHECK_NAMES[c - 1]} — ${status}${w ? ` (${w} warning${w === 1 ? "" : "s"})` : ""}`);
  }
  for (const f of findings) {
    const where = f.file ? `${f.file}: ` : "";
    console.log(`${f.level === "error" ? "ERROR" : "WARN "} [check ${f.check}] ${where}${f.message}`);
    if (inActions) {
      const kind = f.level === "error" ? "error" : "warning";
      const fileProp = f.file ? ` file=${escapeAnnotation(f.file)},` : "";
      console.log(
        `::${kind}${fileProp}title=validate-bots check ${f.check} (${CHECK_NAMES[f.check - 1]})::${escapeAnnotation(`[check ${f.check}] ${f.message}`)}`,
      );
    }
  }
  const pkgCount = head.packages.size;
  const verdict = errors.length === 0 ? "PASS" : `FAIL at check ${firstFailed} (${CHECK_NAMES[firstFailed - 1]})`;
  console.log(
    `RESULT: ${verdict} — ${pkgCount} package${pkgCount === 1 ? "" : "s"}, ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `## validate-bots — ${verdict}`,
      "",
      `Mode: ${mode}. Packages in snapshot: ${pkgCount}.`,
      "",
    ];
    if (errors.length) {
      lines.push("### Errors", "");
      for (const f of errors) lines.push(`- **[check ${f.check} — ${CHECK_NAMES[f.check - 1]}]** ${f.file ? `\`${f.file}\`: ` : ""}${f.message}`);
      lines.push("");
    }
    if (warnings.length) {
      lines.push("### Warnings (never blocking — for the maintainer's read)", "");
      for (const f of warnings) lines.push(`- **[check ${f.check} — ${CHECK_NAMES[f.check - 1]}]** ${f.file ? `\`${f.file}\`: ` : ""}${f.message}`);
      lines.push("");
    }
    import("node:fs").then(({ appendFileSync }) => {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
    });
  }

  process.exit(errors.length === 0 ? 0 : 1);
}

main();

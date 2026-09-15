const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { readCookies } = require("./safeCookies");

const SERVICE = "Claude Code-credentials";
const OAUTH_USAGE = "https://api.anthropic.com/api/oauth/usage";

function parseDate(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(ms) ? ms : null;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function fromPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const oauth = raw.claudeAiOauth || raw.claude_ai_oauth;
  if (!oauth) return null;
  const token = oauth.accessToken || oauth.access_token;
  if (!token) return null;
  const exp = parseDate(oauth.expiresAt || oauth.expires_at);
  return {
    kind: "oauth",
    token,
    expiresAt: exp,
    plan: oauth.subscriptionType || oauth.subscription_type || null,
  };
}

function readKeychain(service) {
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      timeout: 30_000,
    }).trim();
    if (!out) return null;
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function configDirs(extraDir) {
  if (extraDir) return [extraDir];
  const dirs = [];
  if (process.env.CLAUDE_CONFIG_DIR) dirs.push(process.env.CLAUDE_CONFIG_DIR);
  dirs.push(path.join(os.homedir(), ".claude"));
  return dirs;
}

function discoverProfiles() {
  const home = os.homedir();
  const out = [{ id: "claude", displayName: "Claude", dir: path.join(home, ".claude") }];
  let names = [];
  try {
    names = fs.readdirSync(home);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!name.startsWith(".claude-") || name.length < 9) continue;
    const dir = path.join(home, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const slug = name.slice(8);
    out.push({ id: `claude-${slug}`, displayName: `Claude (${slug})`, dir });
  }
  return out;
}

function loadOAuth(extraDir) {
  for (const dir of configDirs(extraDir)) {
    const fromFile =
      fromPayload(readJson(path.join(dir, ".credentials.json"))) ||
      fromPayload(readJson(path.join(dir, "credentials.json")));
    if (fromFile) return fromFile;
  }
  if (extraDir) return null;
  const homeFile = fromPayload(readJson(path.join(os.homedir(), ".claude.json")));
  if (homeFile) return homeFile;
  return fromPayload(readKeychain(SERVICE));
}

function loadDesktopSession() {
  const cookies = readCookies("Claude", {
    service: "Claude Safe Storage",
    account: "Claude Key",
    hostLike: "claude.ai",
  });
  if (!cookies.sessionKey) return null;
  return {
    kind: "desktop",
    cookies,
    org: cookies.lastActiveOrg || null,
  };
}

function loadCredentials(extraDir) {
  const oauth = loadOAuth(extraDir);
  if (oauth) {
    if (oauth.expiresAt && oauth.expiresAt <= Date.now()) {
      throw Object.assign(new Error("credentialExpired"), { code: "credentialExpired" });
    }
    return oauth;
  }
  if (extraDir && extraDir !== path.join(os.homedir(), ".claude")) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  const desktop = loadDesktopSession();
  if (desktop) return desktop;
  throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
}

function labelForKind(kind) {
  switch (kind) {
    case "session":
      return "Current session";
    case "weekly_all":
      return "All models";
    case "weekly_opus":
      return "Opus";
    case "weekly_sonnet":
      return "Sonnet";
    default:
      return String(kind)
        .replace(/^weekly_/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function rank(id) {
  if (id === "session") return 0;
  if (id === "weekly_all") return 1;
  return 2;
}

function windowsFromUsage(json) {
  if (!json || typeof json !== "object") return [];
  const windows = [];
  const seen = new Set();

  for (const limit of json.limits || []) {
    const resetsAt = parseDate(limit.resets_at || limit.resetsAt);
    if (!resetsAt || typeof limit.percent !== "number") continue;
    const id = limit.kind;
    windows.push({
      id,
      label: labelForKind(id),
      usedFraction: limit.percent / 100,
      resetsAt,
    });
    seen.add(id);
  }

  function merge(window, id, label) {
    if (!window || seen.has(id)) return;
    const resetsAt = parseDate(window.resets_at || window.resetsAt);
    const used =
      typeof window.utilization === "number"
        ? window.utilization
        : typeof window.percent === "number"
          ? window.percent
          : typeof window.used_percent === "number"
            ? window.used_percent
            : null;
    if (!resetsAt || used == null) return;
    windows.push({
      id,
      label,
      usedFraction: used > 1 ? used / 100 : used,
      resetsAt,
    });
    seen.add(id);
  }

  merge(json.five_hour || json.fiveHour, "session", "Current session");
  merge(json.seven_day || json.sevenDay, "weekly_all", "All models");
  merge(json.seven_day_opus || json.sevenDayOpus, "weekly_opus", "Opus");

  windows.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  return windows;
}

function cookieHeader(cookies) {
  return Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchOAuthUsage(token) {
  const res = await fetch(OAUTH_USAGE, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
    },
  });
  return res;
}

async function fetchDesktopUsage(session) {
  const headers = {
    Cookie: cookieHeader(session.cookies),
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Referer: "https://claude.ai/settings/usage",
  };

  let org = session.org;
  if (!org) {
    const boot = await fetch("https://claude.ai/api/bootstrap", { headers });
    if (boot.ok) {
      const json = await boot.json();
      const orgs = json.account?.organizations || json.organizations || [];
      org = orgs[0]?.uuid || orgs[0]?.id || json.default_organization_uuid || null;
    }
  }
  if (!org) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }

  const urls = [
    `https://claude.ai/api/organizations/${org}/usage`,
    `https://claude.ai/api/organizations/${org}/limits`,
    OAUTH_USAGE,
  ];
  let last = null;
  for (const url of urls) {
    const res = await fetch(url, { headers });
    last = res;
    if (res.ok) return res;
    if (res.status === 401 || res.status === 403) continue;
  }
  return last;
}

async function fetchSnapshot(profile = { id: "claude", displayName: "Claude" }) {
  const creds = loadCredentials(profile.dir);
  const res =
    creds.kind === "oauth" ? await fetchOAuthUsage(creds.token) : await fetchDesktopUsage(creds);

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  if (res.status === 429) {
    throw Object.assign(new Error("rateLimited"), { code: "rateLimited", retryAfter: 60 });
  }
  if (!res.ok) {
    throw Object.assign(new Error("badResponse"), { code: "badResponse", status: res.status });
  }
  const json = await res.json();
  const windows = windowsFromUsage(json);
  if (!windows.length) {
    throw Object.assign(new Error("nothingMetered"), { code: "nothingMetered" });
  }
  return {
    id: profile.id || "claude",
    displayName: profile.displayName || "Claude",
    letter: "C",
    status: "ok",
    plan: creds.plan || null,
    windows,
    headlineID: "session",
    manageURL: "https://claude.ai/settings/usage",
  };
}

module.exports = { fetchSnapshot, discoverProfiles };

const fs = require("fs");
const os = require("os");
const path = require("path");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isZai(host) {
  return host === "api.z.ai" || host.endsWith(".z.ai") || host === "open.bigmodel.cn" || host.endsWith(".bigmodel.cn");
}

function consoleBase(host) {
  return host && host.endsWith("bigmodel.cn") ? "https://open.bigmodel.cn" : "https://api.z.ai";
}

function loadCredentials() {
  const home = os.homedir();
  const claude = readJson(path.join(home, ".claude", "settings.json"));
  const env = claude?.env || {};
  const claudeToken = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (claudeToken && env.ANTHROPIC_BASE_URL) {
    try {
      const host = new URL(env.ANTHROPIC_BASE_URL).host;
      if (isZai(host)) return { token: claudeToken, base: consoleBase(host) };
    } catch {
      /* ignore */
    }
  }

  const zcode = readJson(path.join(home, ".zcode", "v2", "config.json"));
  const providers = zcode?.provider || {};
  for (const [id, provider] of Object.entries(providers)) {
    if (!id.includes("coding-plan") || !provider || provider.enabled === false) continue;
    const key = provider.options?.apiKey;
    if (!key) continue;
    let host = "api.z.ai";
    try {
      if (provider.options.baseURL) host = new URL(provider.options.baseURL).host;
    } catch {
      /* keep default */
    }
    return { token: key, base: consoleBase(host) };
  }

  const oc = readJson(path.join(home, ".local/share/opencode/auth.json")) || {};
  for (const id of ["zai-coding-plan", "zai", "z-ai", "z.ai", "zhipu", "zhipuai"]) {
    const entry = oc[id];
    if (!entry) continue;
    const token =
      typeof entry === "string"
        ? entry
        : entry.apiKey || entry.api_key || entry.token || entry.key || entry.accessToken;
    if (token) return { token, base: id.startsWith("zhipu") ? "https://open.bigmodel.cn" : "https://api.z.ai" };
  }

  throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
}

function windowId(limit) {
  if (limit.type === "TIME_LIMIT") return "mcp";
  if (limit.unit === 3 && limit.number === 5) return "session";
  if (limit.unit === 6 && limit.number === 1) return "weekly";
  if (limit.unit && limit.number) return `window-${limit.unit}x${limit.number}`;
  return (limit.type || "unknown").toLowerCase();
}

function windowLabel(id, limit) {
  if (id === "session") return "Current session";
  if (id === "weekly") return "Weekly";
  if (id === "mcp") return "MCP (1 month)";
  return "Usage";
}

async function fetchSnapshot() {
  const creds = loadCredentials();
  const res = await fetch(`${creds.base}/api/monitor/usage/quota/limit`, {
    headers: { Authorization: `Bearer ${creds.token}`, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  if (!res.ok) throw Object.assign(new Error("badResponse"), { code: "badResponse", status: res.status });
  const json = await res.json();
  if (json.success === false || (json.code && json.code !== 200)) {
    const code = json.code === 401 || json.code === 403 ? "needsAuth" : "badResponse";
    throw Object.assign(new Error(code), { code });
  }
  const limits = json.data?.limits || [];
  const windows = limits
    .filter((l) => typeof l.percentage === "number")
    .map((l) => ({
      id: windowId(l),
      label: windowLabel(windowId(l), l),
      usedFraction: l.percentage / 100,
      resetsAt: typeof l.nextResetTime === "number" ? l.nextResetTime : null,
    }));
  if (!windows.length) throw Object.assign(new Error("nothingMetered"), { code: "nothingMetered" });
  return {
    id: "glm",
    displayName: "GLM",
    status: "ok",
    plan: json.data?.level || null,
    windows,
    headlineID: "session",
    manageURL: "https://z.ai",
  };
}

module.exports = { fetchSnapshot };

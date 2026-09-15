const fs = require("fs");
const os = require("os");
const path = require("path");

const AUTH = path.join(os.homedir(), ".local/share/opencode/auth.json");
const USAGE = "https://opencode.ai/zen/go/v1/usage";

function loadToken() {
  if (!fs.existsSync(AUTH)) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  const root = JSON.parse(fs.readFileSync(AUTH, "utf8"));
  const entry = root["opencode-go"];
  if (!entry) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  const token =
    typeof entry === "string"
      ? entry
      : entry.key || entry.apiKey || entry.api_key || entry.token || entry.accessToken;
  if (!token) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  return token;
}

function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

async function fetchSnapshot() {
  const token = loadToken();
  const res = await fetch(USAGE, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  if (!res.ok) throw Object.assign(new Error("badResponse"), { code: "badResponse", status: res.status });
  const json = await res.json();
  const usage = json.usage || {};
  const windows = [
    ["rolling", "5h limit"],
    ["weekly", "Weekly limit"],
    ["monthly", "Monthly limit"],
  ]
    .filter(([id]) => usage[id] && typeof usage[id].percent === "number")
    .map(([id, label]) => ({
      id,
      label,
      usedFraction: usage[id].percent / 100,
      resetsAt: parseDate(usage[id].resetsAt),
    }));
  if (!windows.length) throw Object.assign(new Error("nothingMetered"), { code: "nothingMetered" });
  return {
    id: "opencode",
    displayName: "OpenCode",
    status: "ok",
    windows,
    headlineID: "rolling",
    manageURL: "https://opencode.ai",
  };
}

module.exports = { fetchSnapshot };

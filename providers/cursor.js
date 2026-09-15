const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const STORE = path.join(
  os.homedir(),
  "Library/Application Support/Cursor/User/globalStorage/state.vscdb"
);

function sqliteValue(key) {
  const uri = `file:${STORE}?mode=ro`;
  try {
    return execFileSync(
      "sqlite3",
      [uri, `SELECT value FROM ItemTable WHERE key = '${key.replace(/'/g, "''")}';`],
      { encoding: "utf8", timeout: 4000 }
    ).trim();
  } catch {
    return "";
  }
}

function loadCredentials() {
  if (!fs.existsSync(STORE)) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  const token = sqliteValue("cursorAuth/accessToken");
  const account = sqliteValue("cursorAuth/stripeMembershipAuthId");
  if (!token || !account) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  return {
    accessToken: token,
    cookie: `WorkosCursorSessionToken=${account}::${token}`,
    email: sqliteValue("cursorAuth/cachedEmail") || null,
    plan: sqliteValue("cursorAuth/stripeMembershipType") || null,
  };
}

function percent(value) {
  return typeof value === "number" ? value / 100 : null;
}

function windowsFromSummary(root) {
  const resetsAt = root.billingCycleEnd ? Date.parse(root.billingCycleEnd) : null;
  const plan = root.individualUsage?.plan || {};
  const windows = [];
  const total = percent(plan.totalPercentUsed);
  if (total != null) {
    windows.push({ id: "included", label: "Included usage", usedFraction: total, resetsAt });
  }
  const api = percent(plan.apiPercentUsed);
  if (api != null && api > 0) {
    windows.push({ id: "api", label: "API usage", usedFraction: api, resetsAt });
  }
  const onDemand = root.individualUsage?.onDemand;
  if (onDemand?.enabled && onDemand.limit > 0) {
    windows.push({
      id: "on_demand",
      label: "On demand",
      usedFraction: onDemand.used / onDemand.limit,
      resetsAt,
    });
  }
  if (windows.length) return windows;
  const membership = root.membershipType || "this";
  if (root.isUnlimited) {
    throw Object.assign(new Error("nothingMetered"), { code: "nothingMetered" });
  }
  throw Object.assign(new Error(`The ${membership} plan has nothing to meter`), {
    code: "nothingMetered",
  });
}

async function fetchSnapshot() {
  const creds = loadCredentials();
  const res = await fetch("https://cursor.com/api/usage-summary", {
    headers: { Cookie: creds.cookie, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  if (!res.ok) throw Object.assign(new Error("badResponse"), { code: "badResponse", status: res.status });
  const json = await res.json();
  return {
    id: "cursor",
    displayName: "Cursor",
    letter: "C",
    status: "ok",
    account: creds.email,
    plan: creds.plan,
    windows: windowsFromSummary(json),
    headlineID: "included",
    manageURL: "https://www.cursor.com/settings",
  };
}

module.exports = { fetchSnapshot, loadCredentials };

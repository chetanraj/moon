const fs = require("fs");
const os = require("os");
const path = require("path");

const AUTH = path.join(os.homedir(), ".grok", "auth.json");
const CREDITS = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const TRUSTED = "https://auth.x.ai";

const PRODUCTS = {
  "GrokBuild": { id: "grok-build", displayName: "Grok Build", headline: "GrokBuild" },
  "GrokChat": { id: "grok-chat", displayName: "Grok", headline: "GrokChat" },
};

function parseDate(value) {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function humanize(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function pickEntry(root) {
  const entries = Object.entries(root).filter(([key, value]) => {
    if (!value || typeof value !== "object") return false;
    if (key.startsWith(TRUSTED)) return true;
    return value.oidc_issuer === TRUSTED;
  });
  const live = entries.find(([, e]) => {
    const exp = parseDate(e.expires_at);
    return !exp || exp > Date.now();
  });
  return (live || entries[0] || [])[1] || null;
}

function loadCredentials() {
  if (!fs.existsSync(AUTH)) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  const root = JSON.parse(fs.readFileSync(AUTH, "utf8"));
  const entry = pickEntry(root);
  if (!entry?.key) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  const exp = parseDate(entry.expires_at);
  if (exp && exp <= Date.now()) {
    throw Object.assign(new Error("credentialExpired"), { code: "credentialExpired" });
  }
  return { token: entry.key, email: entry.email || null };
}

let cache = { at: 0, json: null, creds: null };

async function loadCredits() {
  if (cache.json && Date.now() - cache.at < 20_000) return cache;
  const creds = loadCredentials();
  const res = await fetch(CREDITS, {
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "X-XAI-Token-Auth": "xai-grok-cli",
      Accept: "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  if (res.status === 429) {
    throw Object.assign(new Error("rateLimited"), { code: "rateLimited", retryAfter: 60 });
  }
  if (!res.ok) throw Object.assign(new Error("badResponse"), { code: "badResponse", status: res.status });
  cache = { at: Date.now(), json: await res.json(), creds };
  return cache;
}

function windowsForProduct(json, product) {
  const credits = json?.config;
  if (!credits) throw Object.assign(new Error("badResponse"), { code: "badResponse" });
  const reset = parseDate(credits.currentPeriod?.end) || parseDate(credits.billingPeriodEnd);
  const products = Array.isArray(credits.productUsage) ? credits.productUsage : [];
  const row = products.find((p) => p.product === product);
  if (row && typeof row.usagePercent === "number") {
    return [
      {
        id: product,
        label: humanize(product),
        usedFraction: row.usagePercent / 100,
        resetsAt: reset,
      },
    ];
  }
  throw Object.assign(new Error("nothingMetered"), { code: "nothingMetered" });
}

function fetchProduct(product) {
  const meta = PRODUCTS[product];
  return async function fetchSnapshot() {
    const { json, creds } = await loadCredits();
    return {
      id: meta.id,
      displayName: meta.displayName,
      status: "ok",
      account: creds.email,
      windows: windowsForProduct(json, product),
      headlineID: meta.headline,
      manageURL: "https://grok.x.ai",
    };
  };
}

module.exports = {
  fetchChat: fetchProduct("GrokChat"),
  fetchBuild: fetchProduct("GrokBuild"),
  fetchSnapshot: fetchProduct("GrokBuild"),
};

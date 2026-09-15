const fs = require("fs");
const os = require("os");
const path = require("path");

const AUTH = path.join(os.homedir(), ".codex", "auth.json");
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

function jwtClaims(token) {
  try {
    const payload = token.split(".")[1];
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function readAuth() {
  if (!fs.existsSync(AUTH)) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  return JSON.parse(fs.readFileSync(AUTH, "utf8"));
}

function tokenStillGood(access, skewMs = 60_000) {
  const claims = jwtClaims(access);
  if (!claims?.exp) return true;
  return claims.exp * 1000 > Date.now() + skewMs;
}

async function refreshTokens(auth) {
  const refresh = auth?.tokens?.refresh_token;
  if (!refresh) throw Object.assign(new Error("credentialExpired"), { code: "credentialExpired" });
  const claims = jwtClaims(auth.tokens.access_token || "");
  const clientID = claims?.client_id || DEFAULT_CLIENT_ID;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientID,
    }),
  });
  if (!res.ok) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  const json = await res.json();
  const tokens = {
    ...auth.tokens,
    access_token: json.access_token || auth.tokens.access_token,
    refresh_token: json.refresh_token || auth.tokens.refresh_token,
    id_token: json.id_token || auth.tokens.id_token,
  };
  const next = { ...auth, tokens, last_refresh: new Date().toISOString() };
  fs.writeFileSync(AUTH, JSON.stringify(next, null, 2));
  return next;
}

async function loadCredentials() {
  let auth = readAuth();
  let access = auth?.tokens?.access_token;
  const accountID = auth?.tokens?.account_id;
  if (!access || !accountID) throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  if (!tokenStillGood(access)) {
    auth = await refreshTokens(auth);
    access = auth.tokens.access_token;
    if (!tokenStillGood(access, 0)) {
      throw Object.assign(new Error("credentialExpired"), { code: "credentialExpired" });
    }
  }
  const idClaims = jwtClaims(auth.tokens.id_token || "") || jwtClaims(access) || {};
  const openaiAuth = idClaims["https://api.openai.com/auth"] || {};
  return {
    accessToken: access,
    accountID,
    email: idClaims.email || null,
    plan: openaiAuth.chatgpt_plan_type || null,
  };
}

function label(windowSeconds, fallback) {
  if (!(windowSeconds > 0)) return fallback === "primary" ? "Current session" : "Longer window";
  const minutes = windowSeconds / 60;
  if (minutes < 60) return `${Math.trunc(minutes)}m limit`;
  if (minutes < 60 * 24) return `${Math.trunc(minutes / 60)}h limit`;
  const days = Math.round(minutes / (60 * 24));
  if (days === 7) return "Weekly limit";
  if (days === 30) return "Monthly limit";
  return `${days}d limit`;
}

function windowsFromUsage(json) {
  const rate = json?.rate_limit || {};
  const windows = [];
  for (const [id, window] of [
    ["primary", rate.primary_window],
    ["secondary", rate.secondary_window],
  ]) {
    if (!window) continue;
    if (typeof window.used_percent !== "number") {
      throw Object.assign(new Error("badResponse"), { code: "badResponse" });
    }
    const resetsAt =
      typeof window.reset_at === "number"
        ? window.reset_at * 1000
        : typeof window.reset_after_seconds === "number"
          ? Date.now() + window.reset_after_seconds * 1000
          : null;
    windows.push({
      id,
      label: label(window.limit_window_seconds, id),
      usedFraction: window.used_percent / 100,
      resetsAt,
    });
  }
  if (!windows.length) {
    throw Object.assign(new Error("nothingMetered"), { code: "nothingMetered" });
  }
  return windows;
}

async function fetchSnapshot() {
  const creds = await loadCredentials();
  const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "ChatGPT-Account-Id": creds.accountID,
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  if (res.status === 429) {
    throw Object.assign(new Error("rateLimited"), { code: "rateLimited", retryAfter: 60 });
  }
  if (!res.ok) throw Object.assign(new Error("badResponse"), { code: "badResponse", status: res.status });
  const json = await res.json();
  const windows = windowsFromUsage(json);
  return {
    id: "codex",
    displayName: "Codex",
    letter: "X",
    status: "ok",
    account: creds.email,
    plan: creds.plan,
    windows,
    headlineID: windows[0]?.id,
    manageURL: "https://chatgpt.com/#settings",
  };
}

module.exports = { fetchSnapshot };

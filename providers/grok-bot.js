const crypto = require("crypto");
const cursor = require("./cursor");

function obfuscate(bytes) {
  let prev = 165;
  for (let i = 0; i < bytes.length; i++) {
    const cur = bytes[i] ?? 0;
    bytes[i] = ((cur ^ prev) + (i % 256)) & 255;
    prev = bytes[i] ?? 0;
  }
  return bytes;
}

function checksum(machineId, now = Date.now()) {
  const ks = Math.floor(now / 1e6);
  const b = new Uint8Array([
    (ks >> 40) & 255,
    (ks >> 32) & 255,
    (ks >> 24) & 255,
    (ks >> 16) & 255,
    (ks >> 8) & 255,
    ks & 255,
  ]);
  return Buffer.from(obfuscate(b)).toString("base64url") + machineId;
}

async function fetchSnapshot() {
  const creds = cursor.loadCredentials();
  const id = crypto.randomUUID();
  const res = await fetch("https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.accessToken}`,
      "x-cursor-checksum": checksum(id),
      "x-cursor-client-type": "sand",
      "x-cursor-client-version": "0.1.0",
      "x-sand-box-namespace": "prod",
      "x-ghost-mode": "true",
      "x-request-id": crypto.randomUUID(),
    },
    body: "{}",
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  if (!res.ok) throw Object.assign(new Error("badResponse"), { code: "badResponse", status: res.status });
  const json = await res.json();
  if (typeof json.usagePercent !== "number") {
    throw Object.assign(new Error("nothingMetered"), { code: "nothingMetered" });
  }
  const resetsAt = json.nextResetTimestampUtc ? Date.parse(json.nextResetTimestampUtc) : null;
  const windows = [
    {
      id: "weekly",
      label: json.grokPlanLabel ? `${json.grokPlanLabel} weekly` : "Weekly",
      usedFraction: json.usagePercent / 100,
      resetsAt,
    },
  ];
  return {
    id: "grok-bot",
    displayName: "Grok Bot",
    status: "ok",
    account: creds.email,
    plan: json.grokPlanLabel || json.includedUsageSuperGrokPlan || creds.plan,
    windows,
    headlineID: "weekly",
    manageURL: "https://cursor.com/dashboard/bot",
  };
}

module.exports = { fetchSnapshot };

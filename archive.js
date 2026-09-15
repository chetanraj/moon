const fs = require("fs");
const path = require("path");
const { DIR } = require("./prefs");

const FILE = path.join(DIR, "archive.json");

function loadArchive() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveArchive(map) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

function hasReading(provider) {
  if (!provider) return false;
  return (provider.windows || []).some((w) => typeof w.usedFraction === "number");
}

function mergeLastGood(live) {
  const archive = loadArchive();
  const nextArchive = { ...archive };
  const out = [];

  for (const provider of live) {
    if (provider.status === "ok" && hasReading(provider)) {
      nextArchive[provider.id] = { provider, fetchedAt: Date.now() };
      out.push(provider);
      continue;
    }
    const remembered = archive[provider.id];
    const staleCodes = new Set(["rateLimited", "credentialExpired", "error", "badResponse"]);
    if (remembered && hasReading(remembered.provider) && staleCodes.has(provider.status)) {
      out.push({
        ...remembered.provider,
        status: "ok",
        stale: true,
        staleSince: remembered.fetchedAt,
        liveStatus: provider.status,
        message: provider.message,
      });
      continue;
    }
    if (provider.status === "needsAuth" || provider.status === "nothingMetered") {
      delete nextArchive[provider.id];
    }
  }

  saveArchive(nextArchive);
  return out;
}

module.exports = { mergeLastGood, hasReading };

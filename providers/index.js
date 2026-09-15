const prefs = require("../prefs");
const { mergeLastGood } = require("../archive");
const claude = require("./claude");
const grok = require("./grok");
const grokBot = require("./grok-bot");
const cursor = require("./cursor");
const codex = require("./codex");
const opencode = require("./opencode");
const glm = require("./glm");
const antigravity = require("./antigravity");

function catalog() {
  const list = [
    ...claude.discoverProfiles().map((profile) => ({
      id: profile.id,
      displayName: profile.displayName,
      fetch: () => claude.fetchSnapshot(profile),
    })),
    { id: "grok-chat", displayName: "Grok", fetch: grok.fetchChat },
    { id: "grok-build", displayName: "Grok Build", fetch: grok.fetchBuild },
    { id: "grok-bot", displayName: "Grok Bot", fetch: grokBot.fetchSnapshot },
    { id: "cursor", displayName: "Cursor", fetch: cursor.fetchSnapshot },
    { id: "codex", displayName: "Codex", fetch: codex.fetchSnapshot },
    { id: "opencode", displayName: "OpenCode", fetch: opencode.fetchSnapshot },
    { id: "glm", displayName: "GLM", fetch: glm.fetchSnapshot },
    { id: "antigravity", displayName: "Antigravity", fetch: antigravity.fetchSnapshot },
  ];
  const seen = new Set();
  return list.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
}

async function pollAll() {
  const disabled = new Set(prefs.load().disabled || []);
  const results = [];
  for (const provider of catalog()) {
    if (disabled.has(provider.id)) continue;
    try {
      results.push(await provider.fetch());
    } catch (err) {
      results.push({
        id: provider.id,
        displayName: provider.displayName,
        status: err.code || "error",
        message: err.message,
        windows: [],
      });
    }
  }
  return { fetchedAt: Date.now(), providers: mergeLastGood(results) };
}

module.exports = { pollAll, catalog };

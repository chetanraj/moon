const fs = require("fs");
const os = require("os");
const path = require("path");

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

async function fetchSnapshot() {
  const home = os.homedir();
  const hints = [
    path.join(home, "Library/Application Support/Antigravity"),
    path.join(home, ".antigravity"),
    path.join(home, ".gemini"),
  ];
  if (!hints.some(exists)) {
    throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
  }
  throw Object.assign(new Error("needsAuth"), { code: "needsAuth" });
}

module.exports = { fetchSnapshot };

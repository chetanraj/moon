const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".ledge");
const FILE = path.join(DIR, "prefs.json");

const DEFAULTS = {
  edge: "right",
  offset: 0,
  collapsed: false,
  hideOnFullscreen: true,
  disabled: [],
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(next) {
  fs.mkdirSync(DIR, { recursive: true });
  const merged = { ...load(), ...next };
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { load, save, DIR, DEFAULTS };

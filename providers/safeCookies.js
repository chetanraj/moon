const crypto = require("crypto");
const path = require("path");
const { execFileSync } = require("child_process");

function keychainSecret(service, account) {
  const attempts = account
    ? [
        ["find-generic-password", "-w", "-s", service, "-a", account],
        ["find-generic-password", "-w", "-s", service],
      ]
    : [["find-generic-password", "-w", "-s", service]];
  for (const args of attempts) {
    try {
      const out = execFileSync("security", args, {
        encoding: "utf8",
        timeout: 30_000,
      }).trim();
      if (out) return out;
    } catch {
      /* try next */
    }
  }
  return "";
}

function decryptChromium(blob, password) {
  if (!blob || blob.length < 4 || !password) return null;
  const prefix = blob.subarray(0, 3).toString("utf8");
  if (prefix !== "v10" && prefix !== "v11") return null;
  const key = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const iv = Buffer.alloc(16, 32);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  try {
    return Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function readCookies(appSupportName, { service, account, hostLike }) {
  const store = path.join(
    require("os").homedir(),
    "Library/Application Support",
    appSupportName,
    "Cookies"
  );
  if (!require("fs").existsSync(store)) return {};
  const password = keychainSecret(service, account);
  if (!password) return {};
  let dump = "";
  try {
    dump = execFileSync(
      "sqlite3",
      [
        "-separator",
        "\t",
        `file:${store}?mode=ro`,
        `SELECT name, hex(encrypted_value) FROM cookies WHERE host_key LIKE '%${hostLike.replace(/'/g, "")}%';`,
      ],
      { encoding: "utf8", timeout: 4000 }
    );
  } catch {
    return {};
  }
  const out = {};
  for (const line of dump.trim().split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const name = tab === -1 ? line : line.slice(0, tab);
    const hex = tab === -1 ? "" : line.slice(tab + 1);
    const value = decryptChromium(Buffer.from(hex, "hex"), password);
    if (value) out[name] = value;
  }
  return out;
}

module.exports = { readCookies, keychainSecret };

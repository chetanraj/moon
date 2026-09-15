# Rim

**Your AI usage** — a small always-on-top notch on a Mac screen edge that shows how much of each coding assistant’s limit you have burned.

It never signs in. Sign in to the tools on this Mac and their rings appear. Providers with no reading stay hidden.

macOS + Electron. Early / soft launch: run from source.

## Run

```sh
git clone https://github.com/chetanraj/rim.git
cd rim
npm install
npm start
```

No Dock icon. Control lives in the **menu bar** (usage-ring glyph):

- Refresh, edge (left / right / top / bottom), collapse, hide on fullscreen, providers, quit
- Hover a ring for windows and reset times
- Click a ring to open that product’s usage page
- Drag along the edge to move; double-click the notch to quit

Prefs: `~/.rim`

## What it meters

| Ring | Credential it borrows |
| --- | --- |
| **Grok** | `~/.grok/auth.json` — Grok chat |
| **Grok Build** | same session — Grok Build / CLI |
| **Grok Bot** | Cursor session → Bot weekly allowance |
| **Cursor** | Cursor `state.vscdb` |
| **Claude** | Claude Code OAuth or Claude Desktop cookies |
| **Codex** | `~/.codex/auth.json` |
| **OpenCode** | `~/.local/share/opencode/auth.json` |
| **GLM** | Z.ai key already on the machine |

## Privacy

Rim only reads credentials those apps already stored locally. It does not send them anywhere except the same usage endpoints those products already call.

## License

MIT

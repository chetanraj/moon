const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
  nativeTheme,
  Tray,
  shell,
} = require("electron");
const path = require("path");
const { execFileSync } = require("child_process");
const { pollAll, catalog } = require("./providers");
const prefs = require("./prefs");
const { createTrayImage, trayTooltip, lockupTitle, lockupMenuLabel } = require("./trayIcon");


const TIP = 340;

let win;
let tray;
let lastSnapshot = { fetchedAt: 0, providers: [] };


function currentPrefs() {
  return prefs.load();
}

function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const { edge } = currentPrefs();
  const display = screen.getPrimaryDisplay();
  const { workArea, bounds } = display;
  if (edge === "left") {
    win.setBounds({
      x: Math.round(workArea.x),
      y: Math.round(bounds.y),
      width: TIP,
      height: Math.round(bounds.height),
    });
  } else if (edge === "top") {
    win.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(workArea.y),
      width: Math.round(bounds.width),
      height: TIP,
    });
  } else if (edge === "bottom") {
    win.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(workArea.y + workArea.height - TIP),
      width: Math.round(bounds.width),
      height: TIP,
    });
  } else {
    win.setBounds({
      x: Math.round(workArea.x + workArea.width - TIP),
      y: Math.round(bounds.y),
      width: TIP,
      height: Math.round(bounds.height),
    });
  }
  const hideFS = currentPrefs().hideOnFullscreen;
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !hideFS });
}

function applyChrome() {
  app.dock?.hide();
  ensureTray();
  rebuildTray();
}

function lockupMode() {
  return currentPrefs().lockup || "percent";
}

function paintTray() {
  if (!tray) return;
  const mode = lockupMode();
  tray.setImage(createTrayImage(lastSnapshot, mode));
  tray.setTitle(lockupTitle(lastSnapshot, mode));
  tray.setToolTip(trayTooltip(lastSnapshot));
}

function ensureTray() {
  if (tray) return;
  const mode = lockupMode();
  tray = new Tray(createTrayImage(lastSnapshot, mode));
  tray.setTitle(lockupTitle(lastSnapshot, mode));
  tray.setToolTip(trayTooltip(lastSnapshot));
  rebuildTray();
}

function rebuildTray() {
  if (!tray) return;
  const p = currentPrefs();
  const disabled = new Set(p.disabled || []);
  const edges = ["left", "right", "top", "bottom"];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Refresh now", click: () => refresh() },
      { type: "separator" },
      { label: "Menu bar", enabled: false },
      ...["count", "percent", "meter"].map((mode) => ({
        label: lockupMenuLabel(mode, lastSnapshot),
        type: "radio",
        checked: (p.lockup || "percent") === mode,
        click: () => {
          prefs.save({ lockup: mode });
          paintTray();
          rebuildTray();
        },
      })),
      { type: "separator" },
      {
        label: "Edge",
        submenu: edges.map((edge) => ({
          label: edge[0].toUpperCase() + edge.slice(1),
          type: "radio",
          checked: p.edge === edge,
          click: () => {
            prefs.save({ edge });
            pushPrefs();
          },
        })),
      },
      {
        label: "Collapse until hovered",
        type: "checkbox",
        checked: !!p.collapsed,
        click: (item) => {
          prefs.save({ collapsed: item.checked });
          pushPrefs();
        },
      },
      {
        label: "Hide on fullscreen",
        type: "checkbox",
        checked: !!p.hideOnFullscreen,
        click: (item) => {
          prefs.save({ hideOnFullscreen: item.checked });
          pushPrefs();
        },
      },
      { type: "separator" },
      {
        label: "Providers",
        submenu: catalog().map((provider) => ({
          label: provider.displayName,
          type: "checkbox",
          checked: !disabled.has(provider.id),
          click: (item) => {
            const next = new Set(currentPrefs().disabled || []);
            if (item.checked) next.delete(provider.id);
            else next.add(provider.id);
            prefs.save({ disabled: [...next] });
            refresh();
          },
        })),
      },
      { type: "separator" },
      { label: "Quit Moon", click: () => app.quit() },
    ])
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: TIP,
    height: 800,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    roundedCorners: false,
    type: "panel",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setBackgroundColor("#00000000");
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  placeWindow();
  screen.on("display-metrics-changed", placeWindow);
}

function frontmostFullscreen() {
  try {
    const out = execFileSync(
      "osascript",
      [
        "-e",
        [
          'tell application "System Events"',
          "  try",
          "    tell (first process whose frontmost is true)",
          "      if (count of windows) is 0 then return false",
          "      return value of attribute \"AXFullScreen\" of window 1",
          "    end tell",
          "  on error",
          "    return false",
          "  end try",
          "end tell",
        ].join("\n"),
      ],
      { encoding: "utf8", timeout: 1200, stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function applyFullscreenHide() {
  if (!win || win.isDestroyed()) return;
  if (!currentPrefs().hideOnFullscreen) {
    if (!win.isVisible()) win.showInactive();
    return;
  }
  if (frontmostFullscreen()) win.hide();
  else if (!win.isVisible()) win.showInactive();
}

async function refresh() {
  lastSnapshot = await pollAll();
  const payload = { ...lastSnapshot, prefs: currentPrefs() };
  if (win && !win.isDestroyed()) win.webContents.send("usage", payload);
  rebuildTray();
  paintTray();
  return payload;
}

function pushPrefs() {
  const payload = { ...lastSnapshot, prefs: currentPrefs() };
  if (win && !win.isDestroyed()) {
    placeWindow();
    win.webContents.send("usage", payload);
  }
  applyChrome();
}

app.setName("Moon");

app.whenReady().then(async () => {
  nativeTheme.themeSource = "system";
  Menu.setApplicationMenu(null);
  try {
    applyChrome();
  } catch (err) {
    console.error("chrome", err);
  }
  createWindow();
  nativeTheme.on("updated", paintTray);
  try {
    await refresh();
  } catch (err) {
    console.error("refresh", err);
  }
  setInterval(refresh, 60_000);
  setInterval(applyFullscreenHide, 2000);
});

ipcMain.handle("usage:get", () => ({
  ...lastSnapshot,
  prefs: currentPrefs(),
}));
ipcMain.handle("usage:refresh", () => refresh());
ipcMain.handle("prefs:get", () => currentPrefs());
ipcMain.handle("prefs:set", (_e, patch) => {
  prefs.save(patch);
  pushPrefs();
  return currentPrefs();
});
ipcMain.handle("providers:list", () =>
  catalog().map((p) => ({ id: p.id, displayName: p.displayName }))
);
ipcMain.on("mouse", (_e, over) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!over, { forward: true });
});
ipcMain.on("menu", () => {
  rebuildTray();
  if (tray) tray.popUpContextMenu();
});
ipcMain.on("quit", () => app.quit());
ipcMain.on("open", (_e, url) => {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:") return;
    shell.openExternal(parsed.toString());
  } catch {
    /* ignore bad urls */
  }
});

app.on("window-all-closed", () => app.quit());

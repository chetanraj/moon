const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
  nativeTheme,
  Tray,
  nativeImage,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { pollAll, catalog } = require("./providers");
const prefs = require("./prefs");


const TIP = 340;

let win;
let settingsWin;
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

function trayIcon() {
  const two = path.join(__dirname, "assets", "trayTemplate@2x.png");
  const one = path.join(__dirname, "assets", "trayTemplate.png");
  const image = nativeImage.createFromPath(fs.existsSync(two) ? two : one);
  image.setTemplateImage(true);
  return image;
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip("Rim — your AI usage");
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
      { label: "Quit Rim", click: () => app.quit() },
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

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 420,
    height: 560,
    title: "Rim",
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.on("closed", () => {
    settingsWin = null;
  });
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

app.setName("Rim");

app.whenReady().then(async () => {
  nativeTheme.themeSource = "system";
  Menu.setApplicationMenu(null);
  applyChrome();
  createWindow();
  await refresh();
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
  Menu.buildFromTemplate([
    { label: "Refresh now", click: () => refresh() },
    { label: "Settings…", click: () => openSettings() },
    { type: "separator" },
    { label: "Quit Rim", click: () => app.quit() },
  ]).popup({ window: win });
});
ipcMain.on("settings", () => openSettings());
ipcMain.on("quit", () => app.quit());
ipcMain.on("open", (_e, url) => {
  if (url) shell.openExternal(url);
});

app.on("window-all-closed", () => app.quit());

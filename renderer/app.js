const cellsEl = document.getElementById("cells");
const notchEl = document.getElementById("notch");
const tooltip = document.getElementById("tooltip");
const pathEl = document.getElementById("notchPath");
const shapeSvg = document.querySelector(".notch-shape");
const stageEl = document.getElementById("stage");


const CURL = 39;
const CORNER = 30;
const DEPTH = 70;
const RING = 44;
const LABEL = 18;
const GAP = 10;
const SPACING = 31;
const PAD_TOP = 26;
const PAD_BOTTOM = 19;
const PILL = 80;
const PILL_DEPTH = 26;

function bandColor(frac) {
  if (frac < 0.5) return "var(--ample)";
  if (frac < 0.7) return "var(--watch)";
  return "var(--critical)";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resetCopy(ts) {
  if (!ts) return "";
  const seconds = (ts - Date.now()) / 1000;
  if (seconds <= 0) return "Resetting…";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Resets in ${Math.max(1, minutes)} min`;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(ts);
  end.setHours(0, 0, 0, 0);
  const days = Math.round((end - start) / 86400000);
  if (days >= 7) {
    return `Resets ${new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  return `Resets ${new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function headline(provider) {
  if (!provider.windows?.length) return null;
  if (provider.headlineID) {
    return provider.windows.find((w) => w.id === provider.headlineID) || null;
  }
  return [...provider.windows].sort((a, b) => (b.usedFraction ?? 0) - (a.usedFraction ?? 0))[0];
}

function hasReading(provider) {
  return (provider.windows || []).some((w) => typeof w.usedFraction === "number");
}

function notchPath(h) {
  const w = DEPTH;
  return [
    `M ${w} 0`,
    `A ${CURL} ${CURL} 0 0 1 ${w - CURL} ${CURL}`,
    `L ${CORNER} ${CURL}`,
    `A ${CORNER} ${CORNER} 0 0 0 0 ${CURL + CORNER}`,
    `L 0 ${h - CURL - CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 0 ${CORNER} ${h - CURL}`,
    `L ${w - CURL} ${h - CURL}`,
    `A ${CURL} ${CURL} 0 0 1 ${w} ${h}`,
    "Z",
  ].join(" ");
}

function sizeNotch(n, edge, collapsed) {
  const horizontal = edge === "top" || edge === "bottom";
  const cell = RING + GAP + LABEL;
  const body = PAD_TOP + n * cell + Math.max(0, n - 1) * SPACING + PAD_BOTTOM;
  const along = collapsed ? PILL : body + 2 * CURL;
  if (horizontal) {
    notchEl.style.width = `${along}px`;
    notchEl.style.height = collapsed ? `${PILL_DEPTH}px` : `${DEPTH}px`;
    shapeSvg.setAttribute("viewBox", `0 0 ${DEPTH} ${along}`);
    shapeSvg.style.width = `${DEPTH}px`;
    shapeSvg.style.height = `${along}px`;
    shapeSvg.style.transform =
      edge === "top" ? "rotate(-90deg) translateX(-100%)" : "rotate(90deg)";
    shapeSvg.style.transformOrigin = "top left";
  } else {
    notchEl.style.width = collapsed ? `${PILL_DEPTH}px` : `${DEPTH}px`;
    notchEl.style.height = `${along}px`;
    shapeSvg.setAttribute("viewBox", `0 0 ${DEPTH} ${along}`);
    shapeSvg.style.width = "100%";
    shapeSvg.style.height = "100%";
    shapeSvg.style.transform = "";
    shapeSvg.style.transformOrigin = "";
  }
  pathEl.setAttribute("d", notchPath(along));
}

function meterSVG(fraction, color) {
  const d = 44;
  const track = 5.8;
  const progress = 3;
  const cx = d / 2;
  const r = cx - track / 2;
  const inner = cx - track;
  const c = 2 * Math.PI * r;
  const used = Math.min(1, Math.max(0, fraction ?? 0));
  return `<svg class="meter" viewBox="0 0 ${d} ${d}">
    <circle cx="${cx}" cy="${cx}" r="${inner}" fill="var(--fill)"/>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${track}"/>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${progress}"
      stroke-linecap="round" stroke-dasharray="${used * c} ${c}"/>
  </svg>`;
}

function glyph(id) {
  if (id.startsWith("claude")) return window.GLYPHS.claude;
  if (id === "grok-chat" || id === "grok-build") return window.GLYPHS.grok;
  if (id === "grok-bot") return window.GLYPHS["grok-bot"] || window.GLYPHS.grok;
  return window.GLYPHS[id] || window.GLYPHS.grok;
}

let hideTimer = null;
let hoveredId = null;
let lastSnapshot = { providers: [] };
let currentPrefs = { edge: "right", collapsed: true, offset: 0 };
let expanded = false;
let dragStart = null;
let dragStartOffset = 0;
let didDrag = false;
let clickTimer = null;

function applyOffset() {
  notchEl.style.setProperty("--shift", `${currentPrefs.offset || 0}px`);
}

function clampOffset(value) {
  const stage = stageEl.getBoundingClientRect();
  const horizontal = currentPrefs.edge === "top" || currentPrefs.edge === "bottom";
  const size = horizontal ? notchEl.offsetWidth : notchEl.offsetHeight;
  const span = horizontal ? stage.width : stage.height;
  const max = Math.max(0, (span - size) / 2 - 8);
  return Math.max(-max, Math.min(max, value));
}

function applyEdge() {
  stageEl.classList.remove("edge-right", "edge-left", "edge-top", "edge-bottom");
  stageEl.classList.add(`edge-${currentPrefs.edge || "right"}`);
}

function applyCollapsed() {
  const wantPill = currentPrefs.collapsed && !expanded;
  notchEl.classList.toggle("pill", wantPill);
}

function render(snapshot) {
  if (snapshot.prefs) currentPrefs = snapshot.prefs;
  lastSnapshot = snapshot;
  notchEl.classList.remove("refreshing");
  applyEdge();
  applyOffset();
  const providers = (snapshot.providers || []).filter(hasReading);
  notchEl.hidden = false;
  if (!providers.length) {
    tooltip.classList.remove("visible");
    hoveredId = null;
    cellsEl.innerHTML = "";
    applyCollapsed();
    sizeNotch(1, currentPrefs.edge || "right", true);
    notchEl.classList.add("pill");
    return;
  }
  applyCollapsed();
  sizeNotch(providers.length, currentPrefs.edge || "right", currentPrefs.collapsed && !expanded);
  currentPrefs.offset = clampOffset(currentPrefs.offset || 0);
  applyOffset();
  cellsEl.innerHTML = "";
  for (const provider of providers) {
    const head = headline(provider);
    const frac = head ? head.usedFraction : null;
    const color = frac == null ? "var(--track)" : bandColor(frac);
    const pct = frac == null ? "—" : `${Math.round(frac * 100)}%`;
    const btn = document.createElement("button");
    btn.className = "cell" + (provider.stale ? " stale" : "");
    btn.type = "button";
    btn.dataset.id = provider.id;
    btn.innerHTML = `
      <div class="ring-wrap">
        ${meterSVG(frac ?? 0, color)}
        <div class="glyph-slot">${glyph(provider.id)}</div>
      </div>
      <div class="pct">${pct}</div>`;
    btn.addEventListener("mouseenter", () => showTip(provider, btn));
    btn.addEventListener("mouseleave", hideTipSoon);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (didDrag) return;
      if (provider.manageURL) window.moon.open(provider.manageURL);
    });
    cellsEl.appendChild(btn);
  }
  if (hoveredId) {
    const provider = providers.find((p) => p.id === hoveredId);
    const cell = cellsEl.querySelector(`[data-id="${hoveredId}"]`);
    if (provider && cell) showTip(provider, cell);
  }
}

function hideTipSoon() {
  hoveredId = null;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    tooltip.classList.remove("visible");
    trackMouse(false);
  }, 250);
}

function showTip(provider, cell) {
  hoveredId = provider.id;
  clearTimeout(hideTimer);
  trackMouse(true);
  const windows = provider.windows || [];
  const rows = windows
    .map((w) => {
      const frac = Math.min(1, Math.max(0, w.usedFraction ?? 0));
      return `<div class="window">
        <div class="split"><span class="lead">${escapeHtml(w.label)}</span><span class="trail">${escapeHtml(resetCopy(w.resetsAt))}</span></div>
        <div class="bar"><span style="width:${frac * 100}%;background:${bandColor(frac)}"></span></div>
        <div class="used">${Math.round(frac * 100)}% Used${provider.stale ? " · stale" : ""}</div>
      </div>`;
    })
    .join("");
  tooltip.innerHTML = `
    <svg class="tail" viewBox="0 0 28 33" aria-hidden="true"><path fill="var(--card-bg)" d="M0 0 L28 16.5 L0 33 Z"/></svg>
    <div class="tip-head">${glyph(provider.id)}<span>${escapeHtml(provider.displayName)} Usage</span></div>
    ${rows || "<p class='status'>No reading</p>"}`;
  tooltip.classList.add("visible");
  const cellRect = cell.getBoundingClientRect();
  const stage = stageEl.getBoundingClientRect();
  const tipH = tooltip.offsetHeight;
  const cellMid = cellRect.top + cellRect.height / 2 - stage.top;
  const top = Math.max(12, Math.min(cellMid - tipH / 2, stage.height - tipH - 12));
  tooltip.style.top = `${top}px`;
  tooltip.style.setProperty("--tail-y", `${cellMid - top}px`);
  tooltip.style.setProperty("--tip-x", `${cellRect.left + cellRect.width / 2 - stage.left - 113}px`);
}

function refreshNow() {
  notchEl.classList.add("refreshing");
  window.moon.refresh();
}

function trackMouse(over) {
  window.moon.mouse(over);
}

function expand() {
  expanded = true;
  applyCollapsed();
  const n = (lastSnapshot.providers || []).filter(hasReading).length;
  sizeNotch(Math.max(1, n), currentPrefs.edge || "right", false);
}

function collapseSoon() {
  if (!currentPrefs.collapsed) return;
  expanded = false;
  applyCollapsed();
  const n = (lastSnapshot.providers || []).filter(hasReading).length;
  if (n) sizeNotch(n, currentPrefs.edge || "right", true);
}

tooltip.addEventListener("mouseenter", () => {
  clearTimeout(hideTimer);
  trackMouse(true);
});
tooltip.addEventListener("mouseleave", hideTipSoon);

notchEl.addEventListener("mouseenter", () => {
  trackMouse(true);
  expand();
});
notchEl.addEventListener("mouseleave", () => {
  if (dragStart != null) return;
  if (!tooltip.classList.contains("visible")) trackMouse(false);
  collapseSoon();
});
document.body.addEventListener("mouseleave", () => {
  if (dragStart != null) return;
  trackMouse(false);
  collapseSoon();
});

function axisPos(e) {
  const horizontal = currentPrefs.edge === "top" || currentPrefs.edge === "bottom";
  return horizontal ? e.clientX : e.clientY;
}

notchEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  trackMouse(true);
  dragStart = axisPos(e);
  dragStartOffset = currentPrefs.offset || 0;
  didDrag = false;
  notchEl.classList.add("dragging");
  try {
    notchEl.setPointerCapture(e.pointerId);
  } catch {
    /* capture is best-effort on a click-through window */
  }
});
window.addEventListener("pointermove", (e) => {
  if (dragStart == null) return;
  const d = axisPos(e) - dragStart;
  if (Math.abs(d) > 3) didDrag = true;
  if (!didDrag) return;
  e.preventDefault();
  currentPrefs.offset = clampOffset(dragStartOffset + d);
  applyOffset();
});
function endDrag() {
  if (dragStart == null) return;
  dragStart = null;
  notchEl.classList.remove("dragging");
  if (didDrag) window.moon.setPrefs({ offset: currentPrefs.offset });
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

notchEl.addEventListener("click", (e) => {
  if (e.target.closest(".cell")) return;
  e.preventDefault();
  if (didDrag) return;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(refreshNow, 280);
});
notchEl.addEventListener("dblclick", (e) => {
  e.preventDefault();
  clearTimeout(clickTimer);
  window.moon.quit();
});
notchEl.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.moon.menu();
});
window.moon.onUsage(render);
window.moon.get().then(render);

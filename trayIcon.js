const path = require("path");
const zlib = require("zlib");
const { nativeImage, nativeTheme } = require("electron");

function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf);
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function pngChunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(tag), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([len, payload, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk(
      "IHDR",
      Buffer.from([0, 0, width >> 8, width & 255, 0, 0, height >> 8, height & 255, 8, 6, 0, 0, 0])
    ),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function moonCover(px, py, s) {
  const disk = sdCircle(px, py, 12 * s, 12 * s, 8 * s);
  const shade = sdCircle(px, py, 16.2 * s, 10.2 * s, 7.2 * s);
  const body = Math.max(disk, -shade);
  return clamp(0.55 - body, 0, 1);
}

function drawMoonGlyph(pixelSize) {
  const rgba = Buffer.alloc(pixelSize * pixelSize * 4);
  const s = pixelSize / 24;
  for (let y = 0; y < pixelSize; y++) {
    for (let x = 0; x < pixelSize; x++) {
      const cover = moonCover(x + 0.5, y + 0.5, s);
      if (cover <= 0) continue;
      const i = (y * pixelSize + x) * 4;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = Math.round(cover * 255);
    }
  }
  return encodePng(pixelSize, pixelSize, rgba);
}

function setPx(rgba, w, h, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = a;
}

function fillRoundRect(rgba, w, h, x0, y0, x1, y1, radius, r, g, b, a) {
  const rad = Math.max(0, radius);
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const cx = Math.min(Math.max(x + 0.5, x0 + rad), x1 - rad);
      const cy = Math.min(Math.max(y + 0.5, y0 + rad), y1 - rad);
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > rad + 0.55) continue;
      setPx(rgba, w, h, x, y, r, g, b, a);
    }
  }
}

function blit(dst, dw, dh, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = (y * sw + x) * 4;
      if (!src[si + 3]) continue;
      setPx(dst, dw, dh, x + ox, y + oy, src[si], src[si + 1], src[si + 2], src[si + 3]);
    }
  }
}

function peakUsage(snapshot) {
  let fraction = 0;
  let name = null;
  for (const provider of snapshot?.providers || []) {
    const windows = provider.windows || [];
    const head = provider.headlineID
      ? windows.find((w) => w.id === provider.headlineID)
      : windows[0];
    const used = head?.usedFraction;
    if (typeof used === "number" && used >= fraction) {
      fraction = used;
      name = provider.displayName;
    }
  }
  return { fraction, name };
}

function remainingOf(snapshot) {
  const { fraction, name } = peakUsage(snapshot);
  return { remaining: name ? Math.max(0, 1 - fraction) : null, used: fraction, name };
}

function formatPercent(remaining) {
  if (remaining == null) return "";
  if (remaining <= 0) return "0%";
  if (remaining < 0.01) return "<1%";
  return `${Math.round(remaining * 100)}%`;
}

function meterTicks(used) {
  const filled = Math.max(0, Math.min(10, Math.round(used * 10)));
  return `${"━".repeat(filled)}${"░".repeat(10 - filled)}`;
}

function lockupTitle(snapshot, mode = "percent") {
  const { remaining, used } = remainingOf(snapshot);
  if (remaining == null) return "";
  if (mode === "count") return ` ${formatPercent(remaining)} left`;
  if (mode === "meter") return ` ${formatPercent(remaining)}`;
  return ` ${formatPercent(remaining)}`;
}

function lockupMenuLabel(mode, snapshot) {
  const { remaining, used } = remainingOf(snapshot);
  if (mode === "count") return remaining == null ? "12.4k left" : `${formatPercent(remaining)} left`;
  if (mode === "meter") {
    const bar = remaining == null ? "━━━━━━━░░" : meterTicks(used);
    const nums = remaining == null ? "1.2k / 8k" : formatPercent(remaining);
    return `${bar}  ${nums}`;
  }
  return remaining == null ? "82%" : formatPercent(remaining);
}

function drawMeterLockup(used) {
  const glyph = 36;
  const gap = 8;
  const barW = 56;
  const barH = 8;
  const w = glyph + gap + barW + 4;
  const h = glyph;
  const rgba = Buffer.alloc(w * h * 4);
  const gRgba = rasterGlyph(glyph);
  blit(rgba, w, h, gRgba, glyph, glyph, 0, 0);

  const bx0 = glyph + gap;
  const by0 = Math.round((h - barH) / 2);
  const bx1 = bx0 + barW;
  const by1 = by0 + barH;
  fillRoundRect(rgba, w, h, bx0, by0, bx1, by1, 4, 70, 70, 70, 255);
  const fill = Math.min(1, Math.max(0, used));
  if (fill > 0.02) {
    fillRoundRect(rgba, w, h, bx0, by0, bx0 + barW * fill, by1, 4, 255, 140, 60, 255);
  }
  return encodePng(w, h, rgba);
}

function rasterGlyph(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ink = nativeTheme.shouldUseDarkColors ? 255 : 20;
  const s = size / 24;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cover = moonCover(x + 0.5, y + 0.5, s);
      if (cover <= 0) continue;
      const i = (y * size + x) * 4;
      rgba[i] = ink;
      rgba[i + 1] = ink;
      rgba[i + 2] = ink;
      rgba[i + 3] = Math.round(cover * 255);
    }
  }
  return rgba;
}

function createTrayImage(snapshot, mode = "percent") {
  try {
    if (mode === "meter") {
      const { remaining, used } = remainingOf(snapshot);
      const image = nativeImage.createFromBuffer(drawMeterLockup(used), { scaleFactor: 2 });
      return image;
    }
    const image = nativeImage.createFromBuffer(drawMoonGlyph(36), { scaleFactor: 2 });
    image.setTemplateImage(true);
    return image;
  } catch {
    const image = nativeImage.createFromPath(path.join(__dirname, "assets", "trayTemplate.png"));
    image.setTemplateImage(true);
    return image;
  }
}

function trayTooltip(snapshot) {
  const { remaining, name } = remainingOf(snapshot);
  if (!name) return "Moon — your AI usage";
  return `Token usage, ${formatPercent(remaining).replace("%", "")} percent remaining`;
}

module.exports = {
  createTrayImage,
  trayTooltip,
  peakUsage,
  lockupTitle,
  lockupMenuLabel,
};

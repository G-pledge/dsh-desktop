import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pngToIco from "png-to-ico";

const src = PNG.sync.read(fs.readFileSync("build/icon.png"));

function bbox(png, minA = 20) {
  let x0 = png.width, y0 = png.height, x1 = 0, y1 = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] > minA) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error("no opaque pixels");
  return { x0, y0, x1, y1 };
}

function fit(srcPng, size, padRatio = 0.04) {
  const { x0, y0, x1, y1 } = bbox(srcPng);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const pad = Math.max(1, Math.round(size * padRatio));
  const inner = size - pad * 2;
  const scale = Math.min(inner / cw, inner / ch);
  const dw = Math.max(1, Math.round(cw * scale));
  const dh = Math.max(1, Math.round(ch * scale));
  const ox = Math.round((size - dw) / 2);
  const oy = Math.round((size - dh) / 2);
  const out = new PNG({ width: size, height: size, colorType: 6 });

  for (let y = 0; y < dh; y++) {
    const sy = y0 + Math.min(ch - 1, Math.floor(y / scale));
    for (let x = 0; x < dw; x++) {
      const sx = x0 + Math.min(cw - 1, Math.floor(x / scale));
      const si = (sy * srcPng.width + sx) * 4;
      const di = ((oy + y) * size + (ox + x)) * 4;
      const a = srcPng.data[si + 3];
      if (size <= 32 && a > 80) {
        out.data[di] = 62;
        out.data[di + 1] = 224;
        out.data[di + 2] = 232;
        out.data[di + 3] = 255;
      } else if (a > 16) {
        out.data[di] = srcPng.data[si];
        out.data[di + 1] = srcPng.data[si + 1];
        out.data[di + 2] = srcPng.data[si + 2];
        out.data[di + 3] = srcPng.data[si + 3];
      }
    }
  }
  return out;
}

fs.writeFileSync("build/icon.png", PNG.sync.write(fit(src, 1024)));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const files = [];
for (const n of sizes) {
  const file = path.join("build", `icon-${n}.png`);
  fs.writeFileSync(file, PNG.sync.write(fit(src, n, n <= 32 ? 0.02 : 0.04)));
  files.push(file);
}

fs.writeFileSync("build/tray.png", PNG.sync.write(fit(src, 64, 0.02)));
fs.writeFileSync("build/icon.ico", await pngToIco(files));
console.log("icon.ico ok");

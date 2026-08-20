import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const src = process.argv[2] || "build/icon.png";
const dest = process.argv[3] || "build/icon.png";
const png = PNG.sync.read(fs.readFileSync(src));
const { width, height, data } = png;

function idx(x, y) {
  return (y * width + x) * 4;
}

function isWhale(x, y) {
  const i = idx(x, y);
  const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
  if (a < 16) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return g > 145 && b > 145 && g + b > r * 3 + 80 && lum > 130;
}

const seen = Buffer.alloc(width * height);
const q = [];

function push(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const p = y * width + x;
  if (seen[p] || isWhale(x, y)) return;
  seen[p] = 1;
  q.push(p);
}

for (let x = 0; x < width; x++) {
  push(x, 0);
  push(x, height - 1);
}
for (let y = 0; y < height; y++) {
  push(0, y);
  push(width - 1, y);
}

for (let i = 0; i < q.length; i++) {
  const p = q[i];
  const x = p % width;
  const y = (p - x) / width;
  data[idx(x, y) + 3] = 0;
  push(x - 1, y);
  push(x + 1, y);
  push(x, y - 1);
  push(x, y + 1);
}

let x0 = width, y0 = height, x1 = 0, y1 = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (data[idx(x, y) + 3] > 20) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
}

if (x1 <= x0 || y1 <= y0) throw new Error("knockout: no whale pixels found");

const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;
const size = 1024;
const pad = Math.round(size * 0.08);
const inner = size - pad * 2;
const scale = Math.min(inner / cw, inner / ch);
const dw = Math.round(cw * scale);
const dh = Math.round(ch * scale);
const ox = Math.round((size - dw) / 2);
const oy = Math.round((size - dh) / 2);

const out = new PNG({ width: size, height: size, colorType: 6 });
for (let y = 0; y < dh; y++) {
  const sy = y0 + Math.min(ch - 1, Math.floor(y / scale));
  for (let x = 0; x < dw; x++) {
    const sx = x0 + Math.min(cw - 1, Math.floor(x / scale));
    const si = idx(sx, sy);
    const di = ((oy + y) * size + (ox + x)) * 4;
    out.data[di] = data[si];
    out.data[di + 1] = data[si + 1];
    out.data[di + 2] = data[si + 2];
    out.data[di + 3] = data[si + 3];
  }
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, PNG.sync.write(out));
console.log("wrote " + dest);

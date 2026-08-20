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
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const a = data[i + 3];
  if (a < 16) {
    return false;
  }
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return g > 145 && b > 145 && g + b > r * 3 + 80 && luminance > 130;
}

const seen = Buffer.alloc(width * height);
const queue = [];

function push(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const p = y * width + x;
  if (seen[p]) {
    return;
  }
  if (isWhale(x, y)) {
    return;
  }
  seen[p] = 1;
  queue.push(p);
}

for (let x = 0; x < width; x += 1) {
  push(x, 0);
  push(x, height - 1);
}
for (let y = 0; y < height; y += 1) {
  push(0, y);
  push(width - 1, y);
}

for (let q = 0; q < queue.length; q += 1) {
  const p = queue[q];
  const x = p % width;
  const y = (p - x) / width;
  data[idx(x, y) + 3] = 0;
  push(x - 1, y);
  push(x + 1, y);
  push(x, y - 1);
  push(x, y + 1);
}

let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (data[idx(x, y) + 3] > 20) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}

if (maxX <= minX || maxY <= minY) {
  throw new Error("knockout: no whale pixels found");
}

const cropW = maxX - minX + 1;
const cropH = maxY - minY + 1;
const size = 1024;
const pad = Math.round(size * 0.08);
const inner = size - pad * 2;
const scale = Math.min(inner / cropW, inner / cropH);
const drawW = Math.round(cropW * scale);
const drawH = Math.round(cropH * scale);
const ox = Math.round((size - drawW) / 2);
const oy = Math.round((size - drawH) / 2);

const out = new PNG({ width: size, height: size, colorType: 6 });
for (let y = 0; y < drawH; y += 1) {
  const sy = minY + Math.min(cropH - 1, Math.floor(y / scale));
  for (let x = 0; x < drawW; x += 1) {
    const sx = minX + Math.min(cropW - 1, Math.floor(x / scale));
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
console.log(`wrote ${dest} whale=${cropW}x${cropH}`);

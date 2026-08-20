import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pngToIco from "png-to-ico";

const srcPath = "build/icon.png";
const src = PNG.sync.read(fs.readFileSync(srcPath));

function bbox(png, alphaMin = 20) {
  let minX = png.width;
  let minY = png.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] > alphaMin) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) {
    throw new Error("no opaque pixels");
  }
  return { minX, minY, maxX, maxY };
}

function fitWhale(srcPng, size, padRatio = 0.04) {
  const { minX, minY, maxX, maxY } = bbox(srcPng);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const pad = Math.max(1, Math.round(size * padRatio));
  const inner = size - pad * 2;
  const scale = Math.min(inner / cropW, inner / cropH);
  const drawW = Math.max(1, Math.round(cropW * scale));
  const drawH = Math.max(1, Math.round(cropH * scale));
  const ox = Math.round((size - drawW) / 2);
  const oy = Math.round((size - drawH) / 2);
  const out = new PNG({ width: size, height: size, colorType: 6 });

  for (let y = 0; y < drawH; y += 1) {
    const sy = minY + Math.min(cropH - 1, Math.floor(y / scale));
    for (let x = 0; x < drawW; x += 1) {
      const sx = minX + Math.min(cropW - 1, Math.floor(x / scale));
      const si = (sy * srcPng.width + sx) * 4;
      const di = ((oy + y) * size + (ox + x)) * 4;
      const alpha = srcPng.data[si + 3];
      if (size <= 32 && alpha > 80) {
        out.data[di] = 62;
        out.data[di + 1] = 224;
        out.data[di + 2] = 232;
        out.data[di + 3] = 255;
      } else if (alpha > 16) {
        out.data[di] = srcPng.data[si];
        out.data[di + 1] = srcPng.data[si + 1];
        out.data[di + 2] = srcPng.data[si + 2];
        out.data[di + 3] = srcPng.data[si + 3];
      }
    }
  }
  return out;
}

const master = fitWhale(src, 1024, 0.04);
fs.writeFileSync("build/icon.png", PNG.sync.write(master));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const files = [];
for (const size of sizes) {
  const png = fitWhale(src, size, size <= 32 ? 0.02 : 0.04);
  const file = path.join("build", `icon-${size}.png`);
  fs.writeFileSync(file, PNG.sync.write(png));
  files.push(file);
}

const tray = fitWhale(src, 64, 0.02);
fs.writeFileSync("build/tray.png", PNG.sync.write(tray));

const buf = await pngToIco(files);
fs.writeFileSync("build/icon.ico", buf);
console.log(`wrote build/icon.ico (${buf.length} bytes) sizes=${sizes.join(",")}`);
console.log("wrote build/tray.png and enlarged build/icon.png");

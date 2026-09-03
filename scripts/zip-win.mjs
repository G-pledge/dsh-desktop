import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dist = path.resolve("dist");
const unpacked = path.join(dist, "win-unpacked");

if (!fs.existsSync(unpacked)) {
  console.log("dist/win-unpacked 不存在，先 npm run pack");
  process.exit(1);
}

const extra = [
  "config.example.json",
  "LICENSE.electron.txt",
  "LICENSES.chromium.html",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
  "dxcompiler.dll",
  "dxil.dll",
];

for (const name of extra) {
  const file = path.join(unpacked, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const example = fs.readFileSync(path.resolve("config.example.json"), "utf8").replace(/^\uFEFF/, "");
const configPath = path.join(unpacked, "config.json");
const backup = fs.existsSync(configPath) ? fs.readFileSync(configPath) : null;
fs.writeFileSync(configPath, example);

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const zipName = "DeepSeek-Harness-" + pkg.version + "-win-x64.zip";
const zipPath = path.join(dist, zipName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const result = spawnSync("tar", ["-C", unpacked, "-a", "-c", "-f", zipPath, "."], {
  stdio: "inherit",
});

if (result.status !== 0) {
  if (backup) fs.writeFileSync(configPath, backup);
  process.exit(result.status || 1);
}

if (backup) fs.writeFileSync(configPath, backup);
else fs.writeFileSync(configPath, example);

console.log(zipPath);

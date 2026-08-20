import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dist = path.resolve("dist");
const unpacked = path.join(dist, "win-unpacked");

if (!fs.existsSync(unpacked)) {
  console.log("dist/win-unpacked 不存在，先 npm run pack");
  process.exit(1);
}

for (const name of ["config.json", "config.example.json"]) {
  const file = path.join(unpacked, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const zipName = "DeepSeek-Harness-" + pkg.version + "-win-x64.zip";
const zipPath = path.join(dist, zipName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const result = spawnSync("tar", ["-C", unpacked, "-a", "-c", "-f", zipPath, "."], {
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(zipPath);

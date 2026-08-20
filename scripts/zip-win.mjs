import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dist = path.resolve("dist");
const unpacked = path.join(dist, "win-unpacked");

if (!fs.existsSync(unpacked)) {
  console.log("dist/win-unpacked 不存在，先 npm run pack");
  process.exit(1);
}

for (const file of [path.join(dist, "config.json"), path.join(unpacked, "config.json")]) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

if (!fs.existsSync(path.join(dist, "启动.bat")) || !fs.existsSync(path.join(dist, "config.example.json"))) {
  console.log("缺少 启动.bat 或 config.example.json，先 npm run pack");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const zipName = "DeepSeek-Harness-" + pkg.version + "-win-x64.zip";
const zipPath = path.join(dist, zipName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const result = spawnSync(
  "tar",
  ["-a", "-c", "-f", zipName, "win-unpacked", "启动.bat", "config.example.json"],
  { cwd: dist, stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(zipPath);

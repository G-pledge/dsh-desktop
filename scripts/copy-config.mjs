import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const unpacked = path.join(dist, "win-unpacked");
const src = path.resolve("config.example.json");

if (!fs.existsSync(dist) || !fs.existsSync(unpacked)) {
  console.log("skip copy-config: dist/win-unpacked missing");
  process.exit(0);
}

const text = fs.readFileSync(src, "utf8").replace(/^\uFEFF/, "");
fs.writeFileSync(path.join(dist, "config.example.json"), text, "utf8");
fs.writeFileSync(path.join(unpacked, "config.example.json"), text, "utf8");

for (const dir of [dist, unpacked]) {
  const configPath = path.join(dir, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, text, "utf8");
  }
}

const bat = `@echo off
cd /d "%~dp0win-unpacked"
start "" "DeepSeek Harness.exe"
`;
fs.writeFileSync(path.join(dist, "启动.bat"), bat, "utf8");

console.log("fast launch ready: use dist\\启动.bat or dist\\win-unpacked\\DeepSeek Harness.exe");

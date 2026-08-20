import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const unpacked = path.join(dist, "win-unpacked");
const src = path.resolve("config.example.json");

if (!fs.existsSync(unpacked)) {
  console.log("dist/win-unpacked 不存在，先 npm run pack");
  process.exit(0);
}

const text = fs.readFileSync(src, "utf8").replace(/^\uFEFF/, "");
fs.writeFileSync(path.join(dist, "config.example.json"), text);
fs.writeFileSync(path.join(unpacked, "config.example.json"), text);

for (const dir of [dist, unpacked]) {
  const file = path.join(dir, "config.json");
  if (!fs.existsSync(file)) fs.writeFileSync(file, text);
}

fs.writeFileSync(
  path.join(dist, "启动.bat"),
  `@echo off\r\ncd /d "%~dp0win-unpacked"\r\nstart "" "DeepSeek Harness.exe"\r\n`,
);

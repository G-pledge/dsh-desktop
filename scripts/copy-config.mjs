import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const unpacked = path.join(dist, "win-unpacked");
const exampleSrc = path.resolve("config.example.json");
const userSrc = path.resolve("config.user.json");

if (!fs.existsSync(unpacked)) {
  console.log("dist/win-unpacked 不存在，先 npm run pack");
  process.exit(0);
}

const example = fs.readFileSync(exampleSrc, "utf8").replace(/^\uFEFF/, "");
const hasUser = fs.existsSync(userSrc);
const local = hasUser ? fs.readFileSync(userSrc, "utf8").replace(/^\uFEFF/, "") : example;

fs.writeFileSync(path.join(dist, "config.example.json"), example);
fs.writeFileSync(path.join(unpacked, "config.example.json"), example);

const file = path.join(unpacked, "config.json");
if (hasUser || !fs.existsSync(file)) fs.writeFileSync(file, local);

const distConfig = path.join(dist, "config.json");
if (hasUser || !fs.existsSync(distConfig)) fs.writeFileSync(distConfig, local);

fs.writeFileSync(
  path.join(dist, "启动.bat"),
  `@echo off\r\ncd /d "%~dp0win-unpacked"\r\nstart "" "DeepSeek Harness.exe"\r\n`,
);
console.log("exe dir: " + unpacked);

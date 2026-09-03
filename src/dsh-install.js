const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const PINNED = "0.1.1-rc.2";
const REGISTRY_URLS = [
  "https://registry.npmmirror.com/@deepseek-ai/dsh",
  "https://registry.npmjs.org/@deepseek-ai/dsh",
];

function launcherDir(dshHome, version) {
  return path.join(dshHome, "launcher", version);
}

function binIn(dir) {
  return path.join(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
}

function findDshBin(dshHome, npmCache, version) {
  const pinned = binIn(launcherDir(dshHome, version));
  if (fs.existsSync(pinned)) return pinned;

  const npxRoot = path.join(npmCache, "_npx");
  if (!fs.existsSync(npxRoot)) return "";
  try {
    for (const name of fs.readdirSync(npxRoot)) {
      const pkg = path.join(npxRoot, name, "node_modules", "@deepseek-ai", "dsh", "package.json");
      const bin = path.join(npxRoot, name, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
      if (!fs.existsSync(pkg) || !fs.existsSync(bin)) continue;
      try {
        if (JSON.parse(fs.readFileSync(pkg, "utf8")).version === version) return bin;
      } catch {
        /* skip broken cache entry */
      }
    }
  } catch {
    /* ignore unreadable npx cache */
  }
  return "";
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { timeout: 12000, headers: { Accept: "application/json" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        getJson(new URL(res.headers.location, url).href).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("版本查询失败 " + res.statusCode));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("版本查询超时")));
    req.on("error", reject);
  });
}

async function fetchLatest() {
  let last;
  for (const url of REGISTRY_URLS) {
    try {
      const json = await getJson(url);
      const ver = json["dist-tags"] && json["dist-tags"].latest;
      if (ver) return ver;
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("查不到最新版本");
}

function writeLauncherPkg(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "dsh-launcher",
        private: true,
        dependencies: { "@deepseek-ai/dsh": version },
      },
      null,
      2,
    ) + "\n",
  );
}

function runNpmInstall({ dir, npm, env, onLog, onSpawn, extraArgs }) {
  const args = [...npm.prefix, "install", "--no-fund", "--no-audit", ...extraArgs];
  return new Promise((resolve, reject) => {
    const proc = spawn(npm.cmd, args, {
      cwd: dir,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: path.extname(npm.cmd).toLowerCase() === ".cmd",
    });
    if (onSpawn) onSpawn(proc);
    const onData = (chunk) => {
      if (onLog) onLog(chunk.toString("utf8"));
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);
    proc.on("exit", (code) => resolve(code));
  });
}

async function installDsh({ dir, version, npm, env, onLog, onSpawn }) {
  writeLauncherPkg(dir, version);
  let code = await runNpmInstall({
    dir,
    npm,
    env,
    onLog,
    onSpawn,
    extraArgs: ["--prefer-offline"],
  });
  if (code !== 0 || !fs.existsSync(binIn(dir))) {
    if (onLog) onLog("\n离线安装不完整，改为联网安装…\n");
    code = await runNpmInstall({
      dir,
      npm,
      env,
      onLog,
      onSpawn,
      extraArgs: [],
    });
  }
  if (code === 0 && fs.existsSync(binIn(dir))) return binIn(dir);
  throw new Error("安装 dsh " + version + " 失败，退出码 " + code);
}

module.exports = {
  PINNED,
  launcherDir,
  findDshBin,
  fetchLatest,
  installDsh,
};

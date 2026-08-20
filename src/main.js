const { app, BrowserWindow, Menu, Tray, nativeImage, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

if (process.platform === "win32") {
  app.setAppUserModelId("local.dsh.desktop");
}

const READY_MS = 12 * 60 * 1000;
const URL_RE = /dsh web:\s+(https?:\/\/127\.0\.0\.1:\d+)/i;

let win;
let tray;
let child;
let quitting = false;
let cfg;

function alive() {
  return win && !win.isDestroyed();
}

function pushStatus(msg) {
  if (alive()) win.webContents.send("status", msg);
}

function pushLog(msg) {
  if (alive()) win.webContents.send("log", msg);
}

function expandHome(p) {
  if (!p || typeof p !== "string") return "";
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function appDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.resolve(__dirname, "..");
}

function defaults() {
  return {
    dshHome: path.join(os.homedir(), ".dsh"),
    npmCache: "",
    nodeDir: "",
    host: "127.0.0.1",
    port: 0,
  };
}

function loadConfig() {
  const root = appDir();
  const file = path.join(root, "config.json");
  const example = path.join(root, "config.example.json");
  const bundled = path.join(__dirname, "..", "config.example.json");

  if (!fs.existsSync(file)) {
    const src = fs.existsSync(example) ? example : bundled;
    if (fs.existsSync(src)) fs.copyFileSync(src, file);
    else fs.writeFileSync(file, JSON.stringify(defaults(), null, 2) + "\n");
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error("配置文件读不了：" + file + "\n" + e.message);
  }

  const d = defaults();
  const dshHome = expandHome(raw.dshHome || d.dshHome) || d.dshHome;
  return {
    configPath: file,
    dshHome,
    npmCache: expandHome(raw.npmCache || "") || path.join(dshHome, "npm-cache"),
    nodeDir: expandHome(raw.nodeDir || ""),
    host: raw.host || "127.0.0.1",
    port: Number(raw.port) || 0,
  };
}

function findNode(preferred) {
  const extra = [
    preferred,
    process.env.DSH_NODE_DIR,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "nodejs"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "nodejs"),
  ];
  for (const dir of extra) {
    if (dir && fs.existsSync(path.join(dir, "node.exe"))) return dir;
  }
  for (const dir of String(process.env.PATH || "").split(";")) {
    if (dir && fs.existsSync(path.join(dir, "node.exe"))) return dir;
  }
  return "";
}

function findNpx(nodeDir) {
  const nodeExe = path.join(nodeDir, "node.exe");
  const npxCli = path.join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
  const npxCmd = path.join(nodeDir, "npx.cmd");
  if (fs.existsSync(npxCli) && fs.existsSync(nodeExe)) {
    return { cmd: nodeExe, prefix: [npxCli] };
  }
  if (fs.existsSync(npxCmd)) return { cmd: npxCmd, prefix: [] };
  return null;
}

function waitHttp(url, timeout) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, { timeout: 2000 }, (res) => {
        res.resume();
        resolve(url);
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => {
        if (Date.now() - t0 > timeout) reject(new Error("等待服务超时"));
        else setTimeout(tick, 1000);
      });
    };
    tick();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

function killTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  proc.kill("SIGTERM");
}

function asset(...parts) {
  const list = [
    path.join(__dirname, "..", ...parts),
    path.join(process.resourcesPath || "", ...parts),
    path.join(appDir(), ...parts),
  ];
  return list.find((f) => fs.existsSync(f));
}

function trayImage() {
  const png = asset("build", "tray.png") || asset("build", "icon-64.png");
  if (png) {
    const img = nativeImage.createFromPath(png);
    if (!img.isEmpty()) return img;
  }
  const ico = asset("build", "icon.ico");
  if (ico) {
    const img = nativeImage.createFromPath(ico);
    if (!img.isEmpty()) return img.resize({ width: 32, height: 32 });
  }
  return nativeImage.createEmpty();
}

function showWin() {
  if (!alive()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  quitting = true;
  if (child) {
    killTree(child);
    child = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

function makeTray() {
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip("DeepSeek Harness");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开窗口", click: showWin },
      { type: "separator" },
      { label: "退出", click: quitApp },
    ]),
  );
  tray.on("click", showWin);
  tray.on("double-click", showWin);
}

function startDsh(nodeDir, npx, port) {
  fs.mkdirSync(cfg.dshHome, { recursive: true });
  fs.mkdirSync(cfg.npmCache, { recursive: true });

  const env = {
    ...process.env,
    DSH_HOME: cfg.dshHome,
    npm_config_cache: cfg.npmCache,
    PATH: nodeDir + ";" + path.join(process.env.APPDATA || "", "npm") + ";" + (process.env.PATH || ""),
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const args = [...npx.prefix, "--yes", "@deepseek-ai/dsh", "web", "--host", cfg.host, "--port", String(port)];
  pushLog("配置文件: " + cfg.configPath + "\n");
  pushLog("启动命令: " + npx.cmd + " " + args.join(" ") + "\n");
  pushLog("数据目录: " + cfg.dshHome + "\n缓存目录: " + cfg.npmCache + "\n\n");

  child = spawn(npx.cmd, args, {
    cwd: cfg.dshHome,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: path.extname(npx.cmd).toLowerCase() === ".cmd",
  });

  let buf = "";
  const onData = (chunk) => {
    const text = chunk.toString("utf8");
    buf += text;
    pushLog(text);
    const m = buf.match(URL_RE);
    return m ? m[1].replace(/[)>.,;]+$/, "") : "";
  };

  return new Promise((resolve, reject) => {
    let done = false;
    const ok = (url) => {
      if (done) return;
      done = true;
      resolve(url);
    };

    child.stdout.on("data", (c) => {
      const url = onData(c);
      if (url) ok(url);
    });
    child.stderr.on("data", (c) => {
      const url = onData(c);
      if (url) ok(url);
    });
    child.on("error", (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
    child.on("exit", (code) => {
      child = null;
      if (!done) {
        done = true;
        reject(new Error("dsh 提前退出，退出码 " + code));
        return;
      }
      if (!quitting) {
        pushStatus("本地服务已停止");
        quitApp();
      }
    });

    waitHttp("http://127.0.0.1:" + port, READY_MS).then(ok).catch((e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

function makeWindow() {
  Menu.setApplicationMenu(null);
  const icon = asset("build", "icon.ico");
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "DeepSeek Harness",
    backgroundColor: "#111318",
    icon: icon || undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "loading.html"));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (e, url) => {
    const cur = win.webContents.getURL();
    if (cur.startsWith("http://127.0.0.1:") && !url.startsWith("http://127.0.0.1:") && !url.startsWith("http://localhost:")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });

  win.on("closed", () => {
    win = null;
  });
}

async function boot() {
  makeWindow();
  makeTray();

  pushStatus("正在读取配置…");
  cfg = loadConfig();
  pushLog("配置文件: " + cfg.configPath + "\n");

  pushStatus("正在查找 Node.js…");
  const nodeDir = findNode(cfg.nodeDir);
  if (!nodeDir) {
    pushStatus("没找到 Node.js。装 22.19+ / 24+，或在 config.json 里写 nodeDir。");
    return;
  }

  const npx = findNpx(nodeDir);
  if (!npx) {
    pushStatus("在 " + nodeDir + " 里没找到 npx。");
    return;
  }

  pushStatus("正在启动 DeepSeek Harness，第一次可能要等几分钟…");
  const port = cfg.port > 0 ? cfg.port : await freePort();
  const url = await startDsh(nodeDir, npx, port);
  pushStatus("服务已就绪，正在打开界面…");
  if (alive()) await win.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWin);
  app.whenReady().then(() => {
    boot().catch((e) => {
      pushStatus(e.message || String(e));
      pushLog("\n" + (e.stack || e) + "\n");
    });
  });
}

app.on("before-quit", () => {
  quitting = true;
  if (child) {
    killTree(child);
    child = null;
  }
});

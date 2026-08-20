const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const NODE_BIN = IS_WIN ? "node.exe" : "node";

if (IS_WIN) {
  app.setAppUserModelId("com.gpledge.dsh-desktop");
}

const READY_MS = 12 * 60 * 1000;
const URL_RE = /dsh web:\s+(https?:\/\/127\.0\.0\.1:\d+)/i;

let win;
let tray;
let child;
let quitting = false;
let askingClose = false;
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
  if (app.isPackaged) {
    if (IS_MAC) return app.getPath("userData");
    return path.dirname(process.execPath);
  }
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
  fs.mkdirSync(root, { recursive: true });
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

function dirHasNode(dir) {
  if (!dir) return "";
  if (fs.existsSync(path.join(dir, NODE_BIN))) return dir;
  if (fs.existsSync(path.join(dir, "bin", NODE_BIN))) return path.join(dir, "bin");
  return "";
}

function nvmBins() {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  const versions = path.join(nvmDir, "versions", "node");
  if (!fs.existsSync(versions)) return [];
  try {
    return fs
      .readdirSync(versions)
      .sort()
      .reverse()
      .map((name) => path.join(versions, name, "bin"));
  } catch {
    return [];
  }
}

function findNode(preferred) {
  const extra = [
    preferred,
    process.env.DSH_NODE_DIR,
    IS_WIN && process.env.ProgramFiles && path.join(process.env.ProgramFiles, "nodejs"),
    IS_WIN && process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "nodejs"),
    "/opt/homebrew",
    "/usr/local",
    "/usr",
    path.join(os.homedir(), ".volta", "bin"),
    path.join(os.homedir(), ".local"),
    ...nvmBins(),
  ];
  for (const dir of extra) {
    const found = dirHasNode(dir);
    if (found) return found;
  }
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    const found = dirHasNode(dir);
    if (found) return found;
  }
  return "";
}

function findNpx(nodeDir) {
  const nodePath = path.join(nodeDir, NODE_BIN);
  const cliHere = path.join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
  const cliLib = path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js");
  if (fs.existsSync(nodePath) && fs.existsSync(cliHere)) {
    return { cmd: nodePath, prefix: [cliHere] };
  }
  if (fs.existsSync(nodePath) && fs.existsSync(cliLib)) {
    return { cmd: nodePath, prefix: [cliLib] };
  }
  const npxCmd = path.join(nodeDir, "npx.cmd");
  if (IS_WIN && fs.existsSync(npxCmd)) return { cmd: npxCmd, prefix: [] };
  const npx = path.join(nodeDir, "npx");
  if (fs.existsSync(npx)) return { cmd: npx, prefix: [] };
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
  if (IS_WIN) {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  spawn("sh", ["-c", "pkill -TERM -P " + proc.pid + "; kill -TERM " + proc.pid], {
    stdio: "ignore",
  });
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
  const png = asset("build", "tray.png") || asset("build", "icon-64.png") || asset("build", "icon.png");
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
  if (IS_MAC) app.dock.show();
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

function makeMenu() {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { label: "退出", accelerator: "Cmd+Q", click: quitApp },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]),
  );
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

function pathExtra(nodeDir) {
  const parts = [nodeDir];
  if (IS_WIN) {
    parts.push(path.join(process.env.APPDATA || "", "npm"));
  } else {
    parts.push("/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".npm"));
  }
  parts.push(process.env.PATH || "");
  return parts.filter(Boolean).join(path.delimiter);
}

function startDsh(nodeDir, npx, port) {
  fs.mkdirSync(cfg.dshHome, { recursive: true });
  fs.mkdirSync(cfg.npmCache, { recursive: true });

  const env = {
    ...process.env,
    DSH_HOME: cfg.dshHome,
    npm_config_cache: cfg.npmCache,
    PATH: pathExtra(nodeDir),
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
  makeMenu();
  const icon = IS_WIN ? asset("build", "icon.ico") : asset("build", "icon.png") || asset("build", "icon-64.png");
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "DeepSeek Harness",
    backgroundColor: "#111318",
    icon: icon || undefined,
    autoHideMenuBar: !IS_MAC,
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
    if (askingClose) return;
    askingClose = true;
    dialog
      .showMessageBox(win, {
        type: "question",
        buttons: ["最小化到托盘", "退出", "取消"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: "DeepSeek Harness",
        message: "要关闭窗口吗？",
        detail: "最小化后程序继续在托盘运行。",
      })
      .then(({ response }) => {
        askingClose = false;
        if (!alive()) return;
        if (response === 0) win.hide();
        else if (response === 1) quitApp();
      })
      .catch(() => {
        askingClose = false;
      });
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
  app.on("activate", showWin);
}

app.on("before-quit", () => {
  quitting = true;
  if (child) {
    killTree(child);
    child = null;
  }
});

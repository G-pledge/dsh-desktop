const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell, ipcMain, webContents, WebContentsView } = require("electron");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { PINNED, launcherDir, findDshBin, fetchLatest, installDsh } = require("./dsh-install");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const NODE_BIN = IS_WIN ? "node.exe" : "node";

if (IS_WIN) {
  app.setAppUserModelId("com.gpledge.dsh-desktop");
}

const READY_MS = 30 * 60 * 1000;
const URL_RE = /dsh web:\s+(https?:\/\/127\.0\.0\.1:\d+)/i;

let win;
let tray;
let child;
let installProc;
let quitting = false;
let askingClose = false;
let restarting = false;
let updating = false;
let checking = false;
let cfg;
let nodeDir = "";
let npm;
let latestVer = "";

function alive() {
  return win && !win.isDestroyed();
}

function pushStatus(msg) {
  if (alive()) win.webContents.send("status", msg);
}

function pushLog(msg) {
  if (alive()) win.webContents.send("log", msg);
}

const dlItems = new Map();

function uniqueDownloadPath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext) || "download";
  let dest = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${base} (${i})${ext}`);
    i += 1;
  }
  return dest;
}

function emitDownload(payload) {
  if (alive()) win.webContents.send("dsh-download", payload);
}

function hookPartitionSession(sess) {
  const part = String(sess.partition || "");
  if (!part.startsWith("persist:dsh-sp-")) return;
  if (sess.dshDownloadHooked) return;
  sess.dshDownloadHooked = true;
  sess.on("will-download", (_event, item) => {
    const id = "dl-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    const filename = item.getFilename() || "download";
    item.setSavePath(uniqueDownloadPath(app.getPath("downloads"), filename));
    dlItems.set(id, item);
    const push = (state) => {
      emitDownload({
        id,
        filename,
        url: item.getURL(),
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        state,
        savePath: item.getSavePath(),
      });
    };
    push("progressing");
    item.on("updated", (_e, state) => push(state));
    item.on("done", (_e, state) => {
      push(state);
      dlItems.delete(id);
    });
  });
}

app.on("session-created", hookPartitionSession);

ipcMain.on("dsh-download-cancel", (_e, id) => {
  const item = dlItems.get(id);
  if (item) item.cancel();
});

ipcMain.on("dsh-download-show", (_e, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

function hostedBy(guest, sender) {
  let host = guest.hostWebContents;
  while (host) {
    if (host.id === sender.id) return true;
    host = host.hostWebContents;
  }
  return false;
}

function isBrowserGuest(wc) {
  return String(wc.session?.partition || "").startsWith("persist:dsh-sp-");
}

function findDevtoolsGuest(event, payload) {
  const id = Number(payload && typeof payload === "object" ? payload.id : payload);
  const sender = event.sender;
  const alive = webContents.getAllWebContents().filter((wc) => !wc.isDestroyed());
  const byId = Number.isInteger(id) && id > 0
    ? webContents.fromId(id) || alive.find((wc) => wc.id === id)
    : null;
  if (byId && !byId.isDestroyed() && (hostedBy(byId, sender) || isBrowserGuest(byId))) return byId;
  return alive.find((wc) => hostedBy(wc, sender) && isBrowserGuest(wc))
    || alive.find((wc) => isBrowserGuest(wc))
    || null;
}

function findById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const found = webContents.fromId(n) || webContents.getAllWebContents().find((wc) => wc.id === n);
  if (!found || found.isDestroyed()) return null;
  return found;
}

function hostWindow(sender) {
  return BrowserWindow.fromWebContents(sender) || (alive() ? win : null);
}

function dipBox(sender, box) {
  const zoom = typeof sender.getZoomFactor === "function" ? sender.getZoomFactor() : 1;
  const scale = Number(zoom) > 0 ? Number(zoom) : 1;
  const x = Math.round(Number(box?.x) * scale) || 0;
  const y = Math.round(Number(box?.y) * scale) || 0;
  const width = Math.max(0, Math.round(Number(box?.width) * scale) || 0);
  const height = Math.max(0, Math.round(Number(box?.height) * scale) || 0);
  const visible = box?.visible !== false && width >= 32 && height >= 32;
  return { x, y, width, height, visible };
}

let dockedTools = null;

function fillMainView(host) {
  if (!host || host.isDestroyed()) return;
  const [width, height] = host.getContentSize();
  for (const child of host.contentView.children) {
    if (dockedTools && child === dockedTools.view) continue;
    try {
      child.setBounds({ x: 0, y: 0, width, height });
    } catch {
      // 这一层不让改大小
    }
  }
}

function hideDockedView(view) {
  try {
    view.setVisible(false);
  } catch {
    // 旧版本没有
  }
  try {
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  } catch {
    // 已经卸了
  }
}

function destroyDockedTools() {
  const current = dockedTools;
  dockedTools = null;
  if (!current) return;
  try {
    const page = findById(current.pageId);
    if (page && !page.isDestroyed() && page.isDevToolsOpened()) page.closeDevTools();
  } catch {
    // 页面已经没了
  }
  try {
    const host = BrowserWindow.fromId(current.hostId) || (alive() ? win : null);
    if (host && !host.isDestroyed()) {
      host.contentView.removeChildView(current.view);
      fillMainView(host);
    }
  } catch {
    // 窗口已经关了
  }
  try {
    if (current.view.webContents && !current.view.webContents.isDestroyed()) {
      current.view.webContents.close();
    }
  } catch {
    // 调试器画布已经拆了
  }
}

function placeDockedView(view, bounds) {
  if (!bounds.visible) {
    hideDockedView(view);
    return;
  }
  view.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  try {
    view.setVisible(true);
  } catch {
    // 旧版本没有
  }
}

function openDockedTools(sender, page, bounds) {
  const host = hostWindow(sender);
  if (!host || !WebContentsView) return { ok: false };
  if (dockedTools && dockedTools.pageId !== page.id) destroyDockedTools();
  if (!dockedTools) {
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        partition: "persist:dsh-devtools",
        backgroundThrottling: false,
      },
    });
    try {
      view.setBackgroundColor("#202124");
    } catch {
      // 旧版本没有
    }
    host.contentView.addChildView(view);
    fillMainView(host);
    try {
      if (page.isDevToolsOpened()) page.closeDevTools();
    } catch {
      // 本来就没开
    }
    page.setDevToolsWebContents(view.webContents);
    page.openDevTools({ mode: "detach" });
    dockedTools = { view, pageId: page.id, hostId: host.id };
  }
  placeDockedView(dockedTools.view, bounds);
  return { ok: true };
}

function openGuestDevtoolsWindow(guest) {
  destroyDockedTools();
  if (guest.isDevToolsOpened()) {
    guest.closeDevTools();
    return;
  }
  guest.openDevTools({ mode: "detach" });
}

ipcMain.handle("dsh-webview-devtools", (event, payload) => {
  const guest = findDevtoolsGuest(event, payload);
  if (!guest) return { ok: false };
  try {
    openGuestDevtoolsWindow(guest);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle("dsh-webview-devtools-attach", (event, payload) => {
  const page = findById(payload?.pageId);
  if (!page) return { ok: false };
  if (!hostedBy(page, event.sender) && !isBrowserGuest(page)) return { ok: false };
  try {
    return openDockedTools(event.sender, page, dipBox(event.sender, payload?.box));
  } catch {
    destroyDockedTools();
    return { ok: false };
  }
});

ipcMain.on("dsh-webview-devtools-move", (event, box) => {
  if (!dockedTools) return;
  try {
    placeDockedView(dockedTools.view, dipBox(event.sender, box));
  } catch {
    // 窗口正在关
  }
});

ipcMain.handle("dsh-webview-devtools-close", () => {
  destroyDockedTools();
  return { ok: true };
});

function openWhenReady(url) {
  if (!url || !alive()) return;
  pushStatus("服务已就绪，正在打开界面…");
  win.loadURL(url).catch(() => {});
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
    dshVersion: PINNED,
  };
}

function patchConfigFile(file, patch) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    raw = {};
  }
  fs.writeFileSync(file, JSON.stringify({ ...raw, ...patch }, null, 2) + "\n");
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
  const dshVersion = String(raw.dshVersion || d.dshVersion || PINNED).trim() || PINNED;
  const loaded = {
    configPath: file,
    dshHome,
    npmCache: expandHome(raw.npmCache || "") || path.join(dshHome, "npm-cache"),
    nodeDir: expandHome(raw.nodeDir || ""),
    host: raw.host || "127.0.0.1",
    port: Number(raw.port) || 0,
    dshVersion,
  };
  if (!raw.dshVersion) patchConfigFile(file, { dshVersion });
  return loaded;
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

function findNpm(dir) {
  const nodePath = path.join(dir, NODE_BIN);
  const cliHere = path.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
  const cliLib = path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(nodePath) && fs.existsSync(cliHere)) {
    return { cmd: nodePath, prefix: [cliHere] };
  }
  if (fs.existsSync(nodePath) && fs.existsSync(cliLib)) {
    return { cmd: nodePath, prefix: [cliLib] };
  }
  const npmCmd = path.join(dir, "npm.cmd");
  if (IS_WIN && fs.existsSync(npmCmd)) return { cmd: npmCmd, prefix: [] };
  const npmBin = path.join(dir, "npm");
  if (fs.existsSync(npmBin)) return { cmd: npmBin, prefix: [] };
  return null;
}

function waitHttp(url, stopped) {
  const parsed = new URL(url);
  return new Promise((resolve) => {
    const tick = () => {
      if (stopped()) return;
      const req = http.get(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: "/",
          family: 4,
          timeout: 2000,
          agent: false,
        },
        (res) => {
          res.resume();
          resolve(url);
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => {
        if (!stopped()) setTimeout(tick, 1000);
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

function killStrayDsh() {
  try {
    if (IS_WIN) {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-WindowStyle",
          "Hidden",
          "-Command",
          "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*dsh*bin.js*web*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        ],
        { timeout: 8000, windowsHide: true, stdio: "ignore" },
      );
    } else {
      execFileSync("pkill", ["-f", "dsh/lib/bin.js"], { timeout: 5000, stdio: "ignore" });
    }
  } catch (_) {}
}

function killTree(proc) {
  if (proc && proc.pid) {
    if (IS_WIN) {
      try {
        execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
          timeout: 8000,
          windowsHide: true,
          stdio: "ignore",
        });
      } catch (_) {}
    } else {
      try {
        execFileSync("sh", ["-c", "pkill -TERM -P " + proc.pid + "; kill -TERM " + proc.pid], {
          timeout: 5000,
          stdio: "ignore",
        });
      } catch (_) {}
    }
  }
}

function stopDsh() {
  restarting = true;
  if (child) {
    killTree(child);
    child = null;
  }
  killStrayDsh();
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
  if (installProc) {
    killTree(installProc);
    installProc = null;
  }
  if (child) {
    killTree(child);
    child = null;
  }
  killStrayDsh();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

function refreshTray() {
  if (!tray) return;
  const ver = (cfg && cfg.dshVersion) || PINNED;
  const busy = updating || checking;
  const items = [
    { label: "打开窗口", click: showWin, enabled: !updating },
    { type: "separator" },
    { label: "当前版本 " + ver, enabled: false },
  ];
  if (latestVer && latestVer !== ver) {
    items.push({
      label: updating ? "正在更新…" : "更新到 " + latestVer,
      enabled: !busy,
      click: () => updateTo(latestVer),
    });
  } else if (latestVer && latestVer === ver) {
    items.push({ label: "已是最新", enabled: false });
  }
  items.push({
    label: checking ? "正在检查…" : "检查更新",
    enabled: !busy,
    click: () => checkLatest({ alert: true }),
  });
  items.push({ type: "separator" });
  items.push({ label: "退出", click: quitApp });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(latestVer && latestVer !== ver ? "DeepSeek Harness 有新版本 " + latestVer : "DeepSeek Harness");
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
          { label: "检查更新", click: () => checkLatest({ alert: true }) },
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
  if (!tray) {
    tray = new Tray(trayImage());
    tray.on("click", showWin);
    tray.on("double-click", showWin);
  }
  refreshTray();
}

function pathExtra(dir) {
  const parts = [dir];
  if (IS_WIN) {
    parts.push(path.join(process.env.APPDATA || "", "npm"));
  } else {
    parts.push("/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".npm"));
  }
  parts.push(process.env.PATH || "");
  return parts.filter(Boolean).join(path.delimiter);
}

function runtimeEnv() {
  const env = {
    ...process.env,
    DSH_HOME: cfg.dshHome,
    npm_config_cache: cfg.npmCache,
    PATH: pathExtra(nodeDir),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function isLoadingPage() {
  if (!alive()) return false;
  return win.webContents.getURL().includes("loading.html");
}

async function showLoading(status) {
  if (!alive()) return;
  if (!isLoadingPage()) {
    await win.loadFile(path.join(__dirname, "loading.html"));
  }
  if (status) pushStatus(status);
}

function startDsh(bin, port) {
  killStrayDsh();
  fs.mkdirSync(cfg.dshHome, { recursive: true });
  fs.mkdirSync(cfg.npmCache, { recursive: true });

  const nodePath = path.join(nodeDir, NODE_BIN);
  const args = [bin, "web", "--host", cfg.host, "--port", String(port), "--no-open"];
  pushLog("配置文件: " + cfg.configPath + "\n");
  pushLog("dsh 版本: " + cfg.dshVersion + "\n");
  pushLog("启动命令: " + nodePath + " " + args.join(" ") + "\n");
  pushLog("数据目录: " + cfg.dshHome + "\n缓存目录: " + cfg.npmCache + "\n\n");

  child = spawn(nodePath, args, {
    cwd: cfg.dshHome,
    env: runtimeEnv(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const proc = child;
  restarting = false;

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
    let timer;
    const stopped = () => done;

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };

    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new Error("等待服务超时")), READY_MS);
    };

    const ok = (url) => {
      if (done) {
        openWhenReady(url);
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve(url);
    };

    bump();
    proc.stdout.on("data", (c) => {
      bump();
      const url = onData(c);
      if (url) ok(url);
    });
    proc.stderr.on("data", (c) => {
      bump();
      const url = onData(c);
      if (url) ok(url);
    });
    proc.on("error", (e) => finish(reject, e));
    proc.on("exit", (code) => {
      if (child === proc) child = null;
      if (restarting || quitting) return;
      if (!done) finish(reject, new Error("dsh 提前退出，退出码 " + code));
      else {
        pushStatus("本地服务已停止");
        quitApp();
      }
    });

    waitHttp("http://127.0.0.1:" + port, stopped).then(ok);
  });
}

async function ensureBin(version) {
  let bin = findDshBin(cfg.dshHome, cfg.npmCache, version);
  if (bin) return bin;
  const dir = launcherDir(cfg.dshHome, version);
  pushStatus("正在安装 DeepSeek Harness " + version + "，可能要几分钟…");
  pushLog("安装目录: " + dir + "\n\n");
  bin = await installDsh({
    dir,
    version,
    npm,
    env: runtimeEnv(),
    onLog: pushLog,
    onSpawn: (proc) => {
      installProc = proc;
    },
  });
  installProc = null;
  return bin;
}

async function ensureAndStart() {
  const bin = await ensureBin(cfg.dshVersion);
  pushStatus("正在启动 DeepSeek Harness " + cfg.dshVersion + "…");
  const port = cfg.port > 0 ? cfg.port : await freePort();
  const url = await startDsh(bin, port);
  pushStatus("服务已就绪，正在打开界面…");
  if (alive()) await win.loadURL(url);
}

async function checkLatest(opts) {
  const alert = opts && opts.alert;
  if (checking || updating) return;
  checking = true;
  refreshTray();
  try {
    latestVer = await fetchLatest();
    refreshTray();
    if (!alert) return;
    showWin();
    if (latestVer === cfg.dshVersion) {
      await dialog.showMessageBox(win, {
        type: "info",
        buttons: ["好"],
        noLink: true,
        title: "DeepSeek Harness",
        message: "已是最新",
        detail: "当前版本 " + cfg.dshVersion,
      });
    } else {
      const { response } = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["更新", "取消"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: "DeepSeek Harness",
        message: "有新版本 " + latestVer,
        detail: "现在是 " + cfg.dshVersion + "。下载可能要几分钟，失败的话还用现在这版。",
      });
      if (response === 0) await updateTo(latestVer, { skipConfirm: true });
    }
  } catch (e) {
    if (alert) {
      showWin();
      await dialog.showMessageBox(win, {
        type: "error",
        buttons: ["好"],
        noLink: true,
        title: "DeepSeek Harness",
        message: "检查更新失败",
        detail: e.message || String(e),
      });
    }
  } finally {
    checking = false;
    refreshTray();
  }
}

async function updateTo(version, opts) {
  if (!version || updating || version === cfg.dshVersion) return;
  if (!(opts && opts.skipConfirm)) {
    const { response } = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["更新", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "DeepSeek Harness",
      message: "更新到 " + version + "？",
      detail: "可能要几分钟。窗口会先回到启动页。失败的话还用 " + cfg.dshVersion + "。",
    });
    if (response !== 0) return;
  }

  const prev = cfg.dshVersion;
  updating = true;
  refreshTray();
  showWin();
  try {
    await showLoading("正在更新到 " + version + "…");
    stopDsh();
    cfg.dshVersion = version;
    await ensureAndStart();
    patchConfigFile(cfg.configPath, { dshVersion: version });
    latestVer = version;
  } catch (e) {
    cfg.dshVersion = prev;
    pushStatus("更新失败，正在回到 " + prev);
    pushLog("\n" + (e.stack || e.message || String(e)) + "\n");
    try {
      await ensureAndStart();
    } catch (e2) {
      pushStatus("更新失败，旧版也没起来：" + (e2.message || e2));
    }
    showWin();
    dialog.showMessageBox(win, {
      type: "error",
      buttons: ["好"],
      noLink: true,
      title: "DeepSeek Harness",
      message: "更新失败",
      detail: (e.message || String(e)) + "\n仍使用 " + prev,
    });
  } finally {
    updating = false;
    refreshTray();
  }
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
      webviewTag: true,
    },
  });

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

  win.on("resize", () => {
    fillMainView(win);
  });

  win.on("closed", () => {
    destroyDockedTools();
    win = null;
  });

  return win.loadFile(path.join(__dirname, "loading.html"));
}

async function boot() {
  await makeWindow();
  cfg = loadConfig();
  makeTray();

  pushStatus("正在读取配置…");
  pushLog("配置文件: " + cfg.configPath + "\n");

  pushStatus("正在查找 Node.js…");
  nodeDir = findNode(cfg.nodeDir);
  if (!nodeDir) {
    pushStatus("没找到 Node.js。装 22.19+ / 24+，或在 config.json 里写 nodeDir。");
    return;
  }

  npm = findNpm(nodeDir);
  if (!npm) {
    pushStatus("在 " + nodeDir + " 里没找到 npm。");
    return;
  }

  refreshTray();
  await ensureAndStart();
  checkLatest({ alert: false });
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
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
}

app.on("before-quit", () => {
  quitting = true;
  destroyDockedTools();
  if (installProc) {
    killTree(installProc);
    installProc = null;
  }
  if (child) {
    killTree(child);
    child = null;
  }
  killStrayDsh();
});

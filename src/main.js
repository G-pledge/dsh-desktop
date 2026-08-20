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

const READY_TIMEOUT_MS = 12 * 60 * 1000;
const URL_RE = /dsh web:\s+(https?:\/\/127\.0\.0\.1:\d+)/i;
const CONFIG_NAME = "config.json";

let mainWindow = null;
let tray = null;
let child = null;
let stopping = false;
let quitRequested = false;
let appConfig = null;

function sendStatus(text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status", text);
  }
}

function sendLog(text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log", text);
  }
}

function expandHome(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function getAppRootDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  return path.resolve(__dirname, "..");
}

function defaultConfig() {
  return {
    dshHome: path.join(os.homedir(), ".dsh"),
    npmCache: "",
    nodeDir: "",
    host: "127.0.0.1",
    port: 0,
  };
}

function loadConfig() {
  const root = getAppRootDir();
  const configPath = path.join(root, CONFIG_NAME);
  const examplePath = path.join(root, "config.example.json");
  const bundledExample = path.join(__dirname, "..", "config.example.json");

  if (!fs.existsSync(configPath)) {
    const templateSource = fs.existsSync(examplePath)
      ? examplePath
      : fs.existsSync(bundledExample)
        ? bundledExample
        : "";
    if (templateSource) {
      fs.copyFileSync(templateSource, configPath);
    } else {
      fs.writeFileSync(configPath, `${JSON.stringify(defaultConfig(), null, 2)}\n`, "utf8");
    }
  }

  let raw = {};
  try {
    const text = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`配置文件读不了：${configPath}\n${error.message}`);
  }

  const defaults = defaultConfig();
  const dshHome = expandHome(raw.dshHome || defaults.dshHome) || defaults.dshHome;
  const npmCache =
    expandHome(raw.npmCache || "") || path.join(dshHome, "npm-cache");
  const nodeDir = expandHome(raw.nodeDir || "");
  const host = typeof raw.host === "string" && raw.host ? raw.host : "127.0.0.1";
  const port = Number.isFinite(Number(raw.port)) ? Number(raw.port) : 0;

  return {
    configPath,
    dshHome,
    npmCache,
    nodeDir,
    host,
    port,
  };
}

function findNodeDir(preferredDir) {
  const candidates = [
    preferredDir,
    process.env.DSH_NODE_DIR,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs") : "",
    process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"], "nodejs")
      : "",
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "node.exe"))) {
      return dir;
    }
  }

  const pathDirs = String(process.env.PATH || "").split(";");
  for (const dir of pathDirs) {
    if (dir && fs.existsSync(path.join(dir, "node.exe"))) {
      return dir;
    }
  }

  return "";
}

function resolveNpx(nodeDir) {
  const npxCli = path.join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
  const nodeExe = path.join(nodeDir, "node.exe");
  const npxCmd = path.join(nodeDir, "npx.cmd");

  if (fs.existsSync(npxCli) && fs.existsSync(nodeExe)) {
    return { command: nodeExe, argsPrefix: [npxCli] };
  }
  if (fs.existsSync(npxCmd)) {
    return { command: npxCmd, argsPrefix: [] };
  }
  return null;
}

function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, { timeout: 2000 }, (res) => {
        res.resume();
        resolve(url);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error("等待服务超时"));
          return;
        }
        setTimeout(tick, 1000);
      });
      req.on("timeout", () => {
        req.destroy();
      });
    };
    tick();
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  proc.kill("SIGTERM");
}

function resolveAsset(...parts) {
  const candidates = [
    path.join(__dirname, "..", ...parts),
    path.join(process.resourcesPath || "", ...parts),
    path.join(getAppRootDir(), ...parts),
  ];
  return candidates.find((file) => fs.existsSync(file));
}

function resolveIconPath() {
  return resolveAsset("build", "icon.ico");
}

function resolveTrayImage() {
  const pngPath = resolveAsset("build", "tray.png") || resolveAsset("build", "icon-64.png");
  const icoPath = resolveIconPath();
  if (pngPath) {
    const image = nativeImage.createFromPath(pngPath);
    if (!image.isEmpty()) {
      return image;
    }
  }
  if (icoPath) {
    const image = nativeImage.createFromPath(icoPath);
    if (!image.isEmpty()) {
      return image.resize({ width: 32, height: 32 });
    }
  }
  return nativeImage.createEmpty();
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.hide();
}

function requestQuit() {
  quitRequested = true;
  stopping = true;
  if (child) {
    killProcessTree(child);
    child = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

function createTray() {
  if (tray) {
    return;
  }
  const image = resolveTrayImage();
  tray = new Tray(image);
  tray.setToolTip("DeepSeek Harness");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开窗口",
        click: () => showMainWindow(),
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => requestQuit(),
      },
    ]),
  );
  tray.on("double-click", () => showMainWindow());
  tray.on("click", () => showMainWindow());
}

function startDsh(nodeDir, npx, port) {
  const { dshHome, npmCache, host } = appConfig;
  fs.mkdirSync(dshHome, { recursive: true });
  fs.mkdirSync(npmCache, { recursive: true });

  const env = {
    ...process.env,
    DSH_HOME: dshHome,
    npm_config_cache: npmCache,
    PATH: `${nodeDir};${path.join(process.env.APPDATA || "", "npm")};${process.env.PATH || ""}`,
    ELECTRON_RUN_AS_NODE: "",
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const args = [
    ...npx.argsPrefix,
    "--yes",
    "@deepseek-ai/dsh",
    "web",
    "--host",
    host,
    "--port",
    String(port),
  ];

  sendLog(`配置文件: ${appConfig.configPath}\n`);
  sendLog(`启动命令: ${npx.command} ${args.join(" ")}\n`);
  sendLog(`数据目录: ${dshHome}\n缓存目录: ${npmCache}\n\n`);

  child = spawn(npx.command, args, {
    cwd: dshHome,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: path.extname(npx.command).toLowerCase() === ".cmd",
  });

  let buffer = "";
  const onChunk = (chunk) => {
    const text = chunk.toString("utf8");
    buffer += text;
    sendLog(text);
    const match = buffer.match(URL_RE);
    if (match) {
      return match[1].replace(/[)>.,;]+$/, "");
    }
    return "";
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (url) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(url);
    };

    child.stdout.on("data", (chunk) => {
      const url = onChunk(chunk);
      if (url) {
        finish(url);
      }
    });
    child.stderr.on("data", (chunk) => {
      const url = onChunk(chunk);
      if (url) {
        finish(url);
      }
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("exit", (code) => {
      child = null;
      if (!settled) {
        settled = true;
        reject(new Error(`dsh 提前退出，退出码 ${code}`));
        return;
      }
      if (!stopping) {
        sendStatus("本地服务已停止");
        requestQuit();
      }
    });

    const expectedUrl = `http://127.0.0.1:${port}`;
    waitForHttp(expectedUrl, READY_TIMEOUT_MS)
      .then(finish)
      .catch((error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const icon = resolveIconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "DeepSeek Harness",
    backgroundColor: "#111318",
    show: true,
    ...(icon ? { icon } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "loading.html"));
  mainWindow.focus();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (
      current.startsWith("http://127.0.0.1:") &&
      !url.startsWith("http://127.0.0.1:") &&
      !url.startsWith("http://localhost:")
    ) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("close", (event) => {
    if (quitRequested) {
      return;
    }
    event.preventDefault();
    hideToTray();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function boot() {
  // 先出窗口，再挂托盘，减少首屏等待感
  createWindow();
  createTray();
  sendStatus("正在读取配置…");
  appConfig = loadConfig();
  sendLog(`配置文件: ${appConfig.configPath}\n`);

  sendStatus("正在查找 Node.js…");
  const nodeDir = findNodeDir(appConfig.nodeDir);
  if (!nodeDir) {
    sendStatus("没有找到 Node.js。请安装 Node.js 22.19+ / 24+，或在 config.json 里填写 nodeDir。");
    return;
  }

  const npx = resolveNpx(nodeDir);
  if (!npx) {
    sendStatus(`在 ${nodeDir} 里没有找到 npx。`);
    return;
  }

  sendStatus("正在启动 DeepSeek Harness，第一次可能要等几分钟…");
  const port = appConfig.port > 0 ? appConfig.port : await getFreePort();
  const url = await startDsh(nodeDir, npx, port);
  sendStatus("服务已就绪，正在打开界面…");
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(url);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    boot().catch((error) => {
      sendStatus(error.message || String(error));
      sendLog(`\n${error.stack || error}\n`);
    });
  });
}

app.on("window-all-closed", () => {
  // 关窗口只进托盘，不退出进程
});

app.on("before-quit", () => {
  quitRequested = true;
  stopping = true;
  if (child) {
    killProcessTree(child);
    child = null;
  }
});

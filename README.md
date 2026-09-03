# DeepSeek Harness 桌面版（Electron）

DeepSeek Harness（dsh）的桌面壳。独立窗口打开本地界面，关窗口进托盘。支持 Windows 和 macOS。

需要 Node.js 22.19+ / 24+，以及 DeepSeek API Key。

安装包在 [Releases](https://github.com/G-pledge/dsh-desktop/releases)：**Windows 下 zip（解压后直接开 exe），Mac 下 dmg**。推进 `main` 后会自动打包并挂上去。

```bat
npm install
npm start
```

Windows 本地打包：

```bat
npm run pack
```

跑 `dist\启动.bat`，或者直接开 `dist\win-unpacked\DeepSeek Harness.exe`。Release 里的 Windows zip 解压后直接运行 exe。

Mac 本地打包（要在 Mac 上）：

```bash
npm run pack:mac
```

Mac 安装包没签名，第一次打开要在访达里右键图标选「打开」。

`config.json` 第一次会自动生成。Windows Release 解压后 exe 旁边就有一份，可直接改。Mac 放在 `~/Library/Application Support/DeepSeek Harness/`。仓库里不要提交你自己的 `config.json`。

```json
{
  "dshHome": "~/.dsh",
  "npmCache": "",
  "nodeDir": "",
  "host": "127.0.0.1",
  "port": 0,
  "dshVersion": "0.1.1-rc.2"
}
```

`nodeDir` / `npmCache` 空着就自动找。`port` 填 `0` 表示随便占一个。`dshVersion` 是钉死的 dsh 版本，启动不会每次去追最新。托盘右键可以「检查更新」，有新版本再点更新。

本机打包若不想每次把数据目录打回默认值，可在仓库根放一份 `config.user.json`（不要提交），`npm run pack` 会在 exe 旁边缺配置时用它。

点 × 会问你：最小化到托盘，还是退出。托盘右键也可以退出。Mac 也可用菜单栏 DeepSeek Harness → 退出，或 Command+Q。

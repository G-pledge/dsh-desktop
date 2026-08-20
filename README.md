# DeepSeek Harness 桌面版（Electron）

DeepSeek Harness（dsh）的桌面壳。独立窗口打开本地界面，关窗口进托盘。支持 Windows 和 macOS。

需要 Node.js 22.19+ / 24+，以及 DeepSeek API Key。

安装包在 [Releases](https://github.com/G-pledge/dsh-desktop/releases)：**Windows 下 zip，Mac 下 dmg**。推进 `main` 后会自动打包并挂上去。

```bat
npm install
npm start
```

Windows 本地打包：

```bat
npm run pack
```

跑 `dist\启动.bat`，或者直接开 `dist\win-unpacked\DeepSeek Harness.exe`。

Mac 本地打包（要在 Mac 上）：

```bash
npm run pack:mac
```

Mac 安装包没签名，第一次打开要在访达里右键图标选「打开」。

`config.json` 第一次会自动生成。Windows 放解压后的 exe 旁边，Mac 放在 `~/Library/Application Support/DeepSeek Harness/`。仓库里只有 `config.example.json`，别把自己的配置提交上去。

```json
{
  "dshHome": "~/.dsh",
  "npmCache": "",
  "nodeDir": "",
  "host": "127.0.0.1",
  "port": 0
}
```

`nodeDir` / `npmCache` 空着就自动找。`port` 填 `0` 表示随便占一个。

点关闭进托盘，托盘右键退出。Mac 也可用菜单栏 DeepSeek Harness → 退出，或 Command+Q。

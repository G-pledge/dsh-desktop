# DeepSeek Harness 桌面版（Electron）

DeepSeek Harness（dsh）的桌面壳。独立窗口打开本地界面，关窗口进托盘。支持 Windows 和 macOS。

需要 Node.js 22.19+ / 24+，以及 DeepSeek API Key。

```bat
npm install
npm start
```

Windows 打包：

```bat
npm run pack
```

跑 `dist\启动.bat`，或者直接开 `dist\win-unpacked\DeepSeek Harness.exe`。

Mac 打包要在 Mac 上，或者等 GitHub Actions 打好。开 PR、推进 `main`，或打 `v*` 标签都会自动打包。跑完后到这次运行页面底下下载 `dsh-desktop-mac`：

```bash
npm run pack:mac
```

会生成 `dist` 里的 dmg / zip。没签名，第一次打开要在访达里右键图标选「打开」。

`config.json` 第一次会自动生成。Windows 放 exe 旁边，Mac 放在 `~/Library/Application Support/DeepSeek Harness/`。仓库里只有 `config.example.json`，别把自己的配置提交上去。

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

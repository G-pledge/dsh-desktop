# DeepSeek Harness Windows 桌面版（Electron）

DeepSeek Harness（dsh）的 Windows 桌面壳。独立窗口打开本地界面，关窗口进系统托盘。

需要 Node.js 22.19+ / 24+，以及 DeepSeek API Key。

```bat
npm install
npm start
```

打包：

```bat
npm run pack
```

跑 `dist\启动.bat`，或者直接开 `dist\win-unpacked\DeepSeek Harness.exe`。

`config.json` 放 exe 旁边，第一次会自动生成。仓库里只有 `config.example.json`，别把自己的配置提交上去。

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

点 × 进托盘，托盘右键退出。

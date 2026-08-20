# DeepSeek Harness Desktop

把 DeepSeek Harness 的网页界面包进独立桌面窗口，支持系统托盘常驻。

## 你需要什么

- Windows 10/11
- Node.js `22.19+` 或 `24+`
- DeepSeek API Key（在软件里填写）

## 本地开发

```bat
npm install
npm start
```

打包成可直接运行的目录：

```bat
npm run pack
```

然后打开：

- `dist\启动.bat`
- 或 `dist\win-unpacked\DeepSeek Harness.exe`

> 不要用旧的单文件便携版思路：那种每次启动都要解压，会很慢。

## 配置文件

程序旁边的 `config.json` 可改路径（首次运行会自动生成）：

```json
{
  "dshHome": "~/.dsh",
  "npmCache": "",
  "nodeDir": "",
  "host": "127.0.0.1",
  "port": 0
}
```

- `dshHome`：数据目录
- `npmCache`：下载缓存；空着就放在数据目录下
- `nodeDir`：Node 安装目录；空着就自动查找
- `port`：`0` 表示自动分配

仓库里只提交 `config.example.json`，不要提交你自己的 `config.json`。

## 使用说明

- 点窗口 **×**：最小化到托盘，服务继续跑
- 托盘图标单击/双击：重新打开窗口
- 托盘右键 **退出**：结束程序

## 许可证

MIT

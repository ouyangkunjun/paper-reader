# Paper Reader

Paper Reader 是一个面向论文阅读的双栏本地阅读器。公开版可以部署到 GitHub Pages，别人打开链接后直接在浏览器里选择自己的本机文献文件夹使用，不需要运行 Python，也不会把 PDF 上传到 GitHub、你的电脑或任何服务器。

## 在线使用（GitHub Pages）

部署后打开：

```text
https://<你的 GitHub 用户名>.github.io/paper-reader/
```

在网页里点击“选择文件夹”，选择包含 PDF 的本机文件夹即可开始阅读。

静态网页支持：

- PDF 原文与同名译文并排阅读。
- 自动匹配 `.pdf`、`.md`、`.txt`、`.html` 译文。
- 搜索、全部/未读/已读/有译文/无译文筛选。
- 已读、星标、标签分类、文献显示名和文献详情卡片。
- 手动绑定译文，自动匹配失败时可以自己指定译文文件。
- 阅读进度记忆，重新打开文献时恢复上次阅读位置。
- 双栏、仅原文、仅译文、上下排列等阅读模式。
- 文字批注和全部批注总览。
- 可选的 MiMo API 问答：支持粘贴图片、截图翻译、Markdown/公式排版和每篇文献独立的连续对话历史。
- AI 问答框中按 `Enter` 发送，按 `Shift + Enter` 换行；方向键可翻阅之前问过的问题。
- 左侧统计总数、已读、星标、有译文、无译文和批注数。
- 阅读数据导入/导出，便于备份或换浏览器。
- 7 天未导出时显示本地备份提醒。
- 所有阅读数据保存在访问者自己的浏览器 localStorage 中。

## 译文命名

把译文放在原文旁边，文件名和原文主文件名对应即可。例如原文是：

```text
OC20.pdf
```

译文可以是：

```text
OC20_中文.pdf
OC20_翻译.pdf
OC20_译文.pdf
OC20_zh.pdf
OC20_cn.pdf
OC20_translation.md
OC20_translation.html
```

## 部署到 GitHub Pages

1. 新建公开仓库 `paper-reader`。
2. 推送本项目代码。
3. 在 GitHub 仓库打开 `Settings -> Pages`。
4. Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，Folder 选择 `/docs`。
6. 等待 GitHub Pages 构建完成后访问页面链接。

建议使用公开仓库。私人仓库的 Pages 受 GitHub 账号计划和访问权限限制，不适合作为“所有人直接打开链接使用”的网页。

## Python 增强版

如果你希望在自己电脑上运行完整后端功能，可以启动 Python 版：

```powershell
.\run_reader.bat
```

然后打开：

```text
http://127.0.0.1:8765
```

增强版包含静态网页不具备的服务端能力：

- 登录/注册、多用户文献库。
- 服务端上传、重命名、删除、批量管理。
- 服务端 AI 全文翻译、AI 问答和相关文献搜索。
- 服务端 PDF 渲染缓存和文字层接口。
- 局域网访问和可选公网隧道。

不同 Wi-Fi / 外网访问可使用 Cloudflare Tunnel，但公开仓库不会包含 `cloudflared.exe`。请自行从 Cloudflare 官方渠道安装，或把可执行文件放到 `tools/` 后运行：

```powershell
.\run_reader_public_cloudflared.bat
```

## 隐私说明

公开仓库不应包含私人论文、邮箱、批注、会话、缓存或日志。`.gitignore` 已默认排除这些内容。GitHub Pages 静态版只读取访问者自己授权选择的本机文件夹。静态版的 API Key 和 AI 对话历史只保存在当前浏览器中，并会包含在用户主动导出的阅读数据备份里。

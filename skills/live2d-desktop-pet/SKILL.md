---
name: live2d-desktop-pet
description: 帮助 dsh-live2d-avatar 插件的用户启用"独立桌宠窗口"（透明、无边框、置顶小窗），或在遇到"点桌宠没窗口/只显示页面内浮层"时排查。当用户提到 桌宠模式、桌面桌宠、桌宠没反应、没有独立窗口、页面内浮层、怎么配桌宠、桌宠需要 Electron 等场景时使用。涵盖 Electron 检测、配置路径/vendor/环境变量、重启验证、读取日志定位失败原因。
---

# Live2D 独立桌宠配置与排错

`dsh-live2d-avatar` 插件的"桌宠模式"尝试把 Live2D 角色放进一个**独立、透明、置顶的小窗口**。它需要一个**通用 Electron CLI** 来"代开"窗口（插件自身跑在会受限的 utilityProcess 里，无法建窗）。

目标用户分两类：
- **开发版 / 未打包的 DSH Desktop**：通常免配置，可直接用。
- **安装版 TokensCowork**：需要给插件一个可用的 Electron。
- **浏览器版 `dsh web`**：浏览器无法建系统窗口，只能页面内浮层，无需配置。

## 第一步：确认用户目标

问清/确认用户想要的是哪种：
- 想要角色出现在独立桌面窗口（浮在其他应用上面）→ 继续本技能。
- 只是用页面内浮层即可 → 无需配置。
- 明确是浏览器版 → 直接说明浏览器无法建独立窗口。

## 第二步：检测当前状态与机器上的 Electron

在用户机器上检测（可运行 PowerShell）：

```powershell
# 1) 插件设置里的路径
Write-Output "DSH_LIVE2D_AVATAR_ELECTRON=[$env:DSH_LIVE2D_AVATAR_ELECTRON]"
# 2) 系统 PATH 上的 electron
Get-Command electron.exe -ErrorAction SilentlyContinue | Select-Object Source
# 3) 常见位置是否已存在 electron.exe
$cand = @(
  "$env:USERPROFILE\.dsh\profiles\node_modules\electron\dist\electron.exe",
  "$env:USERPROFILE\Workspace\GoAgent\node_modules\electron\dist\electron.exe"
)
$cand | ForEach-Object { if (Test-Path $_) { Write-Output "FOUND: $_" } }
```

判断：
- 上面能列出 `electron.exe` 的完整路径 → 机器**有 e**。
- 都没有 → 缺可用 Electron，见"第四步"获取。

## 第三步：配置方式（三选一，推荐 A）

- **A（推荐，最直观）**：让用户在插件的「形象 / 设置」里填「桌宠 Electron 路径」，填**完整路径**，即 `electron.exe` 所在文件。保存后**重启 TokensCowork**。
- **B**：把 `electron.exe` 连同旁侧文件放到插件 `vendor\win32-x64\`（Windows 64 位）。
- **C**：设置环境变量 `DSH_LIVE2D_AVATAR_ELECTRON` 为完整路径。

> 探测顺序：设置里的路径 → 环境变量 → vendor/ → 开发版 process.execPath → 系统 PATH。

## 第四步：如何获得一个 Electron（小白）

让用户下载 Electron 官方发布页 `https://github.com/electron/electron/releases` 的 `electron-vXX.X.X-win32-x64.zip`，解压到任意目录（如 `C:\electron`），用其中的 `electron.exe`。

## 第五步：验证

重启后让用户点「桌宠」模式：
- ✅ 出现透明、无边框、置顶小窗 → 成功。
- ⚠️ 角色仍在页面内 + 右下角提示 → 说明窗口没能加载，进入排错。

## 第六步：排错（读取日志）

两个日志能说明原因：
- `%APPDATA%\dsh-live2d-avatar-pet\companion.log`（伴生进程侧）
- `%APPDATA%\dsh-live2d-avatar-pet\host-companion.log`（宿主侧）

读取并看关键行：

```powershell
Get-Content "$env:APPDATA\dsh-live2d-avatar-pet\companion.log" -Tail 40
Get-Content "$env:APPDATA\dsh-live2d-avatar-pet\host-companion.log" -Tail 40
```

解释：
- `did-fail-load ... code=...` ：伴生窗口加载 `/avatar/pet` 失败。`code=-3`/`ERR_ABORTED` 常见于被导航/拦截；`ERR_CONNECTION_REFUSED` 说明 DSH WebServer 没起；若疑似门控，检查 renderer 访问头是否注入。
- `companion exited code=N`：Electron 进程退出。`0`=正常退出（可能窗口被关），`非0`=崩溃，看上面 stderr 行。
- 若日志不存在：说明 Electron 根本没被正确启动，检查第三步的路径是否指向真正的 `electron.exe`。

## 注意事项

- 开发者/用户的环境若运行在受限 TEMP 下，伴生进程现在把 `userData` 放在 Roaming（`%APPDATA%\dsh-live2d-avatar-pet`），别再改成临时目录，否则 Chromium 网络沙箱可能起不来。
- 独立窗口只从用户自己的 DSH 服务加载角色资源，不访问外部网络。
- 若用的是打包安装版且确实拿不到 Electron，建议如实告知：独立窗口需要提供 Electron（设置路径 / vendor / 环境变量），否则只能页面内浮层。

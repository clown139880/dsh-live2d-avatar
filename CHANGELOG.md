# Changelog

## 0.3.0

- Desktop 桌宠改为**独立 Electron 伴生进程**：新版 DSH Desktop 把 Host 挪进
  `utilityProcess`，`BrowserWindow` 作为主进程 API 在 Host 里不可用；Host 不再
  直接 `import('electron')` 建窗，而是探测可用的 Electron 二进制并拉起
  `companion` 伴生进程，由它创建透明、无边框、置顶窗口加载 `/avatar/pet`。
- 伴生 Electron 探测顺序：设置中配置的 `companionElectronPath` →
  `DSH_LIVE2D_AVATAR_ELECTRON` 环境变量 → `vendor/<platform>-<arch>/` →
  未打包/开发 DSH Desktop 的 `process.execPath` → 系统 `PATH`；均未命中则退回
  页面内桌宠，并在界面给出文档提示。
- 设置页新增“桌宠 Electron 路径”及运行说明链接；桌面端进桌宠模式前自动检测，
  无可用 Electron 时降级为页面内浮层并提示。
- 伴生窗口通过 renderer 访问头声称为 DSH 渲染器流量，使 Desktop WebServer 门控
  不再对其返回 403；携带 loopback origin + 模型/边界参数。
- 页面内桌宠保留为兜底。`src/companion/` 提供独立 Electron 主进程入口及最小
  `electron` 类型声明，运行时由 Electron 提供真实模块。
- **修复“脱离舞台但没出现独立窗口”**：宿主不再在 `spawn` 后乐观地报“已打开”。
  伴生窗口只有在其页面真正加载并显示后才向宿主回报 READY（`__DSH_PET_READY__`），
  宿主最多等待 8s；若窗口先退出、加载失败或超时，宿主会关掉该进程并退回页面内
  桌宠（同时给出提示），角色不会凭空消失。
- **修复伴生进程在受限 TEMP 下起不来**：伴生进程的 `userData` 从 `app.getPath('temp')`
  改为标准 `app.getPath('appData')`（Roaming）。DSH 会把 TEMP 锁到会话级受限目录，
  Chromium 网络沙箱无法对其缓存目录授权，导致窗口加载失败；该改动可让窗口真正显示。
- 伴生进程与宿主各自记录诊断日志：伴生进程写入
  `%APPDATA%\dsh-live2d-avatar-pet\companion.log`，宿主写入
  `%APPDATA%\dsh-live2d-avatar-pet\host-companion.log`，便于定位加载失败原因。
- **修复日志不落盘**：宿主与伴生进程写日志前先创建父目录，此前父目录不存在时
  `appendFileSync` 抛 ENOENT 被吞掉，导致无日志可查。
- **探测范围补上 DSH profile 自带 Electron**：新增扫描
  `DSH_HOME\profiles\node_modules\electron\dist\` 与 `DSH_HOME\profiles\desktop\node_modules\electron\dist\`，
  并让 `resolveCompanionExecutable` 把每个候选与最终结果写入宿主日志（含"未找到"）。
- **修正"选了打包应用主程序当 Electron"的坑**：Host 跑在 `utilityProcess`，`process.resourcesPath`
  为 undefined，`isPackagedDesktopApp()` 误判成"未打包"，于是把 `TokensCowork.exe`（完整应用，
  带单实例锁）当伴生进程拉起，结果被 SIGTERM 干掉、窗口不出现。现在只有 `process.execPath` 的
  文件名就是通用 `electron.exe` 时才采用它，否则落到 DSH profile / 系统 PATH 里的真 Electron。
- 宿主 spawn 伴生进程时显式剔除 `ELECTRON_RUN_AS_NODE`，避免 DSH 用 Electron 起 node 时把该
  变量泄露给伴生进程，导致伴生 Electron 被当成普通 Node 跑而不建窗。
- **修复"第一次点桌宠不开窗、要点两次"的竞态**：客户端会在挂载及配置/可见性变化时重跑同步
  effect，导致 `show` RPC 首尾相接；旧实现每次 show 都 spawn 一个伴生进程并把仍在加载的那个
  用 `previous.kill()` 杀掉，于是首次点击常开不出窗口。现在 `show` 采用**单飞（single-flight）**：
  已有一次 show 正在加载就复用同一个 Promise，不再重复 spawn+kill，首次点击即可稳定出窗。
- **插件加载时自动注册 agent 技能 `live2d-desktop-pet`**：DSH 的文件系统技能提供者
  只扫描 `.dsh/skills` / `.agents/skills` / custom 目录 / 内置目录，不会爬插件包内部，
  因此由插件在 `apply` 时通过 `ctx.skills.register(...)` 主动注册（防御性：不可用则跳过）。
  `package.json` 的 `files` 已加入 `skills`。

## 0.2.1

- Restore the GitHub link on the npm package page by adding `repository`,
  `homepage` and `bugs` metadata.
- Switch README images and doc references to absolute GitHub URLs so they
  render on the npm registry page instead of 404ing on relative paths.

## 0.2.0

- The desktop pet now remembers both its window width and screen position, and
  reopens at the same size and spot after an app restart.
- Fixed a host config-source stale-closure bug that kept the ModelDeck proxy on
  the schema-default (empty) base URLs, so `/avatar/api/*` stayed 503
  "ModelDeck base URL is not configured" despite valid settings.yaml values.
- The ModelDeck proxy now falls back between the configured ASR and TTS base
  URLs so a single service serving both roles always answers health probes.
- Desktop pet windows now attach the renderer access header so the
  dsh-plugin-desktop WebServer fence classifies their page/runtime/Live2D
  requests as renderer traffic instead of returning 403.
- The `AdaptiveHeroinePet` retries the desktop `show` RPC while the host is still
  starting and probes for an already-open pet window, avoiding the duplicate
  "web-mode, can't be moved out" fallback on launch.
- Model presentation is now read from the resolved host settings rather than the
  renderer payload, so the pet always shows the configured heroine.
- Added a `preview:models` script that generates and serves a local model
  browser for the extracted Live2D library.

## 0.1.0

- Added the DSH conversation **形象** tab with a bundled Haru Live2D sample.
- Added custom Cubism 2 and Cubism 3+ model loading, scale and position controls.
- Added opt-in, conversation-scoped Live2D performance prompt control.
- Added optional web and TokensCowork desktop companion modes.
- Added experimental, disabled-by-default ModelDeck ASR and TTS integration.
- Added a top-level Avatar settings page with conditional ASR/TTS sections.

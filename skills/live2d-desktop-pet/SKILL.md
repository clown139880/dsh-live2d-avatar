---
name: live2d-desktop-pet
description: 帮助排查 dsh-live2d-avatar 的独立桌宠窗口及页面内回退。
---

# 独立桌宠排查

TokensCowork Desktop 的桌宠通过系统 GUI agent 打开。Windows 使用 PowerShell、WPF 与 WebView2 Runtime；macOS 使用 osascript 与 WKWebView。普通 `dsh web` 使用页面内桌宠。

1. 确认插件已启用，当前模式为「桌宠」，模型入口文件存在。
2. Windows 检查 WebView2 Evergreen Runtime 是否已安装。Windows 11 通常自带，Windows 10 可从微软官网下载。
3. 查看 `%APPDATA%\dsh-live2d-avatar-pet\host-companion.log`。macOS 日志在系统临时目录的 `dsh-live2d-avatar-pet/host-companion.log`。
4. 若原生窗口启动或加载失败，插件会显示页面内桌宠。记录日志中的具体错误，再判断是运行时、模型路径还是窗口加载问题。

完整说明见插件的 `docs/desktop-pet.md`。

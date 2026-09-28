# 独立桌宠窗口

在 Windows 10/11 和 macOS 的 TokensCowork Desktop 中，切换到「桌宠」即可打开透明、无边框、置顶的小窗口。可以拖动角色，用右上角的 `−`、`＋` 缩放，窗口位置与尺寸会保存在用户数据目录。关闭 TokensCowork 时桌宠也会退出。普通 `dsh web` 使用页面内桌宠。

Windows 使用系统 PowerShell 5.1、WPF 和 WebView2 Runtime。Windows 11 通常自带 Runtime，Windows 10 若缺少可安装 [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。插件已经随包提供 WebView2 SDK DLL，不需要单独下载 Electron。macOS 使用系统 `osascript` 和 WKWebView，也不需要 Electron。

窗口启动失败时自动显示页面内桌宠。Windows 可查看 `%APPDATA%\dsh-live2d-avatar-pet\host-companion.log`，macOS 可查看临时目录中 `dsh-live2d-avatar-pet/host-companion.log`。可先确认 WebView2 Runtime 是否已安装、模型路径是否有效，然后重启 TokensCowork。

WebView2 SDK 文件来自微软 NuGet 包 `Microsoft.Web.WebView2` 版本 **1.0.3595.46**：`Microsoft.Web.WebView2.Core.dll`、`Microsoft.Web.WebView2.Wpf.dll` 和 x64/arm64 的 `WebView2Loader.dll`。微软的再分发许可与 NOTICE 随文件保存在 `assets/webview2/LICENSE.txt`、`assets/webview2/NOTICE.txt`。SDK DLL 不是 WebView2 Runtime；运行时仍由系统提供。

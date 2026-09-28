import { createHash } from 'node:crypto'

// Add-Type on Windows PowerShell 5.1 compiles C# 5 and decodes source using the
// local ANSI codepage. Keep the generated C# and PowerShell strictly ASCII.
// WebView2CompositionControl is required: ordinary WebView2 is an HWND child and
// renders an opaque rectangle inside a layered WPF window (the airspace issue).
const CS = String.raw`
using System;
using System.IO;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

public static class PetAgent {
  static Window win;
  static WebView2CompositionControl web;
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static string origin = "", headerName = "", headerValue = "";
  static bool loaded = false;
  static bool active = false;
  static bool dragging = false;
  static DispatcherTimer dragTimer;
  static POINT lastCursor;
  static DateTime lastBoundsEvent = DateTime.MinValue;
  static object sync = new object();
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
  static void Emit(object value) { lock(sync) Console.Out.WriteLine(json.Serialize(value)); }
  static void Error(string message) { Emit(new { ev = "error", message = message }); }
  static string S(Dictionary<string, object> m, string key) { return m.ContainsKey(key) && m[key] != null ? Convert.ToString(m[key]) : ""; }
  static double N(Dictionary<string, object> m, string key, double fallback) { double n; return double.TryParse(S(m,key), out n) ? n : fallback; }
  static Dictionary<string, object> D(Dictionary<string, object> m, string key) { return m.ContainsKey(key) && m[key] is Dictionary<string,object> ? (Dictionary<string,object>)m[key] : new Dictionary<string,object>(); }
  static void Moved() {
    if (!active || !win.IsVisible) return;
    if (dragging && (DateTime.UtcNow-lastBoundsEvent).TotalMilliseconds < 250) return;
    lastBoundsEvent=DateTime.UtcNow;
    Emit(new { ev = "moved", x = (int)win.Left, y = (int)win.Top, width = (int)win.Width, height = (int)win.Height });
  }
  static void EndDrag() { if (!dragging) return; dragging = false; dragTimer.Stop(); Moved(); }
  static void DragTick(object sender, EventArgs e) {
    if ((GetAsyncKeyState(1) & 0x8000) == 0 || !active) { EndDrag(); return; }
    POINT cursor; if (!GetCursorPos(out cursor)) return;
    var source = PresentationSource.FromVisual(win);
    if (source == null || source.CompositionTarget == null) return;
    Matrix matrix = source.CompositionTarget.TransformFromDevice;
    win.Left += (cursor.X - lastCursor.X) * matrix.M11;
    win.Top += (cursor.Y - lastCursor.Y) * matrix.M22;
    lastCursor = cursor;
  }
  static void Bounds(Dictionary<string, object> m) {
    double w = Math.Max(180, Math.Min(480, N(m,"width",300)));
    win.Width = w; win.Height = Math.Round(w * 250 / 180);
    if (m.ContainsKey("x") && m.ContainsKey("y")) { win.Left = N(m,"x",0); win.Top = N(m,"y",0); }
    Moved();
  }
  static async void Show(Dictionary<string, object> m) {
    try {
      origin = S(m,"carrierOrigin"); headerName = S(m,"headerName"); headerValue = S(m,"headerValue");
      Bounds(D(m,"bounds"));
      if (!loaded) {
        string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "dsh-live2d-avatar-pet", "webview2");
        Directory.CreateDirectory(folder);
        await web.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, folder));
        web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        web.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
          if (e.IsSuccess) Emit(new { ev = "shown" }); else Error("navigation: " + e.WebErrorStatus);
        };
        web.CoreWebView2.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
          try { Bridge(json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson)); } catch (Exception ex) { Error("bridge: " + ex.Message); }
        };
        web.CoreWebView2.AddWebResourceRequestedFilter(origin + "/*", CoreWebView2WebResourceContext.All);
        web.CoreWebView2.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
          try { if (e.Request.Uri.StartsWith(origin + "/", StringComparison.OrdinalIgnoreCase) && headerName.Length > 0) e.Request.Headers.SetHeader(headerName,headerValue); } catch (Exception ex) { Error("header: " + ex.Message); }
        };
        loaded = true;
      }
      web.DefaultBackgroundColor = System.Drawing.Color.Transparent;
      web.Source = new Uri(S(m,"url"));
      active = true; win.Show(); win.Activate(); Moved();
    } catch (Exception ex) { Error("show: " + ex); }
  }
  static void Bridge(Dictionary<string, object> m) {
    string type = S(m,"type");
    if (type == "drag-start") { if (GetCursorPos(out lastCursor)) { dragging = true; dragTimer.Start(); } }
    else if (type == "drag-end") { EndDrag(); }
    else if (type == "resize") { Bounds(new Dictionary<string,object> { {"width", win.Width + N(m,"delta",0)}, {"x",win.Left}, {"y",win.Top} }); }
    else if (type == "close" || type == "return-stage") { EndDrag(); Moved(); active = false; win.Hide(); Emit(new { ev = type == "close" ? "closed" : "return-stage" }); }
  }
  static void Handle(string line) {
    Dictionary<string,object> m=json.Deserialize<Dictionary<string,object>>(line);
    string cmd=S(m,"cmd");
    if (cmd == "quit") { Application.Current.Shutdown(); return; }
    if (cmd == "hide") { EndDrag(); active = false; win.Hide(); return; }
    if (cmd == "set-bounds") { Bounds(D(m,"bounds")); return; }
    if (cmd == "show" || cmd == "set-model") { Show(m); return; }
    Error("unknown command " + cmd);
  }
  static void ReadStdin() {
    try { string line; while ((line=Console.ReadLine()) != null) { string next=line; win.Dispatcher.BeginInvoke(new Action(delegate { try { Handle(next); } catch(Exception e) { Error("command: " + e.Message); } })); } }
    catch (Exception e) { Error("stdin: " + e.Message); }
    win.Dispatcher.BeginInvoke(new Action(delegate { Application.Current.Shutdown(); }));
  }
  [STAThread] public static void Run() {
    Application app=new Application(); app.ShutdownMode=ShutdownMode.OnExplicitShutdown;
    win=new Window(); win.WindowStyle=WindowStyle.None; win.ResizeMode=ResizeMode.NoResize;
    win.AllowsTransparency=true; win.Background=Brushes.Transparent; win.ShowInTaskbar=false;
    win.Topmost=true; win.Width=300; win.Height=417; win.Opacity=1;
    web=new WebView2CompositionControl(); web.DefaultBackgroundColor=System.Drawing.Color.Transparent;
    dragTimer=new DispatcherTimer(); dragTimer.Interval=TimeSpan.FromMilliseconds(16); dragTimer.Tick += DragTick;
    win.Content=web;
    win.SourceInitialized += delegate {
      IntPtr hwnd=new WindowInteropHelper(win).Handle;
      SetWindowLong(hwnd,-20,GetWindowLong(hwnd,-20) | 0x80);
    };
    win.LocationChanged += delegate { Moved(); }; win.SizeChanged += delegate { Moved(); };
    win.Show(); win.Hide();
    Thread t=new Thread(ReadStdin); t.IsBackground=true; t.Start();
    Emit(new { ev = "ready" });
    app.Run();
  }
}
`.trim()

function psQuote(s: string): string { return `'${s.replace(/'/g, "''")}'` }
export function buildWinAgentScript(sdkRoot: string): string {
  const hash = createHash('sha1').update(CS).digest('hex').slice(0, 12)
  return [
    '$ErrorActionPreference = "Stop"',
    `$root = ${psQuote(sdkRoot)}`,
    '$arch = if ([Environment]::Is64BitProcess) { if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" } } else { throw "64-bit PowerShell required" }',
    '$env:PATH = (Join-Path $root $arch) + ";" + $env:PATH',
    '$core = Join-Path $root "Microsoft.Web.WebView2.Core.dll"',
    '$wpf = Join-Path $root "Microsoft.Web.WebView2.Wpf.dll"',
    'Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Xaml,System.Web.Extensions,System.Drawing',
    '$cs = @\'', CS, "'@",
    `$dll = Join-Path $env:TEMP ${psQuote(`dsh-live2d-avatar-pet-${hash}.dll`)}`,
    'if (-not (Test-Path $dll)) {',
    '  $tmp = $dll + "." + $PID + ".tmp.dll"',
    '  Add-Type -TypeDefinition $cs -ReferencedAssemblies PresentationFramework,PresentationCore,WindowsBase,System.Xaml,System.Web.Extensions,System.Drawing,$core,$wpf -OutputAssembly $tmp -OutputType Library',
    '  try { Move-Item -Force $tmp $dll } catch { $dll = $tmp }',
    '}',
    'Add-Type -Path $core,$wpf,$dll',
    '[PetAgent]::Run()',
  ].join('\r\n')
}
export function winAgentArgs(scriptPath: string): string[] { return ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', scriptPath] }

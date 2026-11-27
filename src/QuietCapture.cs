using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// Independent implementation of the documented Windows capture/hotkey APIs.
// No QuizCoze runtime, login, preview window, notification or network access.
static class Program
{
    internal static readonly string Folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Screenshots");

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int nCmdShow);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT lpRect);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);
    delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hWndParent, EnumChildProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, System.Text.StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [STAThread]
    static int Main(string[] args)
    {
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
        catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        try
        {
            if (args.Length == 2 && args[0] == "--capture-once")
            {
                Capture(Path.GetFullPath(args[1]));
                return 0;
            }
            if (args.Length == 3 && args[0] == "--capture-rect")
            {
                CaptureRect(args[1], Path.GetFullPath(args[2]));
                return 0;
            }
            if (args.Length == 2 && args[0] == "--capture-region")
                return RegionCapture.Run(Path.GetFullPath(args[1]), false);
            if (args.Length == 2 && args[0] == "--self-test-region")
                return RegionCapture.SelfTest(Path.GetFullPath(args[1]));
            if (args.Length == 2 && args[0] == "--self-test")
            {
                SelfTest(Path.GetFullPath(args[1]));
                return 0;
            }
            if (args.Length == 3 && args[0] == "--mouse-watch")
            {
                WatchMouseSideButton(args[1], args[2]);
                return 0;
            }
            if (args.Length == 2 && args[0] == "--self-test-mouse")
            {
                MouseShortcutHost.SelfTest(Path.GetFullPath(args[1]));
                return 0;
            }
            if (args.Length >= 2 && args[0] == "--win-ensure-render")
            {
                bool raiseTopmost = args.Length >= 3 && args[2] == "--topmost";
                return WinEnsureRenderVisible(args[1], raiseTopmost);
            }
            if (args.Length == 2 && args[0] == "--win-get-rect")
            {
                return WinGetPhysicalRect(args[1]);
            }
            if (args.Length == 3 && args[0] == "--win-set-rect")
            {
                return WinSetPhysicalRect(args[1], args[2]);
            }
            bool first;
            using (var mutex = new Mutex(true, "Local\\QuietCapture.FullScreen.Hotkey", out first))
            {
                if (!first) return 0;
                Application.EnableVisualStyles();
                using (var app = new TrayApp()) Application.Run(app);
            }
            return 0;
        }
        catch (Exception error)
        {
            Log(error);
            return 1;
        }
    }

    internal static void Capture(string output)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        using (var bitmap = CaptureDesktop())
        using (var file = new FileStream(output, FileMode.CreateNew, FileAccess.Write))
            bitmap.Save(file, ImageFormat.Png);
    }

    internal static void CaptureRect(string spec, string output)
    {
        string[] parts = (spec ?? "").Split(',');
        if (parts.Length != 4) throw new ArgumentException("Invalid rect spec");
        int x = int.Parse(parts[0]);
        int y = int.Parse(parts[1]);
        int w = int.Parse(parts[2]);
        int h = int.Parse(parts[3]);
        if (w < 1 || h < 1 || w > 16384 || h > 16384) throw new ArgumentOutOfRangeException("Invalid rect bounds");
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        using (var bitmap = new Bitmap(w, h, PixelFormat.Format24bppRgb))
        {
            using (var graphics = Graphics.FromImage(bitmap))
                graphics.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
            using (var file = new FileStream(output, FileMode.CreateNew, FileAccess.Write))
                bitmap.Save(file, ImageFormat.Png);
        }
    }

    internal static Bitmap CaptureDesktop()
    {
        Rectangle area = SystemInformation.VirtualScreen;
        var bitmap = new Bitmap(area.Width, area.Height, PixelFormat.Format24bppRgb);
        try
        {
            using (var graphics = Graphics.FromImage(bitmap))
                graphics.CopyFromScreen(area.Left, area.Top, 0, 0, area.Size, CopyPixelOperation.SourceCopy);
            return bitmap;
        }
        catch { bitmap.Dispose(); throw; }
    }

    internal static void Log(Exception error)
    {
        try { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "error.log"), DateTime.Now.ToString("s") + " " + error + Environment.NewLine); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    static IntPtr ParseHwnd(string raw)
    {
        long val = long.Parse((raw ?? "").Trim());
        return new IntPtr(val);
    }

    // Re-show Chromium's Chrome_RenderWidgetHostHWND child window without activating or stealing focus.
    // Optionally re-assert HWND_TOPMOST on the top-level window using pure SWP_NOACTIVATE (never BringWindowToTop).
    static int WinEnsureRenderVisible(string hwndArg, bool raiseTopmost)
    {
        IntPtr hwnd = ParseHwnd(hwndArg);
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return 2;
        IntPtr fgBefore = GetForegroundWindow();
        int found = 0;
        int repaired = 0;
        bool allVisible = true;
        const int SW_SHOWNOACTIVATE = 4;
        const uint SWP_NOSIZE = 0x0001;
        const uint SWP_NOMOVE = 0x0002;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_SHOWWINDOW = 0x0040;
        if (raiseTopmost)
        {
            SetWindowPos(hwnd, new IntPtr(-1), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
        EnumChildWindows(hwnd, delegate(IntPtr child, IntPtr _)
        {
            var sb = new System.Text.StringBuilder(128);
            GetClassName(child, sb, sb.Capacity);
            if (sb.ToString() == "Chrome_RenderWidgetHostHWND")
            {
                found++;
                if (!IsWindowVisible(child))
                {
                    ShowWindow(child, SW_SHOWNOACTIVATE);
                    SetWindowPos(child, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
                    repaired++;
                }
                if (!IsWindowVisible(child)) allVisible = false;
            }
            return true;
        }, IntPtr.Zero);
        IntPtr fgAfter = GetForegroundWindow();
        Console.Write(
            "{\"found\":" + found +
            ",\"repaired\":" + repaired +
            ",\"visible\":" + (allVisible && found > 0 ? "true" : "false") +
            ",\"topmost\":" + (raiseTopmost ? "true" : "false") +
            ",\"fgBefore\":" + fgBefore.ToInt64() +
            ",\"fgAfter\":" + fgAfter.ToInt64() +
            ",\"fgChanged\":" + (fgBefore != fgAfter ? "true" : "false") +
            "}"
        );
        return 0;
    }

    static int WinGetPhysicalRect(string hwndArg)
    {
        IntPtr hwnd = ParseHwnd(hwndArg);
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return 2;
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return 3;
        int w = r.Right - r.Left;
        int h = r.Bottom - r.Top;
        Console.Write("{\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + w + ",\"height\":" + h + "}");
        return 0;
    }

    static int WinSetPhysicalRect(string hwndArg, string rectSpec)
    {
        IntPtr hwnd = ParseHwnd(hwndArg);
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return 2;
        string[] parts = (rectSpec ?? "").Split(',');
        if (parts.Length != 4) return 4;
        int x = int.Parse(parts[0]);
        int y = int.Parse(parts[1]);
        int w = int.Parse(parts[2]);
        int h = int.Parse(parts[3]);
        if (w < 120 || h < 80 || w > 16384 || h > 16384) return 5;
        const uint SWP_NOZORDER = 0x0004;
        const uint SWP_NOACTIVATE = 0x0010;
        SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return 3;
        Console.Write("{\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + (r.Right - r.Left) + ",\"height\":" + (r.Bottom - r.Top) + "}");
        return 0;
    }

    static void WatchMouseSideButton(string pipeName, string button)
    {
        using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.Out))
        {
            pipe.Connect(15000);
            int parent;
            int.TryParse(pipeName.Substring(pipeName.LastIndexOf('-') + 1), out parent);
            using (var host = new MouseShortcutHost(pipe, button, parent)) Application.Run(host);
        }
    }

    static void SelfTest(string output)
    {
        bool captured = false;
        IntPtr foreground = GetForegroundWindow();
        using (var hotkey = new HotkeyWindow(delegate { Capture(output); captured = true; }))
        {
            if (IsWindowVisible(hotkey.Handle)) throw new Exception("Hotkey window must be invisible.");
            if (!PostMessage(hotkey.Handle, 0x0312, new IntPtr(1), IntPtr.Zero)) throw new Win32Exception();
            var timer = Stopwatch.StartNew();
            while (!captured && timer.ElapsedMilliseconds < 3000) { Application.DoEvents(); Thread.Sleep(10); }
            if (!captured) throw new Exception("Hotkey message did not produce a screenshot.");
        }
        using (var image = Image.FromFile(output))
        {
            var expected = SystemInformation.VirtualScreen;
            if (image.Width != expected.Width || image.Height != expected.Height) throw new Exception("Screenshot dimensions differ from the desktop.");
            File.WriteAllText(output + ".json", "{\"hotkeyMessageCapture\":true,\"invisibleWindow\":true,\"width\":" + image.Width + ",\"height\":" + image.Height + ",\"foregroundUnchanged\":" + (foreground == GetForegroundWindow()).ToString().ToLowerInvariant() + "}");
        }
    }
}

sealed class HotkeyWindow : NativeWindow, IDisposable
{
    readonly Action capture;
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr window, int id);

    internal HotkeyWindow(Action capture)
    {
        this.capture = capture;
        CreateHandle(new CreateParams { Caption = "QuietCapture.Hotkey", Parent = new IntPtr(-3) });
        // Ctrl + Alt + F9; MOD_NOREPEAT suppresses held-key repeats.
        if (!RegisterHotKey(Handle, 1, 0x4003, (uint)Keys.F9))
        {
            int error = Marshal.GetLastWin32Error();
            DestroyHandle();
            throw new Win32Exception(error, "Ctrl+Alt+F9 is unavailable. Close the other application using this shortcut.");
        }
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x0312 && message.WParam.ToInt32() == 1) capture();
        base.WndProc(ref message);
    }

    public void Dispose() { if (Handle != IntPtr.Zero) { UnregisterHotKey(Handle, 1); DestroyHandle(); } }
}

sealed class TrayApp : ApplicationContext
{
    readonly NotifyIcon tray;
    readonly HotkeyWindow hotkey;

    internal TrayApp()
    {
        Directory.CreateDirectory(Program.Folder);
        hotkey = new HotkeyWindow(Capture);
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开截图文件夹", null, delegate { try { Process.Start(new ProcessStartInfo(Program.Folder) { UseShellExecute = true }); } catch (Exception error) { Program.Log(error); } });
        menu.Items.Add("退出", null, delegate { ExitThread(); });
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "静默截图 | Ctrl+Alt+F9", ContextMenuStrip = menu, Visible = true };
    }

    void Capture()
    {
        try
        {
            Program.Capture(Path.Combine(Program.Folder, DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss_fff") + ".png"));
            tray.Text = "静默截图 | 已保存 " + DateTime.Now.ToString("HH:mm:ss");
        }
        catch (Exception error) { Program.Log(error); tray.Text = "截图失败，请查看 error.log"; }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { hotkey.Dispose(); tray.Visible = false; tray.ContextMenuStrip.Dispose(); tray.Dispose(); }
        base.Dispose(disposing);
    }
}

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class EyeContactEngine
{
    private const string Implementation = "meetingcopilot-maxine-direct";
    private static readonly object outputGate = new object();
    private static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };
    private static readonly ConcurrentQueue<string> commands = new ConcurrentQueue<string>();
    private static volatile bool stopping;

    [MTAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        try
        {
            var options = Options.Parse(args);
            if (options.SelfTest)
            {
                bool bitmapValid = SelfTestBitmap();
                bool valid = IntPtr.Size == 8 && Marshal.SizeOf(typeof(NvCvImageLayout)) == 64
                    && Marshal.SizeOf(typeof(AMMediaType)) == 88 && bitmapValid;
                Emit(new { type = "self-test", implementation = Implementation, pointerBytes = IntPtr.Size,
                    nvCvImageBytes = Marshal.SizeOf(typeof(NvCvImageLayout)), amMediaTypeBytes = Marshal.SizeOf(typeof(AMMediaType)),
                    comparisonBmp = bitmapValid, success = valid });
                return valid ? 0 : 1;
            }
            if (options.ListDevices) { Emit(new { type = "devices", devices = DirectShowCamera.ListDevices(), implementation = Implementation }); return 0; }
            if (IntPtr.Size != 8) throw new InvalidOperationException("The eye-contact engine requires an x64 process.");
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; stopping = true; };
            var reader = new Thread(ReadCommands); reader.IsBackground = true; reader.Start();
            return Run(options);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            Emit(new { type = "error", implementation = Implementation, message = error.GetType().Name + ": " + error.Message });
            return 1;
        }
    }

    private static int Run(Options options)
    {
        DirectShowCamera camera = null;
        MaxineSdk sdk = null;
        SoftCamera output = null;
        var lifetime = Stopwatch.StartNew();
        try
        {
            Status("camera-enumerating", "Selecting the physical input device.");
            camera = new DirectShowCamera(options.Device);
            string device = camera.Device;
            bool fallback = camera.DeviceFallback;
            int width = camera.Width & ~3, height = camera.Height & ~3;
            double nominalFps = camera.NominalFps;
            if (width < 4 || height < 4) throw new InvalidOperationException("Camera dimensions are too small.");
            string sdkDirectory = Path.GetFullPath(options.SdkDirectory);
            Directory.SetCurrentDirectory(sdkDirectory);
            Status("sdk-loading", "Loading NVIDIA GazeRedirection models.");
            sdk = new MaxineSdk(sdkDirectory, width, height, options.LookAway, options.EyeSize, options.Temporal);
            output = new SoftCamera(options.Softcam, width, height);
            string mode = options.Idle ? "idle" : "correct";
            bool released = options.Idle;
            if (options.Idle) { camera.Dispose(); camera = null; }
            else camera.Start();
            Emit(new { type = "ready", implementation = Implementation, device = device, width = width, height = height, fps = nominalFps,
                deviceFallback = fallback, gazeTuning = false, sourceReleased = released, sdkDirectory = sdkDirectory,
                softcamDll = Path.GetFullPath(options.Softcam), captureBackend = "DirectShow RGB24", nvCvImageBytes = 64 });
            if (released) Status("cameraReleased", "The initial idle state released the physical camera.");

            var sinceReady = Stopwatch.StartNew();
            var interval = Stopwatch.StartNew();
            var noFrame = Stopwatch.StartNew();
            long frames = 0, intervalFrames = 0;
            double inferMs = 0, warmupMs = 0;
            bool hasInferred = false;
            string pendingComparison = null;
            while (!stopping && (options.Seconds <= 0 || sinceReady.Elapsed.TotalSeconds < options.Seconds))
            {
                string command;
                while (commands.TryDequeue(out command))
                {
                    if (command == "stop") { stopping = true; break; }
                    if (command.StartsWith("mode ", StringComparison.Ordinal))
                    {
                        string requested = command.Substring(5).Trim();
                        if (requested == "idle" || requested == "passthrough" || requested == "correct") mode = requested;
                        else Status("invalid-command", "Unknown mode: " + requested);
                    }
                    else if (command.StartsWith("compare ", StringComparison.Ordinal)) pendingComparison = command.Substring(8).Trim();
                    else Status("invalid-command", command);
                }
                if (stopping) break;
                if (mode == "idle")
                {
                    if (camera != null) { camera.Dispose(); camera = null; released = true; Status("cameraReleased", "Idle mode released the physical camera."); }
                    Thread.Sleep(30);
                    inferMs = 0;
                }
                else
                {
                    if (camera == null)
                    {
                        camera = new DirectShowCamera(device);
                        if ((camera.Width & ~3) != width || (camera.Height & ~3) != height)
                            throw new InvalidOperationException("The camera resolution changed while reopening.");
                        camera.Start(); released = false; noFrame.Restart(); Status("cameraOpened", camera.Device);
                    }
                    byte[] frame = camera.NextFrame(60);
                    if (frame != null)
                    {
                        try
                        {
                            camera.CopyTopDown(frame, sdk.InputPixels, width, height);
                            IntPtr image = sdk.InputPixels;
                            if (mode == "correct")
                            {
                                var inference = Stopwatch.StartNew();
                                sdk.Correct();
                                inferMs = inference.Elapsed.TotalMilliseconds;
                                if (!hasInferred) { warmupMs = inferMs; hasInferred = true; }
                                image = sdk.OutputPixels;
                            }
                            else inferMs = 0;
                            output.Send(image);
                            frames++; intervalFrames++; noFrame.Restart();
                            if (pendingComparison != null)
                            {
                                if (mode == "correct")
                                {
                                    Emit(new { type = "comparison", implementation = Implementation, requestId = pendingComparison,
                                        mode = "correct", reason = "nvidia-gaze-redirection", original = BitmapUrl(sdk.InputPixels, width, height),
                                        corrected = BitmapUrl(sdk.OutputPixels, width, height), averageLandmarkConfidence = sdk.AverageConfidence() });
                                }
                                else Status("comparison-correction-inactive", pendingComparison);
                                pendingComparison = null;
                            }
                        }
                        finally { camera.ReturnFrame(frame); }
                    }
                    else if (noFrame.Elapsed.TotalSeconds > 15) throw new TimeoutException("The physical camera produced no frame for 15 seconds.");
                }
                if (interval.Elapsed.TotalSeconds >= 0.5)
                {
                    Emit(new { type = "stats", implementation = Implementation, fps = intervalFrames / interval.Elapsed.TotalSeconds,
                        mode = mode, vcamConnected = output.IsConnected, inferMs = inferMs, frames = frames, warmupMs = warmupMs,
                        sourceReleased = released, cameraReleased = released, elapsedSeconds = sinceReady.Elapsed.TotalSeconds });
                    intervalFrames = 0; interval.Restart();
                }
            }
            return 0;
        }
        finally
        {
            if (camera != null) camera.Dispose();
            if (output != null) output.Dispose();
            if (sdk != null) sdk.Dispose();
            Emit(new { type = "stopped", implementation = Implementation, elapsedSeconds = lifetime.Elapsed.TotalSeconds });
        }
    }

    private static void ReadCommands()
    {
        try
        {
            string line;
            while ((line = Console.ReadLine()) != null) { commands.Enqueue(line.Trim()); if (line.Trim() == "stop") return; }
            commands.Enqueue("stop");
        }
        catch { commands.Enqueue("stop"); }
    }
    private static void Status(string name, string message) { Emit(new { type = "status", implementation = Implementation, @event = name, message = message }); }
    private static void Emit(object value) { lock (outputGate) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }

    private static string BitmapUrl(IntPtr pixels, int width, int height)
    {
        byte[] source = new byte[checked(width * height * 3)]; Marshal.Copy(pixels, source, 0, source.Length);
        return "data:image/bmp;base64," + Convert.ToBase64String(MakeBitmap(source, width, height));
    }
    private static byte[] MakeBitmap(byte[] source, int width, int height)
    {
        double scale = Math.Min(1.0, Math.Min(960.0 / width, 720.0 / height));
        int outputWidth = Math.Max(1, (int)(width * scale)), outputHeight = Math.Max(1, (int)(height * scale));
        int stride = (outputWidth * 3 + 3) & ~3;
        using (var memory = new MemoryStream())
        using (var writer = new BinaryWriter(memory))
        {
            writer.Write((ushort)0x4d42); writer.Write(54 + stride * outputHeight); writer.Write(0); writer.Write(54);
            writer.Write(40); writer.Write(outputWidth); writer.Write(outputHeight); writer.Write((ushort)1); writer.Write((ushort)24);
            writer.Write(0); writer.Write(stride * outputHeight); writer.Write(0); writer.Write(0); writer.Write(0); writer.Write(0);
            byte[] row = new byte[stride];
            for (int y = outputHeight - 1; y >= 0; y--)
            {
                int inputY = Math.Min(height - 1, (int)(y / scale));
                for (int x = 0; x < outputWidth; x++)
                {
                    int inputX = Math.Min(width - 1, (int)(x / scale));
                    Buffer.BlockCopy(source, (inputY * width + inputX) * 3, row, x * 3, 3);
                }
                writer.Write(row);
            }
            writer.Flush(); return memory.ToArray();
        }
    }
    private static bool SelfTestBitmap()
    {
        byte[] source = new byte[4 * 4 * 3]; source[0] = 17;
        byte[] bitmap = MakeBitmap(source, 4, 4);
        return bitmap.Length == 102 && bitmap[0] == 0x42 && bitmap[1] == 0x4d && bitmap[90] == 17;
    }

    private sealed class Options
    {
        internal string SdkDirectory = ".", Softcam = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "softcam.dll"), Device = "";
        internal bool LookAway, Idle, ListDevices, SelfTest;
        internal int EyeSize = 3;
        internal uint Temporal = UInt32.MaxValue;
        internal double Seconds;
        internal static Options Parse(string[] args)
        {
            var result = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                string key = args[i];
                if (key == "--idle") { result.Idle = true; continue; }
                if (key == "--list-devices") { result.ListDevices = true; continue; }
                if (key == "--self-test") { result.SelfTest = true; continue; }
                if (++i >= args.Length) throw new ArgumentException("A value is required for " + key);
                string value = args[i];
                switch (key)
                {
                    case "--sdk-dir": result.SdkDirectory = Path.GetFullPath(value); break;
                    case "--softcam": result.Softcam = Path.GetFullPath(value); break;
                    case "--device": result.Device = value; break;
                    case "--look-away": if (value != "0" && value != "1") throw new ArgumentException("look-away must be 0 or 1."); result.LookAway = value == "1"; break;
                    case "--eye-size": result.EyeSize = Int32.Parse(value, CultureInfo.InvariantCulture); if (result.EyeSize < 2 || result.EyeSize > 6) throw new ArgumentException("eye-size must be 2..6."); break;
                    case "--temporal": result.Temporal = value.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? UInt32.Parse(value.Substring(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture) : UInt32.Parse(value, CultureInfo.InvariantCulture); if (result.Temporal != 0 && result.Temporal != 35 && result.Temporal != UInt32.MaxValue) throw new ArgumentException("Unsupported temporal mask."); break;
                    case "--seconds": result.Seconds = Double.Parse(value, CultureInfo.InvariantCulture); if (result.Seconds <= 0 || Double.IsNaN(result.Seconds) || Double.IsInfinity(result.Seconds)) throw new ArgumentException("seconds must be positive and finite."); break;
                    default: throw new ArgumentException("Unknown argument: " + key);
                }
            }
            return result;
        }
    }
}

internal sealed class SoftCamera : IDisposable
{
    private IntPtr module, camera;
    private DeleteCamera delete;
    private SendFrame send;
    private Connected connected;
    internal SoftCamera(string file, int width, int height)
    {
        try
        {
            module = NativeMethods.LoadLibraryW(Path.GetFullPath(file));
            if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot load softcam.dll.");
            var create = MaxineSdk.Bind<CreateCamera>(module, "scCreateCamera");
            delete = MaxineSdk.Bind<DeleteCamera>(module, "scDeleteCamera");
            send = MaxineSdk.Bind<SendFrame>(module, "scSendFrame");
            connected = MaxineSdk.Bind<Connected>(module, "scIsConnected");
            camera = create(width, height, 0.0f);
            if (camera == IntPtr.Zero) throw new InvalidOperationException("scCreateCamera failed. Another virtual-camera producer may already be active.");
        }
        catch { Dispose(); throw; }
    }
    internal bool IsConnected { get { return connected(camera); } }
    internal void Send(IntPtr pixels) { send(camera, pixels); }
    public void Dispose()
    {
        if (camera != IntPtr.Zero && delete != null) { delete(camera); camera = IntPtr.Zero; }
        if (module != IntPtr.Zero) { NativeMethods.FreeLibrary(module); module = IntPtr.Zero; }
    }
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr CreateCamera(int width, int height, float fps);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void DeleteCamera(IntPtr camera);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void SendFrame(IntPtr camera, IntPtr pixels);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] private delegate bool Connected(IntPtr camera);
}

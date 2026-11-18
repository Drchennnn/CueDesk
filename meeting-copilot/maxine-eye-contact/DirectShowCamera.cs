using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text.RegularExpressions;
using System.Threading;

internal sealed class DirectShowCamera : IDisposable
{
    private object sourceObject, graphObject, builderObject, grabberObject, sinkObject;
    private ISampleGrabber grabber;
    private IMediaControl control;
    private bool disposed;
    private readonly CameraFrames callback = new CameraFrames();
    internal int Width { get; private set; }
    internal int Height { get; private set; }
    internal int SignedHeight { get; private set; }
    internal int Stride { get; private set; }
    internal double NominalFps { get; private set; }
    internal string Device { get; private set; }
    internal bool DeviceFallback { get; private set; }

    internal DirectShowCamera(string requestedDevice)
    {
        try
        {
            var devices = Enumerate();
            DeviceRecord chosen = null;
            try
            {
                foreach (DeviceRecord candidate in devices)
                    if (String.Equals(Normalize(candidate.Name), Normalize(requestedDevice), StringComparison.OrdinalIgnoreCase)) { chosen = candidate; break; }
                if (chosen == null && devices.Count > 0) { chosen = devices[0]; DeviceFallback = !String.IsNullOrEmpty(requestedDevice); }
                if (chosen == null) throw new InvalidOperationException("No physical video capture device is available.");
                Device = chosen.Name;
                Guid filterId = new Guid("56A86895-0AD4-11CE-B03A-0020AF0BA770");
                chosen.Moniker.BindToObject(null, null, ref filterId, out sourceObject);
            }
            finally { foreach (DeviceRecord item in devices) Release(item.Moniker); }

            graphObject = Com(new Guid("E436EBB3-524F-11CE-9F53-0020AF0BA770"), typeof(IGraphBuilder).GUID);
            builderObject = Com(new Guid("BF87B6E1-8C27-11D0-B3F0-00AA003761C5"), typeof(ICaptureGraphBuilder2).GUID);
            grabberObject = Com(new Guid("C1F400A0-3F08-11D3-9F0B-006008039E37"), typeof(IBaseFilter).GUID);
            sinkObject = Com(new Guid("C1F400A4-3F08-11D3-9F0B-006008039E37"), typeof(IBaseFilter).GUID);
            var graph = (IGraphBuilder)graphObject;
            var builder = (ICaptureGraphBuilder2)builderObject;
            grabber = (ISampleGrabber)grabberObject;
            control = (IMediaControl)graphObject;
            Check(builder.SetFiltergraph(graph), "SetFiltergraph");
            Check(graph.AddFilter((IBaseFilter)sourceObject, "Physical camera"), "AddFilter(camera)");
            Check(graph.AddFilter((IBaseFilter)grabberObject, "BGR frame capture"), "AddFilter(grabber)");
            Check(graph.AddFilter((IBaseFilter)sinkObject, "Null output"), "AddFilter(null)");
            var type = new AMMediaType();
            type.MajorType = new Guid("73646976-0000-0010-8000-00AA00389B71");
            type.SubType = new Guid("E436EB7D-524F-11CE-9F53-0020AF0BA770"); // RGB24 DIB bytes are B,G,R.
            Check(grabber.SetMediaType(ref type), "SetMediaType(RGB24)");
            Check(grabber.SetOneShot(false), "SetOneShot");
            Check(grabber.SetBufferSamples(false), "SetBufferSamples");
            Check(grabber.SetCallback(callback, 1), "SetCallback");
            IntPtr video = Marshal.AllocCoTaskMem(16);
            try
            {
                Marshal.Copy(type.MajorType.ToByteArray(), 0, video, 16);
                Check(builder.RenderStream(IntPtr.Zero, video, sourceObject, (IBaseFilter)grabberObject, (IBaseFilter)sinkObject), "RenderStream");
            }
            finally { Marshal.FreeCoTaskMem(video); }
            AMMediaType connected;
            Check(grabber.GetConnectedMediaType(out connected), "GetConnectedMediaType");
            try
            {
                int bitmapOffset;
                if (connected.FormatType == new Guid("05589F80-C356-11CE-BF01-00AA0055595A")) bitmapOffset = 48;
                else if (connected.FormatType == new Guid("F72A76A0-EB0A-11D0-ACE4-0000C0CC16BA")) bitmapOffset = 72;
                else throw new InvalidOperationException("The camera RGB24 video format is unsupported.");
                if (connected.FormatPointer == IntPtr.Zero || connected.FormatSize < bitmapOffset + 40)
                    throw new InvalidOperationException("The camera RGB24 video format block is incomplete.");
                Width = Marshal.ReadInt32(connected.FormatPointer, bitmapOffset + 4);
                SignedHeight = Marshal.ReadInt32(connected.FormatPointer, bitmapOffset + 8);
                Height = Math.Abs(SignedHeight);
                if (Width <= 0 || Height <= 0 || Width > 8192 || Height > 8192) throw new InvalidOperationException("Invalid camera dimensions.");
                long frameInterval = Marshal.ReadInt64(connected.FormatPointer, 40);
                NominalFps = frameInterval > 0 ? 10000000.0 / frameInterval : 0;
                Stride = (Width * 3 + 3) & ~3;
            }
            finally { if (connected.FormatPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(connected.FormatPointer); if (connected.Unknown != IntPtr.Zero) Marshal.Release(connected.Unknown); }
        }
        catch { Dispose(); throw; }
    }

    internal void Start() { Check(control.Run(), "IMediaControl.Run"); }
    internal byte[] NextFrame(int waitMilliseconds)
    {
        if (callback.Error != null) throw new InvalidOperationException(callback.Error);
        return callback.Take(waitMilliseconds);
    }
    internal void ReturnFrame(byte[] frame) { callback.Return(frame); }
    internal void CopyTopDown(byte[] frame, IntPtr destination, int width, int height)
    {
        if (frame.Length < checked(Stride * Height)) throw new InvalidOperationException("Incomplete RGB24 camera sample.");
        for (int row = 0; row < height; row++)
        {
            int sourceRow = SignedHeight > 0 ? Height - row - 1 : row;
            Marshal.Copy(frame, sourceRow * Stride, IntPtr.Add(destination, row * width * 3), width * 3);
        }
    }
    internal static string[] ListDevices()
    {
        var devices = Enumerate(); var names = new List<string>();
        try { foreach (DeviceRecord device in devices) names.Add(device.Name); }
        finally { foreach (DeviceRecord device in devices) Release(device.Moniker); }
        return names.ToArray();
    }
    private static string Normalize(string value) { return Regex.Replace(value ?? "", @"\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$", "", RegexOptions.IgnoreCase).Trim(); }
    private static List<DeviceRecord> Enumerate()
    {
        var result = new List<DeviceRecord>();
        object enumeratorObject = null; IEnumMoniker enumerator = null;
        try
        {
            enumeratorObject = Com(new Guid("62BE5D10-60EB-11D0-BD3B-00A0C911CE86"), typeof(ICreateDevEnum).GUID);
            Guid category = new Guid("860BB310-5D01-11D0-BD3B-00A0C911CE86");
            int hr = ((ICreateDevEnum)enumeratorObject).CreateClassEnumerator(ref category, out enumerator, 0);
            if (hr == 1) return result;
            Check(hr, "CreateClassEnumerator");
            var one = new IMoniker[1];
            while (enumerator.Next(1, one, IntPtr.Zero) == 0)
            {
                IMoniker moniker = one[0]; object bag = null; bool retained = false;
                try
                {
                    Guid propertyId = typeof(IPropertyBag).GUID;
                    moniker.BindToStorage(null, null, ref propertyId, out bag);
                    object name; Check(((IPropertyBag)bag).Read("FriendlyName", out name, IntPtr.Zero), "FriendlyName");
                    string text = Convert.ToString(name);
                    if (!Regex.IsMatch(text, "softcam|suisi|sui.?si|随思|-ss(?:-uat)?$", RegexOptions.IgnoreCase))
                    { result.Add(new DeviceRecord { Name = text, Moniker = moniker }); retained = true; }
                }
                finally { Release(bag); if (!retained) Release(moniker); }
            }
            return result;
        }
        catch { foreach (DeviceRecord device in result) Release(device.Moniker); throw; }
        finally { Release(enumerator); Release(enumeratorObject); }
    }
    private sealed class DeviceRecord { internal string Name; internal IMoniker Moniker; }
    private static object Com(Guid classId, Guid interfaceId)
    {
        IntPtr pointer; Check(NativeMethods.CoCreateInstance(ref classId, IntPtr.Zero, 1, ref interfaceId, out pointer), "CoCreateInstance " + classId);
        try { return Marshal.GetObjectForIUnknown(pointer); } finally { Marshal.Release(pointer); }
    }
    private static void Check(int hr, string operation) { if (hr < 0) throw new COMException(operation + " failed (0x" + hr.ToString("X8") + ")", hr); }
    private static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        callback.Stop();
        if (control != null) { try { control.Stop(); } catch { } control = null; }
        if (grabber != null) { try { grabber.SetCallback(null, 1); } catch { } grabber = null; }
        Release(builderObject); builderObject = null;
        Release(graphObject); graphObject = null;
        Release(sourceObject); sourceObject = null;
        Release(grabberObject); grabberObject = null;
        Release(sinkObject); sinkObject = null;
        callback.Dispose();
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class CameraFrames : ISampleGrabberCallback, IDisposable
{
    private readonly object gate = new object();
    private readonly AutoResetEvent available = new AutoResetEvent(false);
    private byte[] pending, spare;
    private bool stopped;
    internal string Error { get; private set; }
    public int SampleCB(double time, IntPtr sample) { return 0; }
    public int BufferCB(double time, IntPtr buffer, int length)
    {
        lock (gate)
        {
            if (stopped) return 0;
            try
            {
                if (length <= 0 || length > 64 * 1024 * 1024) throw new InvalidOperationException("Invalid camera sample length.");
                byte[] target = pending ?? spare;
                if (target == null || target.Length != length) target = new byte[length];
                if (Object.ReferenceEquals(target, spare)) spare = null;
                Marshal.Copy(buffer, target, 0, length);
                pending = target; available.Set();
            }
            catch (Exception error) { Error = error.Message; available.Set(); }
        }
        return 0;
    }
    internal byte[] Take(int timeout)
    {
        available.WaitOne(timeout);
        lock (gate) { byte[] result = pending; pending = null; return result; }
    }
    internal void Return(byte[] frame) { lock (gate) spare = frame; }
    internal void Stop() { lock (gate) { stopped = true; available.Set(); } }
    public void Dispose() { lock (gate) available.Dispose(); }
}

[ComImport, Guid("29840822-5B84-11D0-BD3B-00A0C911CE86"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ICreateDevEnum
{
    [PreserveSig] int CreateClassEnumerator(ref Guid category, out IEnumMoniker enumerator, int flags);
}
[ComImport, Guid("55272A00-42CB-11CE-8135-00AA004BB851"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPropertyBag
{
    [PreserveSig] int Read([MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.Struct)] out object value, IntPtr errorLog);
    [PreserveSig] int Write([MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.Struct)] ref object value);
}

[StructLayout(LayoutKind.Sequential)]
internal struct AMMediaType
{
    public Guid MajorType, SubType;
    [MarshalAs(UnmanagedType.Bool)] public bool FixedSizeSamples;
    [MarshalAs(UnmanagedType.Bool)] public bool TemporalCompression;
    public int SampleSize;
    public Guid FormatType;
    public IntPtr Unknown;
    public int FormatSize;
    public IntPtr FormatPointer;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct FilterInfo
{
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Name;
    public IntPtr Graph;
}

[ComImport, Guid("00000001-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IClassFactory
{
    [PreserveSig] int CreateInstance(IntPtr outer, ref Guid interfaceId, out IntPtr result);
    [PreserveSig] int LockServer([MarshalAs(UnmanagedType.Bool)] bool locked);
}

[ComImport, Guid("56A86895-0AD4-11CE-B03A-0020AF0BA770"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IBaseFilter
{
    [PreserveSig] int GetClassID(out Guid classId);
    [PreserveSig] int Stop();
    [PreserveSig] int Pause();
    [PreserveSig] int Run(long start);
    [PreserveSig] int GetState(int milliseconds, out int state);
    [PreserveSig] int SetSyncSource(IntPtr clock);
    [PreserveSig] int GetSyncSource(out IntPtr clock);
    [PreserveSig] int EnumPins(out IntPtr pins);
    [PreserveSig] int FindPin([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr pin);
    [PreserveSig] int QueryFilterInfo(out FilterInfo info);
    [PreserveSig] int JoinFilterGraph(IntPtr graph, [MarshalAs(UnmanagedType.LPWStr)] string name);
    [PreserveSig] int QueryVendorInfo(out IntPtr vendor);
}

[ComImport, Guid("56A868A9-0AD4-11CE-B03A-0020AF0BA770"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IGraphBuilder
{
    [PreserveSig] int AddFilter(IBaseFilter filter, [MarshalAs(UnmanagedType.LPWStr)] string name);
    [PreserveSig] int RemoveFilter(IBaseFilter filter);
    [PreserveSig] int EnumFilters(out IntPtr filters);
    [PreserveSig] int FindFilterByName([MarshalAs(UnmanagedType.LPWStr)] string name, out IBaseFilter filter);
    [PreserveSig] int ConnectDirect(IntPtr output, IntPtr input, IntPtr mediaType);
    [PreserveSig] int Reconnect(IntPtr pin);
    [PreserveSig] int Disconnect(IntPtr pin);
    [PreserveSig] int SetDefaultSyncSource();
    [PreserveSig] int Connect(IntPtr output, IntPtr input);
    [PreserveSig] int Render(IntPtr pin);
    [PreserveSig] int RenderFile([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.LPWStr)] string playlist);
    [PreserveSig] int AddSourceFilter([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.LPWStr)] string name, out IBaseFilter filter);
    [PreserveSig] int SetLogFile(IntPtr file);
    [PreserveSig] int Abort();
    [PreserveSig] int ShouldOperationContinue();
}

[ComImport, Guid("93E5A4E0-2D50-11D2-ABFA-00A0C9C6E38D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ICaptureGraphBuilder2
{
    [PreserveSig] int SetFiltergraph(IGraphBuilder graph);
    [PreserveSig] int GetFiltergraph(out IGraphBuilder graph);
    [PreserveSig] int SetOutputFileName(ref Guid type, [MarshalAs(UnmanagedType.LPWStr)] string file, out IBaseFilter filter, out IntPtr sink);
    [PreserveSig] int FindInterface(IntPtr category, IntPtr type, IBaseFilter filter, ref Guid interfaceId, out IntPtr result);
    [PreserveSig] int RenderStream(IntPtr category, IntPtr type, [MarshalAs(UnmanagedType.IUnknown)] object source, IBaseFilter intermediate, IBaseFilter sink);
    [PreserveSig] int ControlStream(IntPtr category, IntPtr type, IBaseFilter filter, IntPtr start, IntPtr stop, short startCookie, short stopCookie);
    [PreserveSig] int AllocCapFile([MarshalAs(UnmanagedType.LPWStr)] string file, long bytes);
    [PreserveSig] int CopyCaptureFile([MarshalAs(UnmanagedType.LPWStr)] string oldFile, [MarshalAs(UnmanagedType.LPWStr)] string newFile, int allowEscape, IntPtr callback);
    [PreserveSig] int FindPin([MarshalAs(UnmanagedType.IUnknown)] object source, int direction, IntPtr category, IntPtr type,
        [MarshalAs(UnmanagedType.Bool)] bool unconnected, int index, out IntPtr pin);
}

[ComImport, Guid("56A868B1-0AD4-11CE-B03A-0020AF0BA770"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
internal interface IMediaControl
{
    [PreserveSig] int Run();
    [PreserveSig] int Pause();
    [PreserveSig] int Stop();
    [PreserveSig] int GetState(int milliseconds, out int state);
    [PreserveSig] int RenderFile([MarshalAs(UnmanagedType.BStr)] string file);
    [PreserveSig] int AddSourceFilter([MarshalAs(UnmanagedType.BStr)] string file, [MarshalAs(UnmanagedType.IDispatch)] out object filter);
    [PreserveSig] int GetFilterCollection([MarshalAs(UnmanagedType.IDispatch)] out object collection);
    [PreserveSig] int GetRegFilterCollection([MarshalAs(UnmanagedType.IDispatch)] out object collection);
    [PreserveSig] int StopWhenReady();
}

[ComImport, Guid("6B652FFF-11FE-4FCE-92AD-0266B5D7C78F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISampleGrabber
{
    [PreserveSig] int SetOneShot([MarshalAs(UnmanagedType.Bool)] bool oneShot);
    [PreserveSig] int SetMediaType([In] ref AMMediaType mediaType);
    [PreserveSig] int GetConnectedMediaType(out AMMediaType mediaType);
    [PreserveSig] int SetBufferSamples([MarshalAs(UnmanagedType.Bool)] bool buffer);
    [PreserveSig] int GetCurrentBuffer(ref int size, IntPtr buffer);
    [PreserveSig] int GetCurrentSample(out IntPtr sample);
    [PreserveSig] int SetCallback(ISampleGrabberCallback callback, int which);
}

[ComVisible(true), Guid("0579154A-2B53-4994-B0D0-E773148EFF85"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISampleGrabberCallback
{
    [PreserveSig] int SampleCB(double sampleTime, IntPtr sample);
    [PreserveSig] int BufferCB(double sampleTime, IntPtr buffer, int length);
}


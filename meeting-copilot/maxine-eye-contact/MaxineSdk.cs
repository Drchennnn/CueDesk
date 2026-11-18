using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

// ABI follows NVIDIA AR SDK nvAR.h and nvCVImage.h, retained with the analysis.
internal sealed class MaxineSdk : IDisposable
{
    private readonly List<IntPtr> modules = new List<IntPtr>();
    private readonly List<IntPtr> images = new List<IntPtr>();
    private IntPtr feature, stream, landmarks, confidence;
    private IntPtr gpuInput, gpuOutput, cpuInput, cpuOutput;
    internal IntPtr InputPixels { get; private set; }
    internal IntPtr OutputPixels { get; private set; }
    internal int Width { get; private set; }
    internal int Height { get; private set; }

    private CreateFeature create;
    private FeatureCall load, run, destroy;
    private StreamCreate createStream;
    private StreamCall destroyStream, syncStream;
    private SetU32 setU32;
    private SetS32 setS32;
    private SetPointer setStream;
    private SetText setText;
    private SetObject setObject;
    private SetArray setArray;
    private ImageAlloc alloc;
    private ImageInit init;
    private ImageTransfer transfer;
    private ImageDealloc dealloc;

    internal MaxineSdk(string directory, int width, int height, bool lookAway, int eyeSize, uint temporal)
    {
        Width = width; Height = height;
        try
        {
            if (Marshal.SizeOf(typeof(NvCvImageLayout)) != 64) throw new InvalidOperationException("NvCVImage ABI size must be 64 bytes.");
            NativeMethods.SetDllDirectoryW(directory);
            IntPtr imageDll = Open(Path.Combine(directory, "NVCVImage.dll"));
            IntPtr sdkDll = Open(Path.Combine(directory, "nvARPose.dll"));
            string[] runtimes = Directory.GetFiles(directory, "cudart64*.dll");
            if (runtimes.Length != 1) throw new InvalidOperationException("Expected one CUDA runtime DLL in the selected SDK directory.");
            IntPtr cudaDll = Open(runtimes[0]);
            create = Bind<CreateFeature>(sdkDll, "NvAR_Create");
            load = Bind<FeatureCall>(sdkDll, "NvAR_Load"); run = Bind<FeatureCall>(sdkDll, "NvAR_Run");
            destroy = Bind<FeatureCall>(sdkDll, "NvAR_Destroy");
            createStream = Bind<StreamCreate>(sdkDll, "NvAR_CudaStreamCreate");
            destroyStream = Bind<StreamCall>(sdkDll, "NvAR_CudaStreamDestroy");
            syncStream = Bind<StreamCall>(cudaDll, "cudaStreamSynchronize");
            setU32 = Bind<SetU32>(sdkDll, "NvAR_SetU32"); setS32 = Bind<SetS32>(sdkDll, "NvAR_SetS32");
            setStream = Bind<SetPointer>(sdkDll, "NvAR_SetCudaStream");
            setText = Bind<SetText>(sdkDll, "NvAR_SetString");
            setObject = Bind<SetObject>(sdkDll, "NvAR_SetObject");
            setArray = Bind<SetArray>(sdkDll, "NvAR_SetF32Array");
            alloc = Bind<ImageAlloc>(imageDll, "NvCVImage_Alloc");
            init = Bind<ImageInit>(imageDll, "NvCVImage_Init");
            transfer = Bind<ImageTransfer>(imageDll, "NvCVImage_Transfer");
            dealloc = Bind<ImageDealloc>(imageDll, "NvCVImage_Dealloc");
            Check(createStream(out stream), "NvAR_CudaStreamCreate");
            Check(create("GazeRedirection", out feature), "NvAR_Create(GazeRedirection)");
            Check(setText(feature, "NvAR_Parameter_Config_ModelDir", "models"), "ModelDir");
            Configure("Landmarks_Size", 68);
            Configure("Temporal", temporal);
            Configure("GazeRedirect", 1);
            Check(setStream(feature, "NvAR_Parameter_Config_CUDAStream", stream), "CUDAStream");
            Configure("UseCudaGraph", 0);
            Configure("EyeSizeSensitivity", (uint)eyeSize);
            Configure("EnableLookAway", lookAway ? 1U : 0U);
            Check(load(feature), "NvAR_Load");

            gpuInput = NewImage(); gpuOutput = NewImage(); cpuInput = NewImage(); cpuOutput = NewImage();
            Check(alloc(gpuInput, (uint)width, (uint)height, 5, 1, 0, 1, 1), "NvCVImage_Alloc(input GPU BGR)");
            Check(alloc(gpuOutput, (uint)width, (uint)height, 5, 1, 0, 1, 1), "NvCVImage_Alloc(output GPU BGR)");
            InputPixels = Marshal.AllocHGlobal(checked(width * height * 3));
            OutputPixels = Marshal.AllocHGlobal(checked(width * height * 3));
            Check(init(cpuInput, (uint)width, (uint)height, width * 3, InputPixels, 5, 1, 0, 0), "NvCVImage_Init(input CPU BGR)");
            Check(init(cpuOutput, (uint)width, (uint)height, width * 3, OutputPixels, 5, 1, 0, 0), "NvCVImage_Init(output CPU BGR)");
            Check(setObject(feature, "NvAR_Parameter_Input_Image", gpuInput, 64), "Input_Image");
            Check(setObject(feature, "NvAR_Parameter_Output_Image", gpuOutput, 64), "Output_Image");
            Check(setS32(feature, "NvAR_Parameter_Input_Width", width), "Input_Width");
            Check(setS32(feature, "NvAR_Parameter_Input_Height", height), "Input_Height");
            landmarks = Marshal.AllocHGlobal(68 * 8);
            confidence = Marshal.AllocHGlobal(68 * 4);
            Zero(landmarks, 68 * 8); Zero(confidence, 68 * 4);
            Check(setObject(feature, "NvAR_Parameter_Output_Landmarks", landmarks, 8), "Output_Landmarks");
            Check(setArray(feature, "NvAR_Parameter_Output_LandmarksConfidence", confidence, 68), "LandmarksConfidence");
        }
        catch { Dispose(); throw; }
    }

    internal void Correct()
    {
        Check(transfer(cpuInput, gpuInput, 1.0f, stream, IntPtr.Zero), "NvCVImage_Transfer(CPU to GPU)");
        Check(run(feature), "NvAR_Run");
        Check(transfer(gpuOutput, cpuOutput, 1.0f, stream, IntPtr.Zero), "NvCVImage_Transfer(GPU to CPU)");
        Check(syncStream(stream), "cudaStreamSynchronize");
    }

    internal double AverageConfidence()
    {
        float[] values = new float[68]; Marshal.Copy(confidence, values, 0, values.Length);
        double sum = 0; foreach (float value in values) sum += value;
        return sum / values.Length;
    }

    private void Configure(string name, uint value) { Check(setU32(feature, "NvAR_Parameter_Config_" + name, value), name); }
    private IntPtr NewImage() { IntPtr image = Marshal.AllocHGlobal(64); Zero(image, 64); images.Add(image); return image; }
    private static void Zero(IntPtr memory, int length) { Marshal.Copy(new byte[length], 0, memory, length); }
    private IntPtr Open(string file)
    {
        IntPtr module = NativeMethods.LoadLibraryW(file);
        if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot load " + file);
        modules.Add(module); return module;
    }
    internal static T Bind<T>(IntPtr module, string name) where T : class
    {
        IntPtr function = NativeMethods.GetProcAddress(module, name);
        if (function == IntPtr.Zero) throw new EntryPointNotFoundException(name);
        return Marshal.GetDelegateForFunctionPointer(function, typeof(T)) as T;
    }
    private static void Check(int status, string operation) { if (status != 0) throw new InvalidOperationException(operation + " returned " + status); }

    public void Dispose()
    {
        if (stream != IntPtr.Zero && syncStream != null)
        {
            int status = syncStream(stream);
            if (status != 0) Console.Error.WriteLine("CUDA cleanup synchronization returned " + status);
        }
        if (feature != IntPtr.Zero && destroy != null) { destroy(feature); feature = IntPtr.Zero; }
        foreach (IntPtr image in images) { if (dealloc != null) dealloc(image); Marshal.FreeHGlobal(image); }
        images.Clear();
        if (InputPixels != IntPtr.Zero) { Marshal.FreeHGlobal(InputPixels); InputPixels = IntPtr.Zero; }
        if (OutputPixels != IntPtr.Zero) { Marshal.FreeHGlobal(OutputPixels); OutputPixels = IntPtr.Zero; }
        if (landmarks != IntPtr.Zero) { Marshal.FreeHGlobal(landmarks); landmarks = IntPtr.Zero; }
        if (confidence != IntPtr.Zero) { Marshal.FreeHGlobal(confidence); confidence = IntPtr.Zero; }
        if (stream != IntPtr.Zero && destroyStream != null) { destroyStream(stream); stream = IntPtr.Zero; }
        for (int i = modules.Count - 1; i >= 0; i--) NativeMethods.FreeLibrary(modules[i]);
        modules.Clear();
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int CreateFeature([MarshalAs(UnmanagedType.LPStr)] string name, out IntPtr handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int FeatureCall(IntPtr handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int StreamCreate(out IntPtr stream);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int StreamCall(IntPtr stream);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetU32(IntPtr handle, [MarshalAs(UnmanagedType.LPStr)] string name, uint value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetS32(IntPtr handle, [MarshalAs(UnmanagedType.LPStr)] string name, int value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetPointer(IntPtr handle, [MarshalAs(UnmanagedType.LPStr)] string name, IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetText(IntPtr handle, [MarshalAs(UnmanagedType.LPStr)] string name, [MarshalAs(UnmanagedType.LPStr)] string value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetObject(IntPtr handle, [MarshalAs(UnmanagedType.LPStr)] string name, IntPtr value, uint typeSize);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetArray(IntPtr handle, [MarshalAs(UnmanagedType.LPStr)] string name, IntPtr values, int count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ImageAlloc(IntPtr image, uint width, uint height, int format, int type, uint layout, uint space, uint alignment);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ImageInit(IntPtr image, uint width, uint height, int pitch, IntPtr pixels, int format, int type, uint layout, uint space);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ImageTransfer(IntPtr source, IntPtr destination, float scale, IntPtr stream, IntPtr temporary);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void ImageDealloc(IntPtr image);
}

[StructLayout(LayoutKind.Sequential)]
internal struct NvCvImageLayout
{
    public uint Width, Height;
    public int Pitch, PixelFormat, ComponentType;
    public byte PixelBytes, ComponentBytes, NumComponents, Planar, GpuMemory, ColorSpace, Reserved0, Reserved1;
    public IntPtr Pixels, DeletePointer, DeleteProcedure;
    public ulong BufferBytes;
}

internal static class NativeMethods
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr LoadLibraryW(string file);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)] internal static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetDllDirectoryW(string directory);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool FreeLibrary(IntPtr module);
    [DllImport("ole32.dll", ExactSpelling = true)] internal static extern int CoCreateInstance(ref Guid classId, IntPtr outer, uint context, ref Guid interfaceId, out IntPtr result);
}

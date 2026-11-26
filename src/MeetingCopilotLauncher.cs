using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("MeetingCopilot")]
[assembly: AssemblyDescription("MeetingCopilot V3.2 Portable Launcher")]
[assembly: AssemblyProduct("MeetingCopilot")]
[assembly: AssemblyVersion("3.2.0.0")]
[assembly: AssemblyFileVersion("3.2.0.0")]

internal static class Program
{
    private static string QuoteArg(string arg)
    {
        if (string.IsNullOrEmpty(arg)) return "\"\"";
        bool needsQuotes = false;
        for (int i = 0; i < arg.Length; i++)
        {
            char c = arg[i];
            if (char.IsWhiteSpace(c) || c == '"')
            {
                needsQuotes = true;
                break;
            }
        }
        if (!needsQuotes) return arg;
        var sb = new StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        for (int i = 0; i < arg.Length; i++)
        {
            char c = arg[i];
            if (c == '\\')
            {
                backslashes++;
            }
            else if (c == '"')
            {
                sb.Append('\\', backslashes * 2 + 1);
                sb.Append('"');
                backslashes = 0;
            }
            else
            {
                if (backslashes > 0)
                {
                    sb.Append('\\', backslashes);
                    backslashes = 0;
                }
                sb.Append(c);
            }
        }
        if (backslashes > 0) sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string[] candidates = new[]
            {
                Path.Combine(baseDir, "app", "MeetingCopilot.exe"),
                Path.Combine(baseDir, "releases", "MeetingCopilot-V3.2", "app", "MeetingCopilot.exe")
            };
            string targetExe = null;
            foreach (string path in candidates)
            {
                if (File.Exists(path))
                {
                    targetExe = path;
                    break;
                }
            }
            if (targetExe == null) return 2;

            var argBuilder = new StringBuilder();
            for (int i = 0; i < args.Length; i++)
            {
                if (i > 0) argBuilder.Append(' ');
                argBuilder.Append(QuoteArg(args[i]));
            }

            var psi = new ProcessStartInfo
            {
                FileName = targetExe,
                WorkingDirectory = Path.GetDirectoryName(targetExe) ?? baseDir,
                Arguments = argBuilder.ToString(),
                UseShellExecute = false
            };
            if (psi.EnvironmentVariables.ContainsKey("ELECTRON_RUN_AS_NODE"))
            {
                psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            }
            Process.Start(psi);
            return 0;
        }
        catch
        {
            return 1;
        }
    }
}

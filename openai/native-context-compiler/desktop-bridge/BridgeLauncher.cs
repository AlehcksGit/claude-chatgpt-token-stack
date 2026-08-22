using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

internal static class BridgeLauncher
{
    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            return value;
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                slashes++;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1);
                result.Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes);
            slashes = 0;
            result.Append(character);
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static void CopyStream(Stream source, Stream target)
    {
        try
        {
            var buffer = new byte[8192];
            int count;
            while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                target.Write(buffer, 0, count);
                target.Flush();
            }
        }
        catch { }
    }

    public static int Main(string[] args)
    {
        try
        {
            var root = AppDomain.CurrentDomain.BaseDirectory;
            var config = File.ReadAllLines(Path.Combine(root, "launcher.conf"));
            if (config.Length < 2 || String.IsNullOrWhiteSpace(config[0]) || String.IsNullOrWhiteSpace(config[1]))
                throw new InvalidDataException("launcher.conf must contain the Node and proxy script paths");

            var arguments = new StringBuilder(Quote(config[1]));
            foreach (var argument in args)
            {
                arguments.Append(' ');
                arguments.Append(Quote(argument));
            }

            var start = new ProcessStartInfo
            {
                FileName = config[0],
                Arguments = arguments.ToString(),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using (var child = Process.Start(start))
            {
                if (child == null) throw new InvalidOperationException("The Node bridge process did not start");
                var stdout = Task.Run(() => CopyStream(child.StandardOutput.BaseStream, Console.OpenStandardOutput()));
                var stderr = Task.Run(() => CopyStream(child.StandardError.BaseStream, Console.OpenStandardError()));
                Task.Run(() =>
                {
                    try
                    {
                        CopyStream(Console.OpenStandardInput(), child.StandardInput.BaseStream);
                        child.StandardInput.Close();
                    }
                    catch { }
                });
                child.WaitForExit();
                Task.WaitAll(new[] { stdout, stderr }, 5000);
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            try { Console.Error.WriteLine("Native Context Compiler desktop bridge failed: " + error.Message); }
            catch { }
            return 1;
        }
    }
}

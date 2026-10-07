// GTA Door Creator - DoorCore engine
// Reads/writes GTA V resource files (YDR / YTYP / YBN / YTD) through CodeWalker.Core.
// Protocol: one JSON request per stdin line, one JSON response per stdout line.
//   {"id":1,"cmd":"load","path":"C:\\props\\door.ydr"}
//   {"id":2,"cmd":"export", ...}
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeWalker.GameFiles;

namespace DoorCore
{
    public static class Program
    {
        public static int Main(string[] args)
        {
            Console.InputEncoding = Encoding.UTF8;
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            Console.SetOut(stdout);
            Hashes.Init();
            RpfManager.IsGen9 = false; // FiveM uses the legacy (gen8) resource format

            // CLI mode for testing:  DoorCore load <file>   |   DoorCore export <job.json>
            if (args.Length >= 2)
            {
                var req = new JsonObject { ["id"] = 0, ["cmd"] = args[0] };
                if (args[0] == "export" || args[0] == "build" || args[0] == "audio" || args[0] == "splitpreview" || args[0] == "destructanim" || args[0] == "dev" || args[0] == "treescan" || args[0] == "treebuild" || args[0] == "texfind" || args[0] == "texexport" || args[0] == "texbuild") req = JsonNode.Parse(File.ReadAllText(args[1])).AsObject();
                else req["path"] = args[1];
                if (!req.ContainsKey("cmd")) req["cmd"] = args[0];
                Console.WriteLine(Handle(req).ToJsonString());
                return 0;
            }

            Console.WriteLine(new JsonObject { ["ready"] = true, ["engine"] = "DoorCore 1.0 (CodeWalker.Core)" }.ToJsonString());
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                JsonObject req;
                try { req = JsonNode.Parse(line).AsObject(); }
                catch (Exception ex) { Console.WriteLine(new JsonObject { ["id"] = -1, ["ok"] = false, ["error"] = "Bad JSON: " + ex.Message }.ToJsonString()); continue; }
                Console.WriteLine(Handle(req).ToJsonString());
            }
            return 0;
        }

        static JsonObject Handle(JsonObject req)
        {
            var id = req["id"]?.DeepClone();
            try
            {
                var cmd = (string)req["cmd"];
                JsonNode result = cmd switch
                {
                    "ping" => new JsonObject { ["pong"] = true },
                    "load" => Loader.Load((string)req["path"]),
                    "splitpreview" => Destruct.Preview(req),
                    "destructanim" => DestructAnim.Preview(req),
                    "dev" => DevTest.Run(req),
                    "treescan" => TreeLod.Scan(req),
                    "treebuild" => TreeLod.Build(req),
                    "texfind" => TexExport.Find(req),
                    "texexport" => TexExport.Export(req),
                    "texdeep" => TexExport.Deep(req),
                    "texbuild" => TexBuild.Build(req),
                    "export" => Exporter.Export(req),
                    "build" => TestBuilder.Build(req),
                    "audio" => Audio.Build(req),
                    _ => throw new Exception("Unknown command: " + cmd)
                };
                return new JsonObject { ["id"] = id, ["ok"] = true, ["result"] = result };
            }
            catch (Exception ex)
            {
                return new JsonObject { ["id"] = id, ["ok"] = false, ["error"] = ex.Message, ["trace"] = ex.ToString() };
            }
        }
    }

    public static class Hashes
    {
        public static void Init()
        {
            var baseDir = AppContext.BaseDirectory;
            var extra = new[] { "DiffuseSampler", "BumpSampler", "SpecSampler", "DetailSampler", "DiffuseSampler2", "TextureSampler_layer0",
                "TextureSampler_layer1", "TextureSampler_layer2", "TextureSampler_layer3", "DirtSampler", "EnvironmentSampler", "PlateBgSampler",
                "diffusesampler", "bumpsampler", "specsampler" };
            foreach (var s in extra) { JenkIndex.Ensure(s); JenkIndex.Ensure(s.ToLowerInvariant()); }
            var sfile = Path.Combine(baseDir, "strings.txt");
            if (File.Exists(sfile))
            {
                foreach (var l in File.ReadAllLines(sfile))
                {
                    var t = l.Trim();
                    if (t.Length == 0 || t.StartsWith("//")) continue;
                    JenkIndex.Ensure(t);
                    JenkIndex.Ensure(t + ".sps");
                }
            }
        }
        public static string Name(uint h)
        {
            var s = JenkIndex.TryGetString(h);
            return string.IsNullOrEmpty(s) ? ("hash_" + h.ToString("X8")) : s;
        }
    }

    public static class Util
    {
        public static byte[] LoadResource<T>(T file, string path) where T : class, PackedFile
        {
            var data = File.ReadAllBytes(path);
            var name = Path.GetFileName(path);
            uint ver = 165;
            if (file is YtypFile) ver = 2;
            if (file is YbnFile) ver = 43;
            if (file is YtdFile) ver = 13;
            if (file is YftFile) ver = 162;
            RpfFile.LoadResourceFile(file, data, ver);
            if (file is GameFile gf && gf.RpfFileEntry != null)
            {
                gf.RpfFileEntry.Name = name;
                gf.RpfFileEntry.NameLower = name.ToLowerInvariant();
            }
            return data;
        }
        public static JsonArray V3(SharpDX.Vector3 v) => new JsonArray(R(v.X), R(v.Y), R(v.Z));
        public static double R(float f) => Math.Round((double)f, 5);
        public static SharpDX.Vector3 ReadV3(JsonNode n, SharpDX.Vector3 def = default)
        {
            if (n is JsonArray a && a.Count >= 3) return new SharpDX.Vector3((float)a[0], (float)a[1], (float)a[2]);
            return def;
        }
        public static string B64<T>(T[] arr) where T : struct
        {
            var bytes = new byte[System.Runtime.InteropServices.Marshal.SizeOf<T>() * arr.Length];
            Buffer.BlockCopy(arr, 0, bytes, 0, bytes.Length);
            return Convert.ToBase64String(bytes);
        }
        public static string F(float f) => f.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture);
    }
}

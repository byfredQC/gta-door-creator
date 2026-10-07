// TEXTURES: type a prop / shell name -> every texture it uses, exported as .dds (the files CodeWalker / OpenIV / Sollumz use).
//   search order: the user's folder (loose files, e.g. the server resources) then the GTA V install (read only)
//   textures:     embedded in the model + its whole .ytd + the textures it uses from parent .ytd (gtxd) / mapdetail
//   MLO shell:    every model placed in the interior is processed too
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using CodeWalker.GameFiles;
using CodeWalker.Utils;

namespace DoorCore
{
    public static class TexExport
    {
        // ------------------------------------------------------------------ the user's folder (loose files)
        static string localRoot;
        static Dictionary<uint, string> localModels, localYtds;
        static Dictionary<uint, (Archetype a, string ytyp)> localArchs;

        static void IndexFolder(string folder)
        {
            if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder)) { localRoot = null; localModels = new(); localYtds = new(); localArchs = new(); return; }
            if (string.Equals(localRoot, folder, StringComparison.OrdinalIgnoreCase) && localModels != null) return;
            var models = new Dictionary<uint, string>(); var ytds = new Dictionary<uint, string>(); var archs = new Dictionary<uint, (Archetype, string)>();
            var opt = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, MatchCasing = MatchCasing.CaseInsensitive };
            foreach (var f in Directory.EnumerateFiles(folder, "*.*", opt))
            {
                var ext = Path.GetExtension(f).ToLowerInvariant();
                var h = JenkHash.GenHash(Path.GetFileNameWithoutExtension(f).ToLowerInvariant());
                if (ext == ".ydr" || ext == ".yft" || ext == ".ydd") models.TryAdd(h, f);
                else if (ext == ".ytd") ytds.TryAdd(h, f);
                else if (ext == ".ytyp")
                {
                    try
                    {
                        var y = new YtypFile(); Util.LoadResource(y, f);
                        foreach (var a in y.AllArchetypes ?? Array.Empty<Archetype>()) archs.TryAdd(a._BaseArchetypeDef.name.Hash, (a, f));
                    }
                    catch { }
                }
            }
            localRoot = folder; localModels = models; localYtds = ytds; localArchs = archs;
        }

        // ------------------------------------------------------------------ lookups (folder first, then GTA)
        static Archetype FindArch(uint h, out string from)
        {
            if (localArchs.TryGetValue(h, out var la)) { from = la.ytyp; return la.a; }
            if (GtaFiles.Ready) { var a = GtaFiles.ArchetypeObj(h); if (a != null) { from = "GTA " + (a.Ytyp?.Name ?? "ytyp"); return a; } }
            from = null; return null;
        }
        static List<DrawableBase> LoadDrawables(uint h, out string from, out string kind)
        {
            var list = new List<DrawableBase>(); from = null; kind = null;
            GameFile gf = null;
            if (localModels.TryGetValue(h, out var p))
            {
                from = p; kind = Path.GetExtension(p).TrimStart('.').ToLowerInvariant();
                gf = kind switch { "ydr" => new YdrFile(), "yft" => new YftFile(), _ => new YddFile() };
                switch (gf) { case YdrFile y: Util.LoadResource(y, p); break; case YftFile y: Util.LoadResource(y, p); break; case YddFile y: Util.LoadResource(y, p); break; }
            }
            else if (GtaFiles.Ready && GtaFiles.Model(h) is RpfFileEntry e)
            {
                from = "GTA " + e.Path; kind = Path.GetExtension(e.NameLower).TrimStart('.');
                gf = kind switch { "ydr" => GtaFiles.Get<YdrFile>(e), "yft" => GtaFiles.Get<YftFile>(e), _ => GtaFiles.Get<YddFile>(e) };
            }
            switch (gf)
            {
                case YdrFile y when y.Drawable != null: list.Add(y.Drawable); break;
                case YftFile y when y.Fragment != null:
                    if (y.Fragment.Drawable != null) list.Add(y.Fragment.Drawable);
                    if (y.Fragment.DrawableCloth != null) list.Add(y.Fragment.DrawableCloth);
                    foreach (var d in y.Fragment.DrawableArray?.data_items ?? Array.Empty<FragDrawable>()) if (d != null) list.Add(d);
                    break;
                case YddFile y when y.Drawables != null: list.AddRange(y.Drawables.Where(d => d != null)); break;
            }
            return list;
        }
        static TextureDictionary LoadYtd(uint h, out string from)
        {
            from = null;
            if (h == 0) return null;
            if (localYtds.TryGetValue(h, out var p)) { var y = new YtdFile(); Util.LoadResource(y, p); from = p; return y.TextureDict; }
            if (GtaFiles.Ready && GtaFiles.Ytd(h) is RpfFileEntry e) { from = "GTA " + e.Path; return GtaFiles.Get<YtdFile>(e)?.TextureDict; }
            return null;
        }

        // ------------------------------------------------------------------ find
        class Found { public Texture Tex; public string From; }
        static Dictionary<string, Found> last = new(StringComparer.OrdinalIgnoreCase);
        static string lastName;

        public static JsonNode Find(JsonObject req)
        {
            var name = ((string)req["name"] ?? "").Trim().ToLowerInvariant();
            foreach (var ext in new[] { ".ydr", ".yft", ".ydd", ".ytd", ".ytyp" }) if (name.EndsWith(ext)) name = name.Substring(0, name.Length - ext.Length);
            if (name.Length == 0) throw new Exception("Type a prop / shell name");
            var gta = (string)req["gta"];
            if (!string.IsNullOrWhiteSpace(gta)) GtaFiles.Init(gta, (string)req["key"]);
            IndexFolder((string)req["folder"]);
            if (!GtaFiles.Ready && localRoot == null) throw new Exception("Choose your GTA V folder and/or your own folder first");

            var hash = JenkHash.GenHash(name);
            var found = new Dictionary<string, Found>(StringComparer.OrdinalIgnoreCase);
            var models = new JsonArray(); var warnings = new JsonArray();
            var missing = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            var txdsDone = new HashSet<uint>();

            void AddTex(Texture t, string from) { if (t?.Name != null && !found.ContainsKey(t.Name)) found[t.Name] = new Found { Tex = t, From = from }; }

            // which models: the archetype itself, or every entity of an MLO shell
            var root = FindArch(hash, out var archFrom);
            var todo = new List<uint>();
            bool mlo = root is MloArchetype;
            if (root is MloArchetype m)
            {
                foreach (var en in m.entities ?? Array.Empty<MCEntityDef>()) { var h = en._Data.archetypeName.Hash; if (!todo.Contains(h)) todo.Add(h); }
                if (todo.Count == 0) warnings.Add("This MLO has no entity");
            }
            else todo.Add(hash);

            bool anything = false;
            foreach (var mh in todo)
            {
                var arch = mh == hash ? root : FindArch(mh, out _);
                var mname = arch != null ? GtaFiles.Name(arch._BaseArchetypeDef.name.Hash) : GtaFiles.Name(mh);
                if (mname.StartsWith("hash_") && mh == hash) mname = name;
                // drawable may live in a .ydd (drawableDictionary) - otherwise the model name
                var dd = arch?._BaseArchetypeDef.drawableDictionary.Hash ?? 0;
                var draws = LoadDrawables(dd != 0 ? dd : mh, out var mfrom, out var kind);
                if (draws.Count == 0 && dd != 0) draws = LoadDrawables(mh, out mfrom, out kind);
                var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var d in draws)
                {
                    var sg = d.ShaderGroup;
                    foreach (var t in sg?.TextureDictionary?.Textures?.data_items ?? Array.Empty<Texture>()) AddTex(t, "embedded in " + mname);
                    foreach (var sh in sg?.Shaders?.data_items ?? Array.Empty<ShaderFX>())
                        foreach (var prm in sh?.ParametersList?.Parameters ?? Array.Empty<ShaderParameter>())
                            if (prm.DataType == 0 && prm.Data is TextureBase tb && !string.IsNullOrEmpty(tb.Name)) used.Add(tb.Name);
                }
                if (draws.Count == 0 && arch == null) { if (mh == hash && LoadYtd(hash, out _) == null) throw new Exception($"\"{name}\" not found (model, archetype or .ytd) in {(localRoot != null ? "your folder" : "")}{(localRoot != null && GtaFiles.Ready ? " or " : "")}{(GtaFiles.Ready ? "GTA V" : "")}"); }
                if (draws.Count == 0 && !(mh == hash && arch == null)) { warnings.Add($"{mname}: model not found"); }

                // texture dictionary + parents
                uint txd = arch?._BaseArchetypeDef.textureDictionary.Hash ?? 0;
                if (txd == 0) txd = mh;    // custom props / shells: usually a .ytd with the same name
                var chain = new List<uint>();
                for (uint t = txd; t != 0 && chain.Count < 10 && !chain.Contains(t); t = GtaFiles.Ready ? GtaFiles.TxdParent(t) : 0) chain.Add(t);
                bool first = true;
                foreach (var t in chain)
                {
                    var td = LoadYtd(t, out var tfrom);
                    if (td == null) { if (first && t != mh) warnings.Add($"{mname}: texture dictionary {GtaFiles.Name(t)} not found"); first = false; continue; }
                    var tname = t == mh ? mname : GtaFiles.Name(t);
                    foreach (var tex in td.Textures?.data_items ?? Array.Empty<Texture>())
                        if (first || used.Contains(tex.Name)) AddTex(tex, tname + ".ytd" + (first ? "" : " (parent)"));
                    if (first) txdsDone.Add(t);
                    first = false;
                }
                // shared GTA dictionary used by many map props
                if (GtaFiles.Ready && used.Any(u => !found.ContainsKey(u)))
                {
                    var md = LoadYtd(JenkHash.GenHash("mapdetail"), out _);
                    foreach (var tex in md?.Textures?.data_items ?? Array.Empty<Texture>()) if (used.Contains(tex.Name)) AddTex(tex, "mapdetail.ytd (GTA shared)");
                }
                foreach (var u in used) if (!found.ContainsKey(u)) missing.Add(u);
                if (draws.Count > 0) anything = true;
                models.Add(new JsonObject { ["name"] = mname, ["kind"] = kind, ["from"] = mfrom, ["txd"] = txd == mh ? mname : GtaFiles.Name(txd), ["used"] = used.Count });
            }
            // the name was only a texture dictionary
            if (!anything && found.Count == 0)
            {
                var td = LoadYtd(hash, out var tfrom);
                if (td != null) foreach (var tex in td.Textures?.data_items ?? Array.Empty<Texture>()) AddTex(tex, name + ".ytd");
            }
            if (found.Count == 0) throw new Exception($"No texture found for \"{name}\"" + (missing.Count > 0 ? $" ({missing.Count} used textures missing)" : ""));
            last = found; lastName = name;

            var texs = Describe(found);
            return new JsonObject
            {
                ["name"] = name, ["mlo"] = mlo, ["archetypeFrom"] = archFrom, ["models"] = models, ["textures"] = texs,
                ["missing"] = new JsonArray(missing.Select(x => (JsonNode)x).ToArray()), ["warnings"] = warnings, ["key"] = GtaFiles.Key,
            };
        }

        // ------------------------------------------------------------------ deep search: the missing textures in EVERY GTA .ytd
        // (custom shells often use vanilla map textures). The index texture -> ytd is built once and cached on disk.
        static Dictionary<uint, string> texIndex;
        public static JsonNode Deep(JsonObject req)
        {
            if (!GtaFiles.Ready) throw new Exception("Choose your GTA V folder first");
            var names = (req["names"] as JsonArray ?? new JsonArray()).Select(x => (string)x).Where(x => !string.IsNullOrEmpty(x)).ToList();
            if (names.Count == 0) return new JsonObject { ["added"] = 0 };
            var cache = Path.Combine(Path.GetTempPath(), "gta-door-creator", $"texindex_{JenkHash.GenHash(GtaFiles.Folder.ToLowerInvariant()):X8}.txt");
            if (texIndex == null && File.Exists(cache))
            {
                texIndex = new();
                foreach (var line in File.ReadLines(cache)) { var i = line.IndexOf('\t'); if (i > 0 && uint.TryParse(line.Substring(0, i), System.Globalization.NumberStyles.HexNumber, null, out var h)) texIndex.TryAdd(h, line.Substring(i + 1)); }
            }
            if (texIndex == null)
            {
                var idx = new Dictionary<uint, string>();
                foreach (var e in GtaFiles.AllYtds())
                {
                    try
                    {
                        var y = GtaFiles.Get<YtdFile>(e);
                        foreach (var h in y?.TextureDict?.TextureNameHashes?.data_items ?? Array.Empty<uint>()) idx.TryAdd(h, e.Path);
                    }
                    catch { }
                }
                texIndex = idx;
                Directory.CreateDirectory(Path.GetDirectoryName(cache));
                File.WriteAllLines(cache, idx.Select(kv => kv.Key.ToString("X8") + "\t" + kv.Value));
            }
            int added = 0; var still = new JsonArray(); var ytdCache = new Dictionary<string, TextureDictionary>(StringComparer.OrdinalIgnoreCase);
            foreach (var n in names)
            {
                if (last.ContainsKey(n)) continue;
                if (!texIndex.TryGetValue(JenkHash.GenHash(n.ToLowerInvariant()), out var path)) { still.Add(n); continue; }
                if (!ytdCache.TryGetValue(path, out var td)) { td = (GtaFiles.Entry(path) is RpfFileEntry fe) ? GtaFiles.Get<YtdFile>(fe)?.TextureDict : null; ytdCache[path] = td; }
                var t = td?.Textures?.data_items?.FirstOrDefault(x => string.Equals(x.Name, n, StringComparison.OrdinalIgnoreCase));
                if (t == null) { still.Add(n); continue; }
                last[t.Name] = new Found { Tex = t, From = path.Split('\\', '/').Last() + " (GTA)" }; added++;
            }
            return new JsonObject { ["added"] = added, ["missing"] = still, ["textures"] = Describe(last.Where(kv => names.Contains(kv.Key, StringComparer.OrdinalIgnoreCase))) };
        }

        static JsonArray Describe(IEnumerable<KeyValuePair<string, Found>> items)
        {
            var texs = new JsonArray();
            foreach (var (tn, f) in items.OrderBy(k => k.Value.From).ThenBy(k => k.Key))
            {
                var t = f.Tex;
                var o = new JsonObject { ["name"] = tn, ["w"] = t.Width, ["h"] = t.Height, ["format"] = t.Format.ToString().Replace("D3DFMT_", ""), ["mips"] = t.Levels, ["from"] = f.From, ["bytes"] = t.Data?.FullData?.Length ?? 0 };
                try
                {
                    int mip = 0; while (mip < t.Levels - 1 && Math.Max(t.Width >> mip, t.Height >> mip) > 64) mip++;
                    var px = DDSIO.GetPixels(t, mip);
                    int w = Math.Max(1, t.Width >> mip), h = Math.Max(1, t.Height >> mip);
                    if (px != null && px.Length >= w * h * 4)
                    {
                        var rgba = new byte[w * h * 4];
                        for (int i = 0; i < w * h; i++) { rgba[i * 4] = px[i * 4 + 2]; rgba[i * 4 + 1] = px[i * 4 + 1]; rgba[i * 4 + 2] = px[i * 4]; rgba[i * 4 + 3] = px[i * 4 + 3]; }
                        o["thumb"] = Convert.ToBase64String(rgba); o["tw"] = w; o["th"] = h;
                    }
                }
                catch { }
                texs.Add(o);
            }
            return texs;
        }

        // ------------------------------------------------------------------ export (.dds, the textures of the last search)
        public static JsonNode Export(JsonObject req)
        {
            if (last.Count == 0) throw new Exception("Search a name first");
            var outDir = (string)req["outDir"];
            var only = (req["names"] as JsonArray)?.Select(x => (string)x).ToHashSet(StringComparer.OrdinalIgnoreCase);
            Directory.CreateDirectory(outDir);
            var files = new JsonArray(); var errors = new JsonArray();
            foreach (var (tn, f) in last)
            {
                if (only != null && !only.Contains(tn)) continue;
                try
                {
                    var dds = DDSIO.GetDDSFile(f.Tex);
                    var safe = string.Concat(tn.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
                    var p = Path.Combine(outDir, safe + ".dds");
                    File.WriteAllBytes(p, dds); files.Add(p);
                    // read back: a valid DDS header with the texture size
                    if (dds.Length < 128 || BitConverter.ToUInt32(dds, 0) != 0x20534444 || BitConverter.ToInt32(dds, 12) != f.Tex.Height || BitConverter.ToInt32(dds, 16) != f.Tex.Width)
                        throw new Exception("DDS check failed");
                }
                catch (Exception ex) { errors.Add($"{tn}: {ex.Message}"); }
            }
            return new JsonObject { ["name"] = lastName, ["files"] = files, ["errors"] = errors, ["outDir"] = outDir };
        }
    }
}

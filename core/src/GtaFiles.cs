// Read-only access to the user's own GTA V (Legacy) install: models and archetypes by name.
// Nothing is bundled and nothing in the GTA folder is ever written. The AES key comes from the user's GTA5.exe
// (CodeWalker's search) and is given back to the app so the next start is instant.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using CodeWalker.GameFiles;

namespace DoorCore
{
    public static class GtaFiles
    {
        static string loaded;
        static RpfManager man;
        static Dictionary<uint, RpfFileEntry> models;                 // model name hash -> .ydr / .yft / .ydd entry
        static Dictionary<uint, RpfFileEntry> ytds;                   // texture dictionary name hash -> .ytd entry
        static Dictionary<uint, uint> txdParents;                     // gtxd: child txd -> parent txd
        static readonly Dictionary<uint, Archetype> archObjs = new();
        static readonly Dictionary<uint, (CBaseArchetypeDef def, string ytyp)> archs = new();
        static readonly HashSet<string> scannedYtyps = new(StringComparer.OrdinalIgnoreCase);
        public static string Key;

        public static void Init(string gta, string key)
        {
            gta = (gta ?? "").Trim().TrimEnd('\\', '/');
            if (loaded != null && string.Equals(loaded, gta, StringComparison.OrdinalIgnoreCase)) return;
            if (!Directory.Exists(gta)) throw new Exception("GTA V folder not found: " + gta);
            if (!File.Exists(Path.Combine(gta, "x64a.rpf")) && !File.Exists(Path.Combine(gta, "common.rpf")))
                throw new Exception("This is not a GTA V Legacy folder (x64a.rpf / common.rpf missing): " + gta);
            if (string.IsNullOrEmpty(key))
            {
                var exe = new[] { "GTA5.exe", "gta5.exe" }.Select(e => Path.Combine(gta, e)).FirstOrDefault(File.Exists)
                          ?? throw new Exception("GTA5.exe not found in " + gta + " (FiveM needs GTA V Legacy)");
                GTA5Keys.GenerateV2(File.ReadAllBytes(exe), null);
                if (GTA5Keys.PC_AES_KEY == null) throw new Exception("Could not read the GTA key from GTA5.exe");
                key = Convert.ToBase64String(GTA5Keys.PC_AES_KEY);
            }
            GTA5Keys.LoadFromPath(gta, false, key);
            Key = key;

            var m = new RpfManager { ExcludePaths = new[] { "mods", "Mods", "MODS" } };   // the original game only (no OpenIV mods folder)
            m.Init(gta, false, _ => { }, e => Console.Error.WriteLine(e), false, true);
            RpfManager.IsGen9 = false;
            var dict = new Dictionary<uint, RpfFileEntry>();
            var tdict = new Dictionary<uint, RpfFileEntry>();
            foreach (var rpf in m.AllRpfs)
            {
                if (rpf.AllEntries == null) continue;
                bool patch = rpf.Path.StartsWith("update", StringComparison.OrdinalIgnoreCase);
                foreach (var e in rpf.AllEntries.OfType<RpfFileEntry>())
                {
                    var n = e.NameLower;
                    if (n.EndsWith(".ytd")) { var th = JenkHash.GenHash(Path.GetFileNameWithoutExtension(n)); if (patch || !tdict.ContainsKey(th)) tdict[th] = e; continue; }
                    if (!(n.EndsWith(".ydr") || n.EndsWith(".yft") || n.EndsWith(".ydd"))) continue;
                    var h = JenkHash.GenHash(Path.GetFileNameWithoutExtension(n));
                    if (patch || !dict.ContainsKey(h)) dict[h] = e;     // update.rpf / DLC patches win over the base game
                }
            }
            man = m; models = dict; ytds = tdict; txdParents = null; archs.Clear(); archObjs.Clear(); scannedYtyps.Clear();
            loaded = gta;
        }

        public static string Name(uint hash)
        {
            var s = JenkIndex.TryGetString(hash);
            return string.IsNullOrEmpty(s) ? "hash_" + hash.ToString("X8") : s;
        }

        public static RpfFileEntry Model(uint hash) => models != null && models.TryGetValue(hash, out var e) ? e : null;

        public static bool Ready => man != null;
        public static string Folder => loaded;
        public static RpfEntry Entry(string path) => man.GetEntry(path);
        public static IEnumerable<RpfFileEntry> AllYtds() => man.AllRpfs.Where(r => r.AllEntries != null).SelectMany(r => r.AllEntries.OfType<RpfFileEntry>()).Where(e => e.NameLower.EndsWith(".ytd"));
        public static RpfFileEntry Ytd(uint hash) => ytds != null && ytds.TryGetValue(hash, out var e) ? e : null;
        public static Archetype ArchetypeObj(uint hash) { Archetypes(new[] { hash }); return archObjs.TryGetValue(hash, out var a) ? a : null; }

        // texture dictionary parents (gtxd.meta / gtxd.ymt of the game and the DLCs)
        public static uint TxdParent(uint txd)
        {
            if (txdParents == null)
            {
                var d = new Dictionary<uint, uint>();
                foreach (var rpf in man.AllRpfs)
                {
                    if (rpf.AllEntries == null) continue;
                    foreach (var e in rpf.AllEntries.OfType<RpfFileEntry>())
                    {
                        if (e.NameLower != "gtxd.ymt" && e.NameLower != "gtxd.meta" && e.NameLower != "mph4_gtxd.ymt") continue;
                        try
                        {
                            var g = man.GetFile<GtxdFile>(e);
                            if (g?.TxdRelationships == null) continue;
                            foreach (var kv in g.TxdRelationships) d.TryAdd(JenkHash.GenHash(kv.Key.ToLowerInvariant()), JenkHash.GenHash(kv.Value.ToLowerInvariant()));
                        }
                        catch { }
                    }
                }
                txdParents = d;
            }
            return txdParents.TryGetValue(txd, out var p) ? p : 0;
        }

        public static T Get<T>(RpfFileEntry e) where T : class, PackedFile, new() => man.GetFile<T>(e);

        // archetype definitions, searched in the props ytyps first (fast), then everywhere else if still missing
        public static Dictionary<uint, (CBaseArchetypeDef def, string ytyp)> Archetypes(IEnumerable<uint> wanted)
        {
            var need = new HashSet<uint>(wanted.Where(h => !archs.ContainsKey(h)));
            if (need.Count > 0)
            {
                var ytyps = man.AllRpfs.Where(r => r.AllEntries != null).SelectMany(r => r.AllEntries.OfType<RpfFileEntry>())
                    .Where(e => e.NameLower.EndsWith(".ytyp") && !scannedYtyps.Contains(e.Path)).ToList();
                foreach (var pass in new[] { true, false })
                {
                    foreach (var e in ytyps.Where(x => x.Path.Contains("props", StringComparison.OrdinalIgnoreCase) == pass))
                    {
                        if (need.Count == 0) break;
                        if (!scannedYtyps.Add(e.Path)) continue;
                        YtypFile y;
                        try { y = man.GetFile<YtypFile>(e); } catch { continue; }
                        if (y?.AllArchetypes == null) continue;
                        foreach (var a in y.AllArchetypes)
                        {
                            var h = a._BaseArchetypeDef.name.Hash;
                            bool patch = e.Path.StartsWith("update", StringComparison.OrdinalIgnoreCase);
                            if (patch || !archs.ContainsKey(h)) { archs[h] = (a._BaseArchetypeDef, e.NameLower); archObjs[h] = a; }
                            need.Remove(h);
                        }
                    }
                    if (need.Count == 0) break;
                }
            }
            var res = new Dictionary<uint, (CBaseArchetypeDef, string)>();
            foreach (var h in wanted) if (archs.TryGetValue(h, out var a)) res[h] = a;
            return res;
        }
    }
}

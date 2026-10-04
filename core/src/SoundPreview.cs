using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using CodeWalker.GameFiles;

namespace DoorCore
{
    // Plays GTA door sounds in the app: reads them from the user's own GTA V install (nothing is bundled).
    // DoorAudioSettings -> Dat54SoundSet (opening / closing / push / closed / limit) -> SimpleSound -> x64/audio/sfx/<rpf>.rpf/<awc>
    public static class SoundPreview
    {
        static string loadedGta;
        static Dictionary<uint, Dat151DoorAudioSettings> settings;
        static Dictionary<uint, RelData> sounds;
        static readonly Dictionary<uint, (RpfFile rpf, RpfFileEntry entry)> containers = new();
        static readonly Dictionary<uint, AwcFile> awcCache = new();
        static readonly HashSet<string> scannedRpfs = new(StringComparer.OrdinalIgnoreCase);
        static readonly string[] Keys = { "opening", "closing", "push", "closed", "limit" };

        public static JsonNode Get(JsonObject req)
        {
            var gta = ((string)req["gta"] ?? "").Trim().TrimEnd('\\', '/');
            var id = Convert.ToUInt32(((string)req["sound"] ?? "").Trim(), 16);
            var key = (string)req["key"];
            Init(gta, key);

            if (!settings.TryGetValue(id, out var ds)) throw new Exception("Door sound not found in this GTA install: " + id.ToString("x8"));
            var set = Find(ds.Sounds.Hash) as Dat54SoundSet;
            if (set == null) throw new Exception("No sound set for this door sound");
            var arr = new JsonArray();
            foreach (var k in Keys)
            {
                var it = set.SoundSets.FirstOrDefault(x => x.ScriptName.Hash == JenkHash.GenHash(k));
                if (it == null) continue;
                var list = new List<Dat54SimpleSound>(); Collect(it.ChildSound.Hash, list, 0);
                foreach (var ss in list.Take(1))
                {
                    var wav = Wav(gta, ss);
                    if (wav != null) arr.Add(new JsonObject { ["name"] = k, ["wav"] = Convert.ToBase64String(wav) });
                }
            }
            if (arr.Count == 0) throw new Exception("No playable sample found for this door sound");
            return new JsonObject { ["id"] = id.ToString("x8"), ["sounds"] = arr, ["key"] = Convert.ToBase64String(GTA5Keys.PC_AES_KEY) };
        }

        static RelData Find(uint h) => sounds.TryGetValue(h, out var r) ? r : null;

        static void Collect(uint h, List<Dat54SimpleSound> outl, int depth)
        {
            if (depth > 12) return;
            var r = Find(h); if (r == null) return;
            if (r is Dat54SimpleSound ss) { outl.Add(ss); return; }
            foreach (var c in r.GetSoundHashes() ?? new MetaHash[0]) { Collect(c.Hash, outl, depth + 1); if (outl.Count > 0) return; }
        }

        static void Init(string gta, string key)
        {
            if (loadedGta != null && string.Equals(loadedGta, gta, StringComparison.OrdinalIgnoreCase)) return;
            var audio = Path.Combine(gta, "x64", "audio");
            if (!File.Exists(Path.Combine(audio, "audio_rel.rpf")))
                throw new Exception("GTA V folder not found (x64\\audio\\audio_rel.rpf missing): " + gta);
            if (string.IsNullOrEmpty(key))
            {
                var exe = new[] { "GTA5.exe", "gta5.exe", "GTA5_Enhanced.exe" }.Select(e => Path.Combine(gta, e)).FirstOrDefault(File.Exists);
                if (exe == null) throw new Exception("GTA5.exe not found in " + gta);
                GTA5Keys.GenerateV2(File.ReadAllBytes(exe), null);
                key = Convert.ToBase64String(GTA5Keys.PC_AES_KEY);
            }
            GTA5Keys.LoadFromPath(gta, false, key);

            var rel = new RpfFile(Path.Combine(audio, "audio_rel.rpf"), "audio_rel.rpf");
            rel.ScanStructure(_ => { }, e => Console.Error.WriteLine(e));
            RelFile LoadRel(string name)
            {
                var e = rel.AllEntries.OfType<RpfFileEntry>().FirstOrDefault(x => x.NameLower == name)
                        ?? throw new Exception(name + " not found in audio_rel.rpf");
                var r = new RelFile(); r.Load(rel.ExtractFile(e), e); return r;
            }
            var game = LoadRel("game.dat151.rel");
            var snd = LoadRel("sounds.dat54.rel");
            settings = new();
            foreach (var d in game.RelDatas.OfType<Dat151DoorAudioSettings>()) settings[d.NameHash.Hash] = d;
            sounds = new();
            foreach (var d in snd.RelDatas) sounds.TryAdd(d.NameHash.Hash, d);
            containers.Clear(); awcCache.Clear(); scannedRpfs.Clear();
            loadedGta = gta;
        }

        static void ScanRpf(string path)
        {
            if (!scannedRpfs.Add(path) || !File.Exists(path)) return;
            var rpf = new RpfFile(path, Path.GetFileName(path));
            rpf.ScanStructure(_ => { }, e => Console.Error.WriteLine(e));
            var folder = Path.GetFileNameWithoutExtension(path).ToLowerInvariant();
            foreach (var e in rpf.AllEntries.OfType<RpfFileEntry>().Where(x => x.NameLower.EndsWith(".awc")))
                containers.TryAdd(JenkHash.GenHash(folder + "/" + Path.GetFileNameWithoutExtension(e.NameLower)), (rpf, e));
        }

        static byte[] Wav(string gta, Dat54SimpleSound ss)
        {
            var sfx = Path.Combine(gta, "x64", "audio", "sfx");
            var ch = ss.ContainerName.Hash;
            if (!containers.ContainsKey(ch)) ScanRpf(Path.Combine(sfx, "RESIDENT.rpf"));
            if (!containers.ContainsKey(ch) && Directory.Exists(sfx))
                foreach (var f in Directory.GetFiles(sfx, "*.rpf")) { ScanRpf(f); if (containers.ContainsKey(ch)) break; }
            if (!containers.TryGetValue(ch, out var c)) return null;
            if (!awcCache.TryGetValue(ch, out var awc))
            {
                awc = new AwcFile(); awc.Load(c.rpf.ExtractFile(c.entry), c.entry); awcCache[ch] = awc;
            }
            AwcStream st = null;
            awc.StreamDict?.TryGetValue(ss.FileName.Hash & 0x1FFFFFFF, out st);
            st ??= awc.Streams?.FirstOrDefault(s => s.Hash.Hash == ss.FileName.Hash || s.HashAdjusted.Hash == (ss.FileName.Hash & 0x1FFFFFFF));
            return st?.GetWavFile();
        }
    }
}

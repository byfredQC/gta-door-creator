using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Xml;
using CodeWalker.GameFiles;

namespace DoorCore
{
    // Door sounds without script: a small game.dat151 that links door models to vanilla GTA DoorAudioSettings.
    // The game looks up "dasl_" + 8-hex(joaat(model)) for every door it spawns.
    public static class Audio
    {
        public static JsonNode Build(JsonObject req)
        {
            var outPath = (string)req["out"];
            var links = req["links"] as JsonArray ?? new JsonArray();
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Dat151>\n <Version value=\"7126027\" />\n <Items>\n");
            int n = 0;
            foreach (var l in links.OfType<JsonObject>())
            {
                var model = ((string)l["model"] ?? "").Trim().ToLowerInvariant();
                var settings = ((string)l["settings"] ?? "").Trim().ToLowerInvariant();
                if (model.Length == 0 || settings.Length != 8) continue;
                uint mh = JenkHash.GenHash(model);
                sb.Append($"  <Item type=\"DoorAudioSettingsLink\">\n   <Name>dasl_{mh:x8}</Name>\n   <Door>hash_{settings.ToUpperInvariant()}</Door>\n  </Item>\n");
                n++;
            }
            sb.Append(" </Items>\n</Dat151>\n");
            if (n == 0) throw new Exception("No door sound to write");
            var doc = new XmlDocument(); doc.LoadXml(sb.ToString());
            var data = XmlMeta.GetData(doc, MetaFormat.AudioRel, "");
            if (data == null) throw new Exception("Audio data build failed");
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath)));
            File.WriteAllBytes(outPath, data);

            // read back to verify
            var rel = new RelFile();
            var entry = new RpfBinaryFileEntry { Name = Path.GetFileName(outPath) };
            rel.Load(data, entry);
            var check = new JsonArray();
            foreach (var it in rel.RelDatas.OfType<Dat151DoorAudioSettingsLink>())
                check.Add(new JsonObject { ["name"] = it.NameHash.Hash.ToString("x8"), ["door"] = it.Door.Hash.ToString("x8") });
            return new JsonObject { ["file"] = outPath, ["bytes"] = data.Length, ["links"] = check };
        }
    }
}

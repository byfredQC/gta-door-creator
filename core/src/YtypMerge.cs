// "Use my own .ytyp": our archetype is added to (or replaces the same-named archetype in) the user's existing ytyp,
// e.g. the ytyp of an MLO. The user's other archetypes / MLO data are kept as they are (CodeWalker XML round trip).
using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Xml;
using CodeWalker.GameFiles;

namespace DoorCore
{
    public static class YtypMerge
    {
        // returns the ytyp bytes and the ytyp name (file name without extension) to write
        public static (byte[] data, string name) Build(string ourXml, string ourName, JsonObject y, JsonArray warnings)
        {
            var into = (string)y["mergeInto"];
            if (string.IsNullOrWhiteSpace(into))
            {
                var d0 = new XmlDocument(); d0.LoadXml(ourXml);
                return (XmlMeta.GetData(d0, MetaFormat.RSC, "") ?? throw new Exception("YTYP build failed"), ourName);
            }
            if (!File.Exists(into)) throw new Exception("Your .ytyp was not found: " + into);
            try { var bak = into + ".bak"; if (!File.Exists(bak)) File.Copy(into, bak); } catch { }   // keep the original once
            var user = new YtypFile();
            Util.LoadResource(user, into);
            var userXml = MetaXml.GetXml(user, out _);
            if (string.IsNullOrEmpty(userXml)) throw new Exception("Could not read " + Path.GetFileName(into));

            var udoc = new XmlDocument(); udoc.LoadXml(userXml);
            var odoc = new XmlDocument(); odoc.LoadXml(ourXml);
            var uArch = udoc.DocumentElement.SelectSingleNode("archetypes") as XmlElement;
            if (uArch == null) { uArch = udoc.CreateElement("archetypes"); udoc.DocumentElement.AppendChild(uArch); }
            int replaced = 0, added = 0;
            foreach (XmlElement item in odoc.DocumentElement.SelectNodes("archetypes/Item"))
            {
                var nm = item.SelectSingleNode("name")?.InnerText?.Trim().ToLowerInvariant();
                uint h = JenkHash.GenHash(nm ?? "");
                foreach (XmlElement old in uArch.SelectNodes("Item").Cast<XmlElement>().ToList())
                {
                    var on = old.SelectSingleNode("name")?.InnerText?.Trim().ToLowerInvariant() ?? "";
                    if (on == nm || on == $"hash_{h:x8}") { uArch.RemoveChild(old); replaced++; }
                }
                uArch.AppendChild(udoc.ImportNode(item, true)); added++;
            }
            var data = XmlMeta.GetData(udoc, MetaFormat.RSC, "") ?? throw new Exception("Could not rebuild " + Path.GetFileName(into));
            // check: every archetype of the user file is still there + ours
            var check = new YtypFile(); check.Load(data);
            int before = user.AllArchetypes?.Length ?? 0, after = check.AllArchetypes?.Length ?? 0;
            if (after != before - replaced + added) warnings.Add($"Check {Path.GetFileName(into)}: {before} archetypes before, {after} after.");
            if ((user.AllArchetypes?.Any(a => a is MloArchetype) ?? false) && !(check.AllArchetypes?.Any(a => a is MloArchetype) ?? false))
                throw new Exception("The MLO in " + Path.GetFileName(into) + " could not be kept - not merged.");
            warnings.Add(replaced > 0 ? $"Archetype replaced in your {Path.GetFileName(into)} ({after} archetypes)." : $"Archetype added to your {Path.GetFileName(into)} ({after} archetypes).");
            var name = Path.GetFileNameWithoutExtension(into);
            return (data, name);
        }
    }
}

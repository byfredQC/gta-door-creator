// Tree LODs for a ymap of vanilla trees (prop_tree_*): trees seen from far away, like GTA forests.
//
//   <ymap>.ymap        your trees = HD, parentIndex -> their LOD, flag 8 "LOD in Parented YMAP", parent = <ymap>_lod
//   <ymap>_lod.ymap    one LOD entity per tree (same place / rotation / scale), lodLevel LOD, childLodDist = HD distance
//   gdclod_<tree>.ydr  the tree's own lowest model level (VeryLow / Low / Medium) as a light drawable, no collision
//   <ymap>_lod.ytyp    the LOD archetypes, texture dictionary = the vanilla one of the tree (nothing to copy)
//
// Chain measured on vanilla (prologue01): HD flags 1572872 + parentIndex, LOD flags 1572864, parent.childLodDist == child.lodDist.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Xml;
using CodeWalker.GameFiles;
using SharpDX;

namespace DoorCore
{
    public static class TreeLod
    {
        const uint FlagLodInParent = 8, FlagAdoptMe = 16;
        const uint LodEntityFlags = 1572864;     // Cast Static Shadows + Cast Dynamic Shadows (vanilla LOD entity)
        static readonly string[] TreeWords = { "tree", "palm", "pine", "cedar", "birch", "oak", "cypress", "fir_", "willow", "joshua", "eucalyp", "maple", "redwood", "_veg_tree" };
        static string F(float f) => f.ToString("R", CultureInfo.InvariantCulture);
        static float Fl(string s) => float.Parse(s, CultureInfo.InvariantCulture);

        // ------------------------------------------------------------------ ymap I/O (CodeWalker XML)
        static XmlDocument LoadYmapXml(string path)
        {
            var doc = new XmlDocument();
            if (path.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)) { doc.Load(path); return doc; }
            var y = new YmapFile(); RpfFile.LoadResourceFile(y, File.ReadAllBytes(path), 2);
            if (y.CMapData.name.Hash == 0 && (y.AllEntities == null)) throw new Exception("Could not read the ymap " + Path.GetFileName(path));
            doc.LoadXml(MetaXml.GetXml(y, out _));
            return doc;
        }
        static uint HashOf(string s)
        {
            s = (s ?? "").Trim();
            if (s.StartsWith("hash_", StringComparison.OrdinalIgnoreCase) && uint.TryParse(s.Substring(5), NumberStyles.HexNumber, null, out var h)) return h;
            return JenkHash.GenHash(s.ToLowerInvariant());
        }
        static string Txt(XmlElement e, string n) => (e.SelectSingleNode(n) as XmlElement)?.InnerText ?? "";
        static string Val(XmlElement e, string n) => (e.SelectSingleNode(n) as XmlElement)?.GetAttribute("value") ?? "0";
        static void SetVal(XmlElement e, string n, string v) { if (e.SelectSingleNode(n) is XmlElement x) x.SetAttribute("value", v); }
        static Vector3 V3(XmlElement e, string n) { var x = e.SelectSingleNode(n) as XmlElement; return x == null ? Vector3.Zero : new Vector3(Fl(x.GetAttribute("x")), Fl(x.GetAttribute("y")), Fl(x.GetAttribute("z"))); }
        static void SetV3(XmlElement e, string n, Vector3 v) { if (e.SelectSingleNode(n) is XmlElement x) { x.SetAttribute("x", F(v.X)); x.SetAttribute("y", F(v.Y)); x.SetAttribute("z", F(v.Z)); } }

        class Ent { public XmlElement El; public uint Hash; public Vector3 Pos; public float ScaleXY, ScaleZ, LodDist; public uint Flags; public int ParentIndex; }
        static List<Ent> Entities(XmlDocument doc) =>
            doc.SelectNodes("/CMapData/entities/Item").Cast<XmlElement>().Select(e => new Ent
            {
                El = e, Hash = HashOf(Txt(e, "archetypeName")), Pos = V3(e, "position"),
                ScaleXY = Fl(Val(e, "scaleXY")), ScaleZ = Fl(Val(e, "scaleZ")), LodDist = Fl(Val(e, "lodDist")),
                Flags = uint.Parse(Val(e, "flags")), ParentIndex = int.Parse(Val(e, "parentIndex")),
            }).ToList();

        // ------------------------------------------------------------------ models
        static readonly string[] Levels = { "High", "Med", "Low", "VLow" };
        static DrawableModel[][] ModelLevels(DrawableBase d)
        {
            var m = d.DrawableModels;
            return new[] { m?.High, m?.Med, m?.Low, m?.VLow };
        }
        static int Tris(DrawableModel[] ms) => ms == null ? 0 : (int)ms.Sum(x => x.Geometries?.Sum(g => g.IndicesCount / 3) ?? 0);

        class TreeInfo
        {
            public uint Hash; public string Name; public int Count; public string Kind; public bool Tree; public float ArchLod = 100;
            public string Txd; public int[] TrisPerLevel = new int[4]; public int LodLevel = -1; public CBaseArchetypeDef? Def;
            public string Problem;
        }

        static List<TreeInfo> Analyse(List<Ent> ents)
        {
            var groups = ents.GroupBy(e => e.Hash).ToList();
            var archs = GtaFiles.Archetypes(groups.Select(g => g.Key));
            var list = new List<TreeInfo>();
            foreach (var g in groups)
            {
                var ti = new TreeInfo { Hash = g.Key, Name = GtaFiles.Name(g.Key), Count = g.Count() };
                var ln = ti.Name.ToLowerInvariant();
                ti.Tree = TreeWords.Any(w => ln.Contains(w)) && !ln.Contains("_lod");
                if (archs.TryGetValue(g.Key, out var a))
                {
                    ti.Def = a.def; ti.ArchLod = a.def.lodDist; ti.Txd = a.def.textureDictionary.Hash == 0 ? null : GtaFiles.Name(a.def.textureDictionary.Hash);
                }
                var e = GtaFiles.Model(g.Key);
                if (e == null) { ti.Problem = ti.Name.StartsWith("hash_") ? "unknown model (custom prop?)" : "model not found in GTA"; list.Add(ti); continue; }
                ti.Kind = Path.GetExtension(e.NameLower).TrimStart('.');
                if (ti.Kind != "ydr") { ti.Problem = ti.Kind == "yft" ? "fragment (.yft) - not supported" : "drawable dictionary (.ydd) - not supported"; list.Add(ti); continue; }
                if (ti.Def == null) { ti.Problem = "archetype not found in the GTA ytyps"; list.Add(ti); continue; }
                try
                {
                    var ydr = GtaFiles.Get<YdrFile>(e);
                    var lv = ModelLevels(ydr.Drawable);
                    for (int i = 0; i < 4; i++) ti.TrisPerLevel[i] = Tris(lv[i]);
                    for (int i = 3; i >= 0; i--) if (ti.TrisPerLevel[i] > 0) { ti.LodLevel = i; break; }
                    if (ti.LodLevel < 0) ti.Problem = "model has no geometry";
                }
                catch (Exception ex) { ti.Problem = "could not read the model: " + ex.Message; }
                list.Add(ti);
            }
            return list.OrderByDescending(t => t.Tree).ThenByDescending(t => t.Count).ToList();
        }

        // ------------------------------------------------------------------ scan (what is in the ymap)
        public static JsonNode Scan(JsonObject req)
        {
            GtaFiles.Init((string)req["gta"], (string)req["key"]);
            var path = (string)req["ymap"];
            var doc = LoadYmapXml(path);
            var ents = Entities(doc);
            if (ents.Count == 0) throw new Exception("This ymap has no entities");
            var infos = Analyse(ents);
            var idx = infos.Select((t, i) => (t.Hash, i)).ToDictionary(x => x.Hash, x => x.i);
            var arr = new JsonArray();
            foreach (var t in infos)
                arr.Add(new JsonObject
                {
                    ["hash"] = t.Hash.ToString("X8"), ["name"] = t.Name, ["count"] = t.Count, ["kind"] = t.Kind, ["tree"] = t.Tree,
                    ["archLodDist"] = Util.R(t.ArchLod), ["txd"] = t.Txd, ["tris"] = new JsonArray(t.TrisPerLevel.Select(x => (JsonNode)x).ToArray()),
                    ["lodLevel"] = t.LodLevel < 0 ? null : Levels[t.LodLevel], ["lodTris"] = t.LodLevel < 0 ? 0 : t.TrisPerLevel[t.LodLevel],
                    ["ok"] = t.Problem == null, ["problem"] = t.Problem,
                });
            // positions for the app's map: x, y, group index
            var pts = new List<float>();
            foreach (var e in ents.Take(50000)) { pts.Add(e.Pos.X); pts.Add(e.Pos.Y); pts.Add(idx[e.Hash]); }
            var root = doc.DocumentElement;
            int brokenFlag = ents.Count(e => (e.Flags & FlagLodInParent) != 0 && e.ParentIndex < 0);
            return new JsonObject
            {
                ["key"] = GtaFiles.Key, ["ymapName"] = Txt(root, "name"), ["parent"] = Txt(root, "parent"), ["entities"] = ents.Count,
                ["alreadyChained"] = ents.Count(e => e.ParentIndex >= 0), ["brokenLodFlag"] = brokenFlag,
                ["groups"] = arr, ["points"] = Util.B64(pts.ToArray()),
            };
        }

        // ------------------------------------------------------------------ build
        public static JsonNode Build(JsonObject req)
        {
            GtaFiles.Init((string)req["gta"], (string)req["key"]);
            var path = (string)req["ymap"];
            var outDir = (string)req["outDir"];
            var sel = new HashSet<uint>((req["select"] as JsonArray ?? new JsonArray()).Select(x => uint.Parse((string)x, NumberStyles.HexNumber)));
            float hdDist = (float?)req["hdDist"] ?? 0f;                  // 0 = keep each tree's own distance
            float lodDist = Math.Max(200f, Math.Min(5000f, (float?)req["lodDist"] ?? 1500f));
            var warnings = new JsonArray(); var files = new JsonArray();

            var doc = LoadYmapXml(path);
            var root = doc.DocumentElement;
            var ents = Entities(doc);
            if (ents.Any(e => e.ParentIndex >= 0 && sel.Contains(e.Hash)))
                throw new Exception("Some of these trees already have a LOD parent - use the original ymap (without LOD), not a ymap made by this tool.");
            var infos = Analyse(ents).ToDictionary(t => t.Hash);
            var use = sel.Where(h => infos.TryGetValue(h, out var t) && t.Problem == null).ToHashSet();
            foreach (var h in sel.Except(use)) warnings.Add($"{(infos.TryGetValue(h, out var t) ? t.Name + ": " + t.Problem : h.ToString("X8") + ": not in this ymap")} - kept without LOD");
            if (use.Count == 0) throw new Exception("No tree to make a LOD for (none selected or none supported).");

            var hdName = Exporter.San(Txt(root, "name"));
            if (string.IsNullOrEmpty(hdName)) hdName = Exporter.San(Path.GetFileNameWithoutExtension(path).Replace(".ymap", ""));
            var lodName = hdName + "_lod";
            var ytypName = hdName + "_lod";
            if (!string.IsNullOrEmpty(Txt(root, "parent"))) warnings.Add($"{hdName}.ymap had the parent \"{Txt(root, "parent")}\" - replaced by {lodName}");
            Directory.CreateDirectory(outDir);

            // ---- 1. one LOD drawable per tree type
            var lodArch = new Dictionary<uint, (string name, CBaseArchetypeDef def, string txd, float radius)>();
            var texDir = Path.Combine(Path.GetTempPath(), "gdc_lod_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(texDir);
            var info = new JsonArray();
            try
            {
                foreach (var h in use)
                {
                    var t = infos[h];
                    var nm = Exporter.San("gdclod_" + t.Name);
                    if (nm.Length > 60) nm = nm.Substring(0, 60);
                    var ydr = GtaFiles.Get<YdrFile>(GtaFiles.Model(h));
                    var bytes = LodDrawable(ydr, nm, t.LodLevel, texDir);
                    var p = Path.Combine(outDir, nm + ".ydr");
                    File.WriteAllBytes(p, bytes); files.Add(p);
                    var chk = new YdrFile(); RpfFile.LoadResourceFile(chk, bytes, 165);
                    if (Tris(chk.Drawable?.DrawableModels?.High) != t.TrisPerLevel[t.LodLevel]) throw new Exception("LOD model check failed: " + nm);
                    if (t.LodLevel == 0) warnings.Add($"{t.Name}: the model has no lower detail level - its LOD uses the full model (still visible far away, but heavier)");
                    lodArch[h] = (nm, t.Def.Value, t.Txd, t.Def.Value.bsRadius);
                    info.Add(new JsonObject { ["tree"] = t.Name, ["lod"] = nm, ["count"] = t.Count, ["from"] = Levels[t.LodLevel], ["tris"] = t.TrisPerLevel[t.LodLevel], ["hdTris"] = t.TrisPerLevel[0] });
                }
            }
            finally { try { Directory.Delete(texDir, true); } catch { } }

            // ---- 2. the LOD ytyp
            var ysb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapTypes>\n <extensions />\n <archetypes>\n");
            foreach (var (h, a) in lodArch)
            {
                var d = a.def;
                ysb.Append("  <Item type=\"CBaseArchetypeDef\">\n");
                ysb.Append($"   <lodDist value=\"{F(lodDist)}\" />\n   <flags value=\"{d.flags}\" />\n   <specialAttribute value=\"0\" />\n");
                ysb.Append("   " + Animated.V("bbMin", d.bbMin) + "\n   " + Animated.V("bbMax", d.bbMax) + "\n   " + Animated.V("bsCentre", d.bsCentre) + "\n");
                ysb.Append($"   <bsRadius value=\"{F(d.bsRadius)}\" />\n   <hdTextureDist value=\"{F(Math.Max(d.hdTextureDist, 5f))}\" />\n");
                ysb.Append($"   <name>{a.name}</name>\n   " + (a.txd == null ? "<textureDictionary />" : $"<textureDictionary>{a.txd}</textureDictionary>") + "\n");
                ysb.Append("   <clipDictionary />\n   <drawableDictionary />\n   <physicsDictionary />\n   <assetType>ASSET_TYPE_DRAWABLE</assetType>\n");
                ysb.Append($"   <assetName>{a.name}</assetName>\n   <extensions />\n  </Item>\n");
            }
            ysb.Append($" </archetypes>\n <name>{ytypName}</name>\n <dependencies />\n <compositeEntityTypes />\n</CMapTypes>\n");
            var ydoc = new XmlDocument(); ydoc.LoadXml(ysb.ToString());
            var ytypBytes = XmlMeta.GetData(ydoc, MetaFormat.RSC, "");
            var ytypPath = Path.Combine(outDir, ytypName + ".ytyp");
            File.WriteAllBytes(ytypPath, ytypBytes); files.Add(ytypPath);

            // ---- 3. the two ymaps
            var lodItems = new StringBuilder();
            int lodIndex = 0, fixedFlags = 0, linked = 0;
            var lodExt = new Ext(); var hdExt = new Ext();
            var radius = new Dictionary<uint, float>();
            foreach (var (h, a) in GtaFiles.Archetypes(ents.Select(e => e.Hash).Distinct())) radius[h] = a.def.bsRadius;
            foreach (var e in ents)
            {
                float r = (radius.TryGetValue(e.Hash, out var rr) ? rr : 5f) * Math.Max(e.ScaleXY, e.ScaleZ);
                if (!use.Contains(e.Hash))
                {
                    if ((e.Flags & FlagLodInParent) != 0 && e.ParentIndex < 0) { e.Flags &= ~FlagLodInParent; SetVal(e.El, "flags", e.Flags.ToString()); fixedFlags++; }
                    float ld = e.LodDist > 0 ? e.LodDist : (infos.TryGetValue(e.Hash, out var ti0) ? ti0.ArchLod : 150f);
                    hdExt.Add(e.Pos, r, ld);
                    continue;
                }
                var t = infos[e.Hash];
                float hd = hdDist > 0 ? hdDist : (e.LodDist > 0 ? e.LodDist : t.ArchLod);
                hd = Math.Max(20f, Math.Min(hd, lodDist - 25f));
                e.Flags = (e.Flags | FlagLodInParent) & ~FlagAdoptMe;
                SetVal(e.El, "flags", e.Flags.ToString());
                SetVal(e.El, "parentIndex", lodIndex.ToString());
                SetVal(e.El, "lodDist", F(hd));
                (e.El.SelectSingleNode("lodLevel") as XmlElement).InnerText = "LODTYPES_DEPTH_HD";
                hdExt.Add(e.Pos, r, hd);

                var rot = e.El.SelectSingleNode("rotation") as XmlElement;
                uint guid = JenkHash.GenHash(lodName + "_" + lodIndex);
                lodItems.Append("  <Item type=\"CEntityDef\">");
                lodItems.Append($"<archetypeName>{lodArch[e.Hash].name}</archetypeName><flags value=\"{LodEntityFlags}\" /><guid value=\"{guid}\" />");
                lodItems.Append(Animated.V("position", e.Pos));
                lodItems.Append($"<rotation x=\"{rot.GetAttribute("x")}\" y=\"{rot.GetAttribute("y")}\" z=\"{rot.GetAttribute("z")}\" w=\"{rot.GetAttribute("w")}\" />");
                lodItems.Append($"<scaleXY value=\"{F(e.ScaleXY)}\" /><scaleZ value=\"{F(e.ScaleZ)}\" /><parentIndex value=\"-1\" />");
                lodItems.Append($"<lodDist value=\"{F(lodDist)}\" /><childLodDist value=\"{F(hd)}\" /><lodLevel>LODTYPES_DEPTH_LOD</lodLevel><numChildren value=\"1\" />");
                lodItems.Append("<priorityLevel>PRI_REQUIRED</priorityLevel><extensions /><ambientOcclusionMultiplier value=\"255\" /><artificialAmbientOcclusion value=\"255\" /><tintValue value=\"0\" /></Item>\n");
                lodExt.Add(e.Pos, r, lodDist);
                lodIndex++; linked++;
            }
            // HD ymap: parent + extents (contentFlags HD)
            (root.SelectSingleNode("parent") as XmlElement).InnerText = lodName;
            SetVal(root, "contentFlags", (uint.Parse(Val(root, "contentFlags")) | 1).ToString());
            hdExt.Write(root);
            var hdBytes = XmlMeta.GetData(doc, MetaFormat.RSC, "");
            var hdPath = Path.Combine(outDir, hdName + ".ymap");
            File.WriteAllBytes(hdPath, hdBytes); files.Add(hdPath);

            var lsb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapData>\n");
            lsb.Append($" <name>{lodName}</name>\n <parent />\n <flags value=\"2\" />\n <contentFlags value=\"2\" />\n");
            lsb.Append(" <streamingExtentsMin x=\"0\" y=\"0\" z=\"0\" />\n <streamingExtentsMax x=\"0\" y=\"0\" z=\"0\" />\n <entitiesExtentsMin x=\"0\" y=\"0\" z=\"0\" />\n <entitiesExtentsMax x=\"0\" y=\"0\" z=\"0\" />\n");
            lsb.Append(" <entities>\n").Append(lodItems).Append(" </entities>\n");
            lsb.Append(" <containerLods />\n <boxOccluders />\n <occludeModels />\n <physicsDictionaries />\n <instancedData><ImapLink /><PropInstanceList /><GrassInstanceList /></instancedData>\n <timeCycleModifiers />\n <carGenerators />\n");
            lsb.Append(" <LODLightsSOA><direction /><falloff /><falloffExponent /><timeAndStateFlags /><hash /><coneInnerAngle /><coneOuterAngleOrCapExt /><coronaIntensity /></LODLightsSOA>\n");
            lsb.Append(" <DistantLODLightsSOA><position /><RGBI /><numStreetLights value=\"0\" /><category value=\"0\" /></DistantLODLightsSOA>\n");
            lsb.Append($" <block><version value=\"0\" /><flags value=\"0\" /><name>{lodName}</name><exportedBy>GTA Door Creator</exportedBy><owner /><time /></block>\n</CMapData>\n");
            var ldoc = new XmlDocument(); ldoc.LoadXml(lsb.ToString());
            lodExt.Write(ldoc.DocumentElement);
            var lodBytes = XmlMeta.GetData(ldoc, MetaFormat.RSC, "");
            var lodPath = Path.Combine(outDir, lodName + ".ymap");
            File.WriteAllBytes(lodPath, lodBytes); files.Add(lodPath);

            Verify(hdBytes, lodBytes, ytypBytes, hdName, lodName, linked, lodArch.Values.Select(a => a.name).ToList());
            if (fixedFlags > 0) warnings.Add($"{fixedFlags} other entities had the flag \"LOD in Parented YMAP\" without a parent (they could vanish) - flag removed");
            return new JsonObject
            {
                ["files"] = files, ["warnings"] = warnings, ["hdYmap"] = hdName + ".ymap", ["lodYmap"] = lodName + ".ymap", ["ytyp"] = ytypName + ".ytyp",
                ["linked"] = linked, ["lodDist"] = lodDist, ["models"] = info, ["fixedFlags"] = fixedFlags,
            };
        }

        class Ext
        {
            Vector3 eMin = new Vector3(float.MaxValue), eMax = new Vector3(float.MinValue), sMin = new Vector3(float.MaxValue), sMax = new Vector3(float.MinValue);
            public void Add(Vector3 p, float r, float lod)
            {
                eMin = Vector3.Min(eMin, p - new Vector3(r)); eMax = Vector3.Max(eMax, p + new Vector3(r));
                sMin = Vector3.Min(sMin, p - new Vector3(r + lod)); sMax = Vector3.Max(sMax, p + new Vector3(r + lod));
            }
            public void Write(XmlElement root)
            {
                if (eMin.X > eMax.X) return;
                SetV3(root, "entitiesExtentsMin", eMin); SetV3(root, "entitiesExtentsMax", eMax);
                SetV3(root, "streamingExtentsMin", sMin); SetV3(root, "streamingExtentsMax", sMax);
            }
        }

        // the tree's lowest detail level becomes the only (High) level of a new drawable, without collision
        static byte[] LodDrawable(YdrFile ydr, string name, int level, string texDir)
        {
            var doc = new XmlDocument(); doc.LoadXml(YdrXml.GetXml(ydr, texDir));
            var dr = doc.DocumentElement;
            string[] tags = { "DrawableModelsHigh", "DrawableModelsMedium", "DrawableModelsLow", "DrawableModelsVeryLow" };
            var keep = dr.SelectSingleNode(tags[level]) as XmlElement ?? throw new Exception("LOD level missing in " + name);
            var fl = new[] { "FlagsHigh", "FlagsMed", "FlagsLow", "FlagsVlow" };
            var keepFlags = Val(dr, fl[level]);
            for (int i = 0; i < 4; i++) if (i != level) foreach (XmlNode x in dr.SelectNodes(tags[i]).Cast<XmlNode>().ToList()) dr.RemoveChild(x);
            if (level != 0)
            {
                var hi = doc.CreateElement(tags[0]);
                foreach (XmlNode c in keep.ChildNodes.Cast<XmlNode>().ToList()) hi.AppendChild(c);
                foreach (XmlAttribute at in keep.Attributes) hi.SetAttribute(at.Name, at.Value);
                dr.ReplaceChild(hi, keep);
            }
            foreach (XmlNode x in dr.SelectNodes("Bounds").Cast<XmlNode>().ToList()) dr.RemoveChild(x);
            (dr.SelectSingleNode("Name") as XmlElement).InnerText = name;
            SetVal(dr, "FlagsHigh", keepFlags); SetVal(dr, "FlagsMed", "0"); SetVal(dr, "FlagsLow", "0"); SetVal(dr, "FlagsVlow", "0");
            SetVal(dr, "LodDistHigh", "9998"); SetVal(dr, "LodDistMed", "9998"); SetVal(dr, "LodDistLow", "9998"); SetVal(dr, "LodDistVlow", "9998");
            return XmlMeta.GetYdrData(doc, texDir) ?? throw new Exception("LOD model build failed: " + name);
        }

        static void Verify(byte[] hd, byte[] lod, byte[] ytyp, string hdName, string lodName, int linked, List<string> lodModels)
        {
            var h = new YmapFile(); RpfFile.LoadResourceFile(h, hd, 2);
            var l = new YmapFile(); RpfFile.LoadResourceFile(l, lod, 2);
            if (h.CMapData.parent.Hash != JenkHash.GenHash(lodName)) throw new Exception("Check failed: HD ymap parent");
            if (l.CMapData.name.Hash != JenkHash.GenHash(lodName)) throw new Exception("Check failed: LOD ymap name");
            var le = l.AllEntities ?? throw new Exception("Check failed: LOD ymap has no entity");
            if (le.Length != linked) throw new Exception("Check failed: LOD entity count");
            var used = new int[le.Length];
            foreach (var e in h.AllEntities)
            {
                var d = e._CEntityDef;
                if (d.parentIndex < 0) { if ((d.flags & FlagLodInParent) != 0) throw new Exception("Check failed: LOD flag without parent"); continue; }
                if (d.parentIndex >= le.Length) throw new Exception("Check failed: parent index out of range");
                var p = le[d.parentIndex]._CEntityDef;
                if ((d.flags & FlagLodInParent) == 0 || d.lodLevel != rage__eLodType.LODTYPES_DEPTH_HD) throw new Exception("Check failed: HD entity flags / level");
                if ((p.position - d.position).Length() > 0.01f || Math.Abs(p.childLodDist - d.lodDist) > 0.01f) throw new Exception("Check failed: LOD entity does not match its tree");
                used[d.parentIndex]++;
            }
            if (used.Any(u => u != 1)) throw new Exception("Check failed: every LOD must have exactly one tree");
            var y = new YtypFile(); RpfFile.LoadResourceFile(y, ytyp, 2);
            var names = new HashSet<uint>(y.AllArchetypes.Select(a => a._BaseArchetypeDef.name.Hash));
            if (lodModels.Any(n => !names.Contains(JenkHash.GenHash(n)))) throw new Exception("Check failed: LOD archetypes");
            if (le.Any(e => !names.Contains(e._CEntityDef.archetypeName.Hash))) throw new Exception("Check failed: LOD entity archetype");
        }
    }
}

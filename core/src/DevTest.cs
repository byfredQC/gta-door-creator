// Developer helpers (CLI only): dump a ymap/ytyp as CodeWalker XML, build small test files.
using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using CodeWalker.GameFiles;
using SharpDX;

namespace DoorCore
{
    public static class DevTest
    {
        public static JsonNode Run(JsonObject req)
        {
            var what = (string)req["what"];
            if (what == "xml")
            {
                var p = (string)req["path"]; var data = File.ReadAllBytes(p);
                if (p.EndsWith(".ymap")) { var y = new YmapFile(); RpfFile.LoadResourceFile(y, data, 2); return new JsonObject { ["xml"] = MetaXml.GetXml(y, out _) }; }
                if (p.EndsWith(".ytyp")) { var y = new YtypFile(); RpfFile.LoadResourceFile(y, data, 2); return new JsonObject { ["xml"] = MetaXml.GetXml(y, out _) }; }
                throw new Exception("xml: .ymap or .ytyp");
            }
            if (what == "fromxml")
            {
                var doc = new System.Xml.XmlDocument(); doc.Load((string)req["path"]);
                var data = XmlMeta.GetData(doc, MetaFormat.RSC, "");
                File.WriteAllBytes((string)req["out"], data); return new JsonObject { ["bytes"] = data.Length };
            }
            if (what == "mkgta")
            {
                // a tiny fake GTA folder (OPEN rpfs) with tree props, to test the LOD tool without the real 90 GB game
                var gta = (string)req["gta"]; Directory.CreateDirectory(gta);
                var srcDoc = new System.Xml.XmlDocument();
                var tex = Path.Combine(Path.GetTempPath(), "gdc_mk"); Directory.CreateDirectory(tex);
                srcDoc.LoadXml(YdrXml.GetXml(Loader.ReadYdr((string)req["ydr"]), tex));
                byte[] Ydr(string name, int levels)
                {
                    var d = (System.Xml.XmlDocument)srcDoc.CloneNode(true); var dr = d.DocumentElement;
                    (dr.SelectSingleNode("Name") as System.Xml.XmlElement).InnerText = name;
                    var hi = dr.SelectSingleNode("DrawableModelsHigh");
                    foreach (var t in new[] { "DrawableModelsMedium", "DrawableModelsLow" }.Take(levels - 1))
                    {
                        var c = d.CreateElement(t); foreach (System.Xml.XmlNode n in hi.ChildNodes) c.AppendChild(n.CloneNode(true));
                        // lower levels keep only the first geometry
                        foreach (System.Xml.XmlElement g in c.SelectNodes("Item/Geometries").Cast<System.Xml.XmlElement>().ToList()) while (g.ChildNodes.Count > 1) g.RemoveChild(g.LastChild);
                        dr.InsertAfter(c, dr.SelectSingleNode(t == "DrawableModelsMedium" ? "DrawableModelsHigh" : "DrawableModelsMedium") ?? hi);
                    }
                    return XmlMeta.GetYdrData(d, tex);
                }
                string Ytyp(string ytyp, params (string name, string txd)[] a)
                {
                    var sb = new System.Text.StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?><CMapTypes><extensions /><archetypes>");
                    foreach (var (n, t) in a) sb.Append($"<Item type=\"CBaseArchetypeDef\"><lodDist value=\"180\" /><flags value=\"32\" /><specialAttribute value=\"0\" /><bbMin x=\"-2\" y=\"-2\" z=\"0\" /><bbMax x=\"2\" y=\"2\" z=\"8\" /><bsCentre x=\"0\" y=\"0\" z=\"4\" /><bsRadius value=\"5\" /><hdTextureDist value=\"30\" /><name>{n}</name><textureDictionary>{t}</textureDictionary><clipDictionary /><drawableDictionary /><physicsDictionary /><assetType>ASSET_TYPE_DRAWABLE</assetType><assetName>{n}</assetName><extensions /></Item>");
                    sb.Append($"</archetypes><name>{ytyp}</name><dependencies /><compositeEntityTypes /></CMapTypes>");
                    return sb.ToString();
                }
                byte[] Meta(string xml) { var x = new System.Xml.XmlDocument(); x.LoadXml(xml); return XmlMeta.GetData(x, MetaFormat.RSC, ""); }
                foreach (var f in new[] { "x64a.rpf", "x64i.rpf" }) { if (File.Exists(Path.Combine(gta, f))) File.Delete(Path.Combine(gta, f)); if (File.Exists(gta + "\\" + f)) File.Delete(gta + "\\" + f); }
                RpfFile.CreateNew(gta, "x64a.rpf");
                var r = RpfFile.CreateNew(gta, "x64i.rpf");
                var lv = RpfFile.CreateDirectory(r.Root, "levels"); var g5 = RpfFile.CreateDirectory(lv, "gta5"); var pr = RpfFile.CreateDirectory(g5, "props");
                var veg = RpfFile.CreateDirectory(pr, "vegetation"); var str = RpfFile.CreateDirectory(pr, "street");
                RpfFile.CreateFile(veg, "prop_tree_pine_01.ydr", Ydr("prop_tree_pine_01", 3));
                RpfFile.CreateFile(veg, "prop_tree_birch_02.ydr", Ydr("prop_tree_birch_02", 1));
                RpfFile.CreateFile(veg, "v_trees.ytyp", Meta(Ytyp("v_trees", ("prop_tree_pine_01", "v_trees_txd"), ("prop_tree_birch_02", "v_trees_txd"))));
                RpfFile.CreateFile(str, "prop_bench_01a.ydr", Ydr("prop_bench_01a", 1));
                RpfFile.CreateFile(str, "v_street.ytyp", Meta(Ytyp("v_street", ("prop_bench_01a", "prop_bench_txd"))));
                foreach (var f in new[] { "x64a.rpf", "x64i.rpf" })   // CodeWalker joins with '\\' - on Linux the file lands next to the folder
                {
                    var odd = gta + "\\" + f;
                    if (File.Exists(odd)) File.Move(odd, Path.Combine(gta, f), true);
                }
                if (req["exe"] != null) File.Copy((string)req["exe"], Path.Combine(gta, "GTA5.exe"), true);
                return new JsonObject { ["ok"] = true };
            }
            throw new Exception("unknown dev test");
        }
    }
}

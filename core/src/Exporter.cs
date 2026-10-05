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
    public static class Exporter
    {
        const string PropTypeFlags = "OBJECT";
        const string PropIncludeFlags = "MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE, VEHICLE_NOT_BVH, VEHICLE_BVH, PED, RAGDOLL, ANIMAL, ANIMAL_RAGDOLL, OBJECT, PLANT, PROJECTILE, EXPLOSION, FORKLIFT_FORKS, TEST_WEAPON, TEST_CAMERA, TEST_AI, TEST_SCRIPT, TEST_VEHICLE_WHEEL, GLASS";

        public static JsonNode Export(JsonObject req)
        {
            if (req["anim"] is JsonObject) return Animated.Export(req);
            var src = (string)req["source"];
            var outDir = (string)req["outDir"];
            var name = San((string)req["name"] ?? Path.GetFileNameWithoutExtension(src));
            var pivot = Util.ReadV3(req["pivot"]);
            var outputs = req["outputs"] as JsonObject ?? new JsonObject { ["ydr"] = true, ["ytyp"] = true, ["ybn"] = true };
            bool wantYdr = (bool?)outputs["ydr"] ?? true, wantYtyp = (bool?)outputs["ytyp"] ?? true, wantYbn = (bool?)outputs["ybn"] ?? false;
            var col = req["collision"] as JsonObject ?? new JsonObject { ["mode"] = "auto", ["shape"] = "box" };
            Directory.CreateDirectory(outDir);

            var ydr = Loader.ReadYdr(src);
            var d = ydr.Drawable;
            var warnings = new JsonArray();

            // 1. move the origin to the pivot (geometry is only translated, never reshaped)
            if (pivot != Vector3.Zero) TranslateDrawable(d, -pivot);
            d.Name = name;

            // 2. collision
            Bounds bound = BuildCollision(col, d, pivot, warnings);
            d.Bound = null;
            if (bound != null)
            {
                var embedded = CloneBound(bound, d);
                d.Bound = embedded;
            }

            var files = new JsonArray();
            var ydrBytes = ydr.Save();
            if (wantYdr)
            {
                var p = Path.Combine(outDir, name + ".ydr");
                File.WriteAllBytes(p, ydrBytes);
                files.Add(p);
            }
            if (wantYbn)
            {
                if (bound == null) warnings.Add("No collision selected - YBN skipped.");
                else
                {
                    var ybn = new YbnFile();
                    ybn.Bounds = CloneBound(bound, ybn);
                    var p = Path.Combine(outDir, name + ".ybn");
                    File.WriteAllBytes(p, ybn.Save());
                    files.Add(p);
                }
            }

            // 3. archetype data (computed from the re-pivoted drawable)
            var y = req["ytyp"] as JsonObject ?? new JsonObject();
            var bbMin = d.BoundingBoxMin; var bbMax = d.BoundingBoxMax;
            if (d.Bound != null) { bbMin = Vector3.Min(bbMin, d.Bound.BoxMin); bbMax = Vector3.Max(bbMax, d.Bound.BoxMax); }
            var centre = (bbMin + bbMax) * 0.5f;
            var radius = (bbMax - bbMin).Length() * 0.5f;
            var info = new JsonObject
            {
                ["bbMin"] = Util.V3(bbMin), ["bbMax"] = Util.V3(bbMax),
                ["bsCentre"] = Util.V3(centre), ["bsRadius"] = Util.R(radius)
            };
            if (wantYtyp)
            {
                var ytypName = San((string)y["ytypName"] ?? (name + "_types"));
                var arch = San((string)y["archetypeName"] ?? name);
                var xml = BuildYtypXml(ytypName, arch, y, bbMin, bbMax, centre, radius, d);
                var doc = new XmlDocument(); doc.LoadXml(xml);
                var data = XmlMeta.GetData(doc, MetaFormat.RSC, "");
                if (data == null) throw new Exception("YTYP build failed");
                var p = Path.Combine(outDir, ytypName + ".ytyp");
                File.WriteAllBytes(p, data);
                files.Add(p);
                if ((bool?)req["writeXml"] ?? false) File.WriteAllText(p + ".xml", xml);
            }
            return new JsonObject { ["files"] = files, ["archetype"] = info, ["warnings"] = warnings };
        }

        internal static string San(string s)
        {
            s = (s ?? "door").Trim().ToLowerInvariant();
            var sb = new StringBuilder();
            foreach (var c in s) sb.Append(char.IsLetterOrDigit(c) || c == '_' ? c : '_');
            return sb.Length == 0 ? "door" : sb.ToString();
        }
        static string F(float f) => Util.F(f);
        static string V(string tag, Vector3 v) => $"<{tag} x=\"{F(v.X)}\" y=\"{F(v.Y)}\" z=\"{F(v.Z)}\" />";

        // ------------------------------------------------------------------ geometry
        public static void TranslateDrawable(Drawable d, Vector3 off)
        {
            var done = new HashSet<VertexData>();
            foreach (var m in d.AllModels ?? new DrawableModel[0])
            {
                if (m?.Geometries == null) continue;
                foreach (var g in m.Geometries)
                {
                    foreach (var vd in new[] { g.VertexData, g.VertexBuffer?.Data1, g.VertexBuffer?.Data2 })
                    {
                        if (vd?.VertexBytes == null || vd.Info == null || done.Contains(vd)) continue;
                        done.Add(vd);
                        for (int i = 0; i < vd.VertexCount; i++)
                        {
                            var p = Loader.ReadComp(vd, i, 0);
                            Loader.WritePos(vd, i, new Vector3(p.X, p.Y, p.Z) + off);
                        }
                    }
                    var a = g.AABB;
                    g.AABB = new AABB_s { Min = a.Min + new Vector4(off, 0), Max = a.Max + new Vector4(off, 0) };
                }
                if (m.BoundsData != null)
                    for (int i = 0; i < m.BoundsData.Length; i++)
                        m.BoundsData[i] = new AABB_s { Min = m.BoundsData[i].Min + new Vector4(off, 0), Max = m.BoundsData[i].Max + new Vector4(off, 0) };
            }
            d.BoundingCenter += off;
            d.BoundingBoxMin += off;
            d.BoundingBoxMax += off;
            var lights = d.LightAttributes?.data_items;
            if (lights != null) foreach (var l in lights) l.Position += off;
        }

        // ------------------------------------------------------------------ collision
        internal static Bounds BuildCollision(JsonObject col, Drawable d, Vector3 pivot, JsonArray warnings)
        {
            var mode = ((string)col["mode"] ?? "auto").ToLowerInvariant();
            int mat = (int?)col["material"] ?? 70; // WOOD_SOLID_MEDIUM
            switch (mode)
            {
                case "none": return null;
                case "keep":
                    if (d.Bound == null) { warnings.Add("Model has no embedded collision - generated a box instead."); return BoxBound(d.BoundingBoxMin, d.BoundingBoxMax, mat); }
                    return ShiftBound(d.Bound, -pivot);
                case "import":
                    {
                        var path = (string)col["ybnPath"];
                        if (string.IsNullOrEmpty(path) || !File.Exists(path)) throw new Exception("Collision YBN not found: " + path);
                        var ybn = new YbnFile();
                        Util.LoadResource(ybn, path);
                        if (ybn.Bounds == null) throw new Exception("Could not read " + Path.GetFileName(path));
                        bool ybnInPivot = (bool?)col["ybnAlreadyPivoted"] ?? false;
                        return ShiftBound(ybn.Bounds, ybnInPivot ? Vector3.Zero : -pivot);
                    }
                default: // auto / custom - shapes are given in pivot space by the UI
                    {
                        var shape = ((string)col["shape"] ?? "box").ToLowerInvariant();
                        if (shape == "convex" && col["hull"] is JsonObject hull)
                            return ConvexBound(hull, mat);
                        var mn = Util.ReadV3(col["boxMin"], d.BoundingBoxMin);
                        var mx = Util.ReadV3(col["boxMax"], d.BoundingBoxMax);
                        return BoxBound(mn, mx, mat);
                    }
            }
        }

        static string BaseFields(Vector3 mn, Vector3 mx, float margin, int mat, float volume, Vector3 inertia, Vector3? geomCenter = null)
        {
            var c = (mn + mx) * 0.5f;
            var r = (mx - mn).Length() * 0.5f;
            var sb = new StringBuilder();
            sb.Append(V("BoxMin", mn)).Append(V("BoxMax", mx)).Append(V("BoxCenter", c)).Append(V("SphereCenter", c));
            sb.Append($"<SphereRadius value=\"{F(r)}\" /><Margin value=\"{F(margin)}\" /><Volume value=\"{F(volume)}\" />");
            sb.Append(V("Inertia", inertia));
            sb.Append($"<MaterialIndex value=\"{mat}\" /><MaterialColourIndex value=\"0\" /><ProceduralID value=\"0\" /><RoomID value=\"0\" /><PedDensity value=\"0\" /><UnkFlags value=\"0\" /><PolyFlags value=\"0\" /><UnkType value=\"1\" />");
            return sb.ToString();
        }
        static string ChildTail() =>
            "<CompositeTransform>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</CompositeTransform>" +
            $"<CompositeFlags1>{PropTypeFlags}</CompositeFlags1><CompositeFlags2>{PropIncludeFlags}</CompositeFlags2>";

        static Vector3 BoxInertia(Vector3 s) => new Vector3((s.Y * s.Y + s.Z * s.Z) / 12f, (s.X * s.X + s.Z * s.Z) / 12f, (s.X * s.X + s.Y * s.Y) / 12f);

        static Bounds BoxBound(Vector3 mn, Vector3 mx, int mat)
        {
            var s = mx - mn;
            if (s.X < 0.01f) { mx.X += 0.005f; mn.X -= 0.005f; }
            if (s.Y < 0.01f) { mx.Y += 0.005f; mn.Y -= 0.005f; }
            if (s.Z < 0.01f) { mx.Z += 0.005f; mn.Z -= 0.005f; }
            s = mx - mn;
            float vol = s.X * s.Y * s.Z;
            var child = "<Item type=\"Box\">" + BaseFields(mn, mx, 0.005f, mat, vol, BoxInertia(s)) + ChildTail() + "</Item>";
            var xml = "<Bounds type=\"Composite\">" + BaseFields(mn, mx, 0f, 0, vol, BoxInertia(s)) + "<Children>" + child + "</Children></Bounds>";
            return ParseBound(xml);
        }

        static Bounds ConvexBound(JsonObject hull, int mat)
        {
            var vs = (hull["vertices"] as JsonArray).Select(n => (float)n).ToArray();
            var ts = (hull["triangles"] as JsonArray).Select(n => (int)n).ToArray();
            var verts = new List<Vector3>();
            for (int i = 0; i + 2 < vs.Length; i += 3) verts.Add(new Vector3(vs[i], vs[i + 1], vs[i + 2]));
            if (verts.Count < 4 || ts.Length < 12) throw new Exception("Convex hull is degenerate - use BOX collision.");
            var mn = verts.Aggregate(Vector3.Min); var mx = verts.Aggregate(Vector3.Max);
            var gc = (mn + mx) * 0.5f;
            var s = mx - mn;
            var sb = new StringBuilder();
            sb.Append("<Item type=\"Geometry\">");
            sb.Append(BaseFields(mn, mx, 0.025f, mat, s.X * s.Y * s.Z * 0.8f, BoxInertia(s)));
            sb.Append(ChildTail());
            sb.Append(V("GeometryCenter", gc));
            sb.Append("<UnkFloat1 value=\"0\" /><UnkFloat2 value=\"0\" />");
            sb.Append($"<Materials><Item><Type value=\"{mat}\" /><ProceduralID value=\"0\" /><RoomID value=\"0\" /><PedDensity value=\"0\" /><Flags>FLAG_NOT_COVER, FLAG_NOT_CLIMBABLE</Flags><MaterialColourIndex value=\"0\" /><Unk value=\"0\" /></Item></Materials>");
            sb.Append("<Vertices>");
            foreach (var v in verts) { var r = v - gc; sb.Append($"{F(r.X)}, {F(r.Y)}, {F(r.Z)}\n"); }
            sb.Append("</Vertices><Polygons>");
            for (int i = 0; i + 2 < ts.Length; i += 3) sb.Append($"<Triangle m=\"0\" v1=\"{ts[i]}\" v2=\"{ts[i + 1]}\" v3=\"{ts[i + 2]}\" f1=\"0\" f2=\"0\" f3=\"0\" />");
            sb.Append("</Polygons></Item>");
            var xml = "<Bounds type=\"Composite\">" + BaseFields(mn, mx, 0f, 0, s.X * s.Y * s.Z, BoxInertia(s)) + "<Children>" + sb + "</Children></Bounds>";
            return ParseBound(xml);
        }

        static Bounds ParseBound(string xml, object owner = null)
        {
            var doc = new XmlDocument(); doc.LoadXml(xml);
            var b = Bounds.ReadXmlNode(doc.DocumentElement, owner);
            if (b == null) throw new Exception("Collision build failed");
            return b;
        }

        static string BoundXml(Bounds b)
        {
            var sb = new StringBuilder();
            Bounds.WriteXmlNode(b, sb, 0);
            return sb.ToString();
        }

        // Shift every position-like field in the bound hierarchy (geometry is stored relative to GeometryCenter)
        static Bounds ShiftBound(Bounds b, Vector3 off)
        {
            var root = b;
            if (!(b is BoundComposite))
            {
                // wrap single bounds in a composite, as props expect
                var inner = BoundXml(b).Replace("<Bounds type=", "<Item type=");
                inner = inner.Substring(0, inner.LastIndexOf("</Bounds>")) + ChildTail() + "</Item>";
                var wrapped = "<Bounds type=\"Composite\">" + BaseFields(b.BoxMin, b.BoxMax, 0f, 0, b.Volume, b.Unknown_60h) + "<Children>" + inner + "</Children></Bounds>";
                root = ParseBound(wrapped);
            }
            var doc = new XmlDocument(); doc.LoadXml(BoundXml(root));
            if (off != Vector3.Zero)
            {
                foreach (var tag in new[] { "BoxMin", "BoxMax", "BoxCenter", "SphereCenter", "GeometryCenter" })
                {
                    foreach (XmlElement e in doc.GetElementsByTagName(tag))
                    {
                        e.SetAttribute("x", F(Fl(e, "x") + off.X));
                        e.SetAttribute("y", F(Fl(e, "y") + off.Y));
                        e.SetAttribute("z", F(Fl(e, "z") + off.Z));
                    }
                }
            }
            return Bounds.ReadXmlNode(doc.DocumentElement);
        }
        static float Fl(XmlElement e, string a) => float.Parse(e.GetAttribute(a), CultureInfo.InvariantCulture);

        static Bounds CloneBound(Bounds b, object owner) => ParseBound(BoundXml(b), owner);

        // ------------------------------------------------------------------ ytyp
        static string BuildYtypXml(string ytypName, string arch, JsonObject y, Vector3 bbMin, Vector3 bbMax, Vector3 centre, float radius, Drawable d)
        {
            float lod = (float?)y["lodDist"] ?? 100f;
            float hd = (float?)y["hdTextureDist"] ?? 15f;
            uint flags = (uint?)y["flags"] ?? (131072u | 67108864u);
            int special = (int?)y["specialAttribute"] ?? 7;
            bool embeddedTxd = (d.ShaderGroup?.TextureDictionary?.Textures?.data_items?.Length ?? 0) > 0;
            string txd = San((string)y["textureDictionary"] ?? (embeddedTxd ? arch : ""));
            if ((string)y["textureDictionary"] == "") txd = "";
            string phys = (string)y["physicsDictionary"]; phys = phys == null ? arch : (phys == "" ? "" : San(phys));
            string assetName = San((string)y["assetName"] ?? arch);
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapTypes>\n <extensions />\n <archetypes>\n");
            sb.Append("  <Item type=\"CBaseArchetypeDef\">\n");
            sb.Append($"   <lodDist value=\"{F(lod)}\" />\n");
            sb.Append($"   <flags value=\"{flags}\" />\n");
            sb.Append($"   <specialAttribute value=\"{special}\" />\n");
            sb.Append("   " + V("bbMin", bbMin) + "\n   " + V("bbMax", bbMax) + "\n   " + V("bsCentre", centre) + "\n");
            sb.Append($"   <bsRadius value=\"{F(radius)}\" />\n");
            sb.Append($"   <hdTextureDist value=\"{F(hd)}\" />\n");
            sb.Append($"   <name>{arch}</name>\n");
            sb.Append(txd.Length > 0 ? $"   <textureDictionary>{txd}</textureDictionary>\n" : "   <textureDictionary />\n");
            sb.Append("   <clipDictionary />\n   <drawableDictionary />\n");
            sb.Append(phys.Length > 0 ? $"   <physicsDictionary>{phys}</physicsDictionary>\n" : "   <physicsDictionary />\n");
            sb.Append("   <assetType>ASSET_TYPE_DRAWABLE</assetType>\n");
            sb.Append($"   <assetName>{assetName}</assetName>\n");
            sb.Append("   <extensions />\n  </Item>\n </archetypes>\n");
            sb.Append($" <name>{ytypName}</name>\n <dependencies />\n <compositeEntityTypes />\n</CMapTypes>\n");
            return sb.ToString();
        }
    }
}

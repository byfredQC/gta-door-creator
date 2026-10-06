// Destructible prop export: the model is cut into N pieces (the app computes which triangle goes to which piece)
// and exported as a breakable GTA fragment (.yft), built like vanilla breakables (sr_prop_sr_boxpile_01, race gates):
//
//   bone 0  root (tag 0)        group 0 (parent 255, strength -1)  tiny anchor collision at the origin
//   bone k  piece k (tag Tk)    group k (parent 0, strength S)     the piece mesh + its box collision
//
// Each piece breaks off by itself when an explosion / impact / bullet exceeds its strength, then falls with
// real physics. No script.
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
    public static class Destruct
    {
        public const uint FlagsBreakable = 536870912u | 131072u;   // Use Ambient Scale + Dynamic (vanilla breakables)
        const uint FlagStatic = 32;

        static string F(float f) => Animated.F(f);
        static string V(string t, Vector3 v) => Animated.V(t, v);

        class Piece
        {
            public int Index;            // 0-based piece number (bone = Index + 1)
            public ushort Tag;
            public Vector3 Min = new Vector3(float.MaxValue), Max = new Vector3(float.MinValue);
            public Vector3 Center => (Min + Max) * 0.5f;
            public List<Part> Parts = new();
        }
        class Part { public XmlElement Geom; public List<string> Rows = new(); public List<string[]> Src = new(); public List<int> Idx = new(); public int Shader; public Dictionary<int, int> Map; }

        // ------------------------------------------------------------------ split (shared by the preview and the export)
        // 1. big triangles are subdivided so a low-poly model (a bridge deck made of 2 triangles) can still break in chunks
        // 2. k-means on the triangle centres -> N compact pieces (deterministic for a given seed)
        class Geo { public XmlElement El; public List<string[]> V = new(); public List<int> I = new(); public int Shader; public int UvTok = -1; public HashSet<int> IntTok = new(); }

        static List<Geo> ReadGeos(XmlElement dr)
        {
            var list = new List<Geo>();
            foreach (XmlElement g in dr.SelectNodes("DrawableModelsHigh/Item/Geometries/Item"))
            {
                var vdata = g.SelectSingleNode("VertexBuffer/Data") ?? g.SelectSingleNode("VertexBuffer/Data1");
                var idata = g.SelectSingleNode("IndexBuffer/Data");
                if (vdata == null || idata == null) continue;
                var geo = new Geo { El = g, Shader = int.Parse((g.SelectSingleNode("ShaderIndex") as XmlElement)?.GetAttribute("value") ?? "0") };
                foreach (var r in Rows(vdata.InnerText)) geo.V.Add(r.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries));
                geo.I.AddRange(Ints(idata.InnerText));
                // token layout: which tokens are integers (colours / blend indices) and where TexCoord0 is
                int tok = 0;
                foreach (XmlNode c in g.SelectSingleNode("VertexBuffer/Layout")?.ChildNodes ?? (XmlNodeList)new XmlDocument().ChildNodes)
                {
                    if (!(c is XmlElement e)) continue;
                    int n = e.Name switch { "Position" => 3, "Normal" => 3, "Colour0" or "Colour1" => 4, "BlendWeights" or "BlendIndices" => 4, "Tangent" => 4, _ when e.Name.StartsWith("TexCoord") => 2, _ => 0 };
                    if (n == 0) { tok = -1; break; }
                    if (e.Name.StartsWith("Colour") || e.Name.StartsWith("Blend")) for (int k = 0; k < n; k++) geo.IntTok.Add(tok + k);
                    if (e.Name == "TexCoord0") geo.UvTok = tok;
                    tok += n;
                }
                list.Add(geo);
            }
            return list;
        }
        static Vector3 P(string[] t) => new Vector3(Fl(t[0]), Fl(t[1]), Fl(t[2]));

        static void Tessellate(List<Geo> geos, float maxEdge, int maxTris)
        {
            int total = geos.Sum(g => g.I.Count / 3);
            for (int pass = 0; pass < 12 && total < maxTris; pass++)
            {
                bool any = false;
                foreach (var g in geos)
                {
                    var mid = new Dictionary<long, int>();
                    int Mid(int a, int b)
                    {
                        long key = a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
                        if (mid.TryGetValue(key, out int m)) return m;
                        var ta = g.V[a]; var tb = g.V[b]; var tn = new string[ta.Length];
                        for (int k = 0; k < ta.Length; k++)
                        {
                            double v = (double.Parse(ta[k], CultureInfo.InvariantCulture) + double.Parse(tb[k], CultureInfo.InvariantCulture)) * 0.5;
                            tn[k] = g.IntTok.Contains(k) ? Math.Round(v).ToString(CultureInfo.InvariantCulture) : ((float)v).ToString("R", CultureInfo.InvariantCulture);
                        }
                        g.V.Add(tn); m = g.V.Count - 1; mid[key] = m; return m;
                    }
                    var ni = new List<int>(g.I.Count);
                    for (int t = 0; t + 2 < g.I.Count; t += 3)
                    {
                        int a = g.I[t], b = g.I[t + 1], c = g.I[t + 2];
                        Vector3 pa = P(g.V[a]), pb = P(g.V[b]), pc = P(g.V[c]);
                        float ab = (pb - pa).Length(), bc = (pc - pb).Length(), ca = (pa - pc).Length();
                        float longest = Math.Max(ab, Math.Max(bc, ca));
                        if (longest <= maxEdge || total >= maxTris || g.V.Count > 60000) { ni.Add(a); ni.Add(b); ni.Add(c); continue; }
                        any = true; total++;
                        if (longest == ab) { int m = Mid(a, b); ni.AddRange(new[] { a, m, c, m, b, c }); }
                        else if (longest == bc) { int m = Mid(b, c); ni.AddRange(new[] { a, b, m, a, m, c }); }
                        else { int m = Mid(c, a); ni.AddRange(new[] { a, b, m, m, b, c }); }
                    }
                    g.I = ni;
                }
                if (!any) break;
            }
        }

        // returns, per geometry, the piece of every triangle
        static List<int[]> KMeans(List<Geo> geos, int k, int seed)
        {
            var cents = new List<Vector3>(); var owners = new List<(int g, int t)>();
            for (int gi = 0; gi < geos.Count; gi++)
                for (int t = 0; t + 2 < geos[gi].I.Count; t += 3)
                {
                    var g = geos[gi];
                    cents.Add((P(g.V[g.I[t]]) + P(g.V[g.I[t + 1]]) + P(g.V[g.I[t + 2]])) / 3f); owners.Add((gi, t / 3));
                }
            int n = cents.Count; k = Math.Max(1, Math.Min(k, n));
            var rnd = new Random(seed * 7919 + 17);
            // k-means++ seeding
            var C = new List<Vector3> { cents[rnd.Next(n)] };
            var dist = new double[n];
            while (C.Count < k)
            {
                double sum = 0;
                for (int i = 0; i < n; i++) { double best = double.MaxValue; foreach (var c in C) best = Math.Min(best, (cents[i] - c).LengthSquared()); dist[i] = best; sum += best; }
                double r = rnd.NextDouble() * sum; int pick = n - 1;
                for (int i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) { pick = i; break; } }
                C.Add(cents[pick]);
            }
            var lab = new int[n];
            for (int it = 0; it < 20; it++)
            {
                for (int i = 0; i < n; i++) { int bi = 0; double bd = double.MaxValue; for (int j = 0; j < C.Count; j++) { double dd = (cents[i] - C[j]).LengthSquared(); if (dd < bd) { bd = dd; bi = j; } } lab[i] = bi; }
                var acc = new Vector3[C.Count]; var cnt = new int[C.Count];
                for (int i = 0; i < n; i++) { acc[lab[i]] += cents[i]; cnt[lab[i]]++; }
                for (int j = 0; j < C.Count; j++) if (cnt[j] > 0) C[j] = acc[j] / cnt[j];
            }
            // renumber non-empty pieces 0..m-1
            var remap = new Dictionary<int, int>();
            var res = geos.Select(g => new int[g.I.Count / 3]).ToList();
            for (int i = 0; i < n; i++) { if (!remap.TryGetValue(lab[i], out int id)) remap[lab[i]] = id = remap.Count; res[owners[i].g][owners[i].t] = id; }
            return res;
        }

        static List<Geo> SplitGeos(XmlElement dr, int pieces, int seed, out List<int[]> labels)
        {
            var geos = ReadGeos(dr);
            if (geos.Count == 0) throw new Exception("The model has no geometry to break");
            var mn = new Vector3(float.MaxValue); var mx = new Vector3(float.MinValue);
            foreach (var g in geos) foreach (var v in g.V) { var p = P(v); mn = Vector3.Min(mn, p); mx = Vector3.Max(mx, p); }
            var size = mx - mn;
            // target piece size ~ cube root of volume / pieces, triangles split down to 1/3 of it
            float vol = Math.Max(1e-4f, Math.Max(size.X, 0.05f) * Math.Max(size.Y, 0.05f) * Math.Max(size.Z, 0.05f));
            float pieceSize = (float)Math.Pow(vol / Math.Max(1, pieces), 1.0 / 3.0);
            Tessellate(geos, Math.Max(0.05f, pieceSize / 3f), 120000);
            labels = KMeans(geos, pieces, seed);
            return geos;
        }

        // preview for the app: per piece, the triangles in model space (positions + uvs) and its centre
        public static JsonNode Preview(JsonObject req)
        {
            var ydr = Loader.ReadYdr((string)req["source"]);
            ydr.Drawable.Bound = null;
            var texDir = Path.Combine(Path.GetTempPath(), "gdc_desp_" + Guid.NewGuid().ToString("N"));
            try
            {
                var doc = new XmlDocument(); doc.LoadXml(YdrXml.GetXml(ydr, texDir));
                var geos = SplitGeos(doc.DocumentElement, (int?)req["pieces"] ?? 12, (int?)req["seed"] ?? 1, out var labels);
                int count = labels.Count == 0 ? 0 : labels.Max(l => l.Length == 0 ? -1 : l.Max()) + 1;
                var outPieces = new JsonArray();
                for (int p = 0; p < count; p++)
                {
                    var parts = new JsonArray();
                    var mn = new Vector3(float.MaxValue); var mx = new Vector3(float.MinValue);
                    for (int gi = 0; gi < geos.Count; gi++)
                    {
                        var g = geos[gi]; var pos = new List<float>(); var uv = new List<float>();
                        for (int t = 0; t < labels[gi].Length; t++)
                        {
                            if (labels[gi][t] != p) continue;
                            for (int k = 0; k < 3; k++)
                            {
                                var row = g.V[g.I[t * 3 + k]]; var v = P(row);
                                pos.Add(v.X); pos.Add(v.Y); pos.Add(v.Z); mn = Vector3.Min(mn, v); mx = Vector3.Max(mx, v);
                                if (g.UvTok >= 0) { uv.Add(Fl(row[g.UvTok])); uv.Add(Fl(row[g.UvTok + 1])); }
                            }
                        }
                        if (pos.Count == 0) continue;
                        var part = new JsonObject { ["shaderIndex"] = g.Shader, ["positions"] = Util.B64(pos.ToArray()) };
                        if (uv.Count > 0) part["uvs"] = Util.B64(uv.ToArray());
                        parts.Add(part);
                    }
                    outPieces.Add(new JsonObject { ["center"] = Util.V3((mn + mx) * 0.5f), ["parts"] = parts });
                }
                return new JsonObject { ["pieces"] = outPieces, ["triangles"] = geos.Sum(g => g.I.Count / 3) };
            }
            finally { try { Directory.Delete(texDir, true); } catch { } }
        }

        public static JsonNode Export(JsonObject req)
        {
            var src = (string)req["source"];
            var outDir = (string)req["outDir"];
            var name = Exporter.San((string)req["name"] ?? Path.GetFileNameWithoutExtension(src));
            var pivot = Util.ReadV3(req["pivot"]);
            var ds = req["destruct"] as JsonObject;
            var col = req["collision"] as JsonObject ?? new JsonObject();
            var y = req["ytyp"] as JsonObject ?? new JsonObject();
            var outputs = req["outputs"] as JsonObject ?? new JsonObject();
            bool wantModel = (bool?)outputs["ydr"] ?? true, wantYtyp = (bool?)outputs["ytyp"] ?? true;
            float strength = Math.Max(1f, (float?)ds["strength"] ?? 300f);
            float density = Math.Max(50f, (float?)ds["density"] ?? 800f);
            bool anchored = (bool?)ds["anchored"] ?? true;
            int mat = (int?)col["material"] ?? 70;
            int pieceReq = Math.Max(2, Math.Min(120, (int?)ds["pieces"] ?? 12)), seed = (int?)ds["seed"] ?? 1;
            Directory.CreateDirectory(outDir);
            var warnings = new JsonArray();
            var files = new JsonArray();

            var ydr = Loader.ReadYdr(src);
            var d = ydr.Drawable;   // split in the ORIGINAL model space (same result as the preview), the pivot is applied when writing
            d.Name = name;
            d.Bound = null;

            var texDir = Path.Combine(Path.GetTempPath(), "gdc_des_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(texDir);
            Vector3 bbMin, bbMax; int pieceCount;
            try
            {
                var ddoc = new XmlDocument(); ddoc.LoadXml(YdrXml.GetXml(ydr, texDir));
                var dr = ddoc.DocumentElement;

                // ---- split, then gather every piece's triangles (positions moved to pivot space)
                var geos = SplitGeos(dr, pieceReq, seed, out var labels);
                var pieces = new Dictionary<int, Piece>();
                for (int gi = 0; gi < geos.Count; gi++)
                {
                    var g = geos[gi];
                    for (int t = 0; t < labels[gi].Length; t++)
                    {
                        int pid = labels[gi][t];
                        if (!pieces.TryGetValue(pid, out var pc)) pieces[pid] = pc = new Piece();
                        var part = pc.Parts.FirstOrDefault(x => x.Geom == g.El);
                        if (part == null) { part = new Part { Geom = g.El, Shader = g.Shader }; pc.Parts.Add(part); part.Map = new Dictionary<int, int>(); }
                        for (int k = 0; k < 3; k++)
                        {
                            int vi = g.I[t * 3 + k];
                            if (!part.Map.TryGetValue(vi, out int ni)) { ni = part.Rows.Count; part.Map[vi] = ni; part.Src.Add(g.V[vi]); part.Rows.Add(null); }
                            part.Idx.Add(ni);
                            var p = P(g.V[vi]) - pivot;
                            pc.Min = Vector3.Min(pc.Min, p); pc.Max = Vector3.Max(pc.Max, p);
                        }
                    }
                }
                var list = pieces.OrderBy(kv => kv.Key).Select(kv => kv.Value).ToList();
                for (int i = 0; i < list.Count; i++) { list[i].Index = i; list[i].Tag = (ushort)(1000 + JenkHash.GenHash(name + "_piece" + i) % 60000); }
                // unique tags
                var used = new HashSet<ushort> { 0 };
                foreach (var pc in list) while (!used.Add(pc.Tag)) pc.Tag = (ushort)(pc.Tag % 65000 + 1);
                if (list.Count > 120) throw new Exception("Too many pieces (max 120)");
                pieceCount = list.Count;

                // ---- new high models: one per piece, vertices in the piece bone space
                var sbm = new StringBuilder("<DrawableModelsHigh>");
                foreach (var pc in list)
                {
                    var c = pc.Center;
                    sbm.Append($"<Item><RenderMask value=\"255\" /><Flags value=\"0\" /><HasSkin value=\"0\" /><BoneIndex value=\"{pc.Index + 1}\" /><Unknown1 value=\"0\" /><Geometries>");
                    foreach (var part in pc.Parts)
                    {
                        var gc = (XmlElement)part.Geom.CloneNode(true);
                        var vnode = gc.SelectSingleNode("VertexBuffer/Data") ?? gc.SelectSingleNode("VertexBuffer/Data1");
                        var inode = gc.SelectSingleNode("IndexBuffer/Data");
                        if (part.Src.Count > 65535) throw new Exception("A piece has more than 65535 vertices - use more pieces");
                        Vector3 gmn = new Vector3(float.MaxValue), gmx = new Vector3(float.MinValue);
                        var outRows = new List<string>(part.Src.Count);
                        foreach (var src0 in part.Src)
                        {
                            var toks = (string[])src0.Clone();
                            var p = P(toks) - pivot - c;
                            toks[0] = F(p.X); toks[1] = F(p.Y); toks[2] = F(p.Z);
                            outRows.Add(string.Join(" ", toks));
                            gmn = Vector3.Min(gmn, p); gmx = Vector3.Max(gmx, p);
                        }
                        vnode.InnerText = "\n" + string.Join("\n", outRows) + "\n";
                        inode.InnerText = "\n" + string.Join(" ", part.Idx) + "\n";
                        SetV4(gc, "BoundingBoxMin", gmn); SetV4(gc, "BoundingBoxMax", gmx);
                        sbm.Append(gc.OuterXml);
                    }
                    sbm.Append("</Geometries></Item>");
                }
                sbm.Append("</DrawableModelsHigh>");
                foreach (var n in new[] { "DrawableModelsHigh", "DrawableModelsMedium", "DrawableModelsLow", "DrawableModelsVeryLow", "Bounds", "Skeleton", "Joints", "Lights" })
                    foreach (XmlNode x in dr.SelectNodes(n).Cast<XmlNode>().ToList()) dr.RemoveChild(x);
                foreach (var n in new[] { "FlagsMed", "FlagsLow", "FlagsVlow" }) (dr.SelectSingleNode(n) as XmlElement)?.SetAttribute("value", "0");
                var mdoc = new XmlDocument(); mdoc.LoadXml(sbm.ToString());
                var mEl = ddoc.CreateElement("Matrix"); mEl.InnerText = Animated.Mat43(Vector3.Zero);
                dr.InsertAfter(mEl, dr.SelectSingleNode("Name"));
                var skDoc = new XmlDocument(); skDoc.LoadXml(SkeletonXml(name, list));
                var sg = dr.SelectSingleNode("ShaderGroup");
                var skel = ddoc.ImportNode(skDoc.DocumentElement, true);
                if (sg != null) dr.InsertAfter(skel, sg); else dr.InsertAfter(skel, mEl);
                dr.InsertAfter(ddoc.ImportNode(mdoc.DocumentElement, true), skel);

                bbMin = list.Select(p => p.Min).Aggregate(Vector3.Min); bbMax = list.Select(p => p.Max).Aggregate(Vector3.Max);
                bbMin = Vector3.Min(bbMin, new Vector3(-0.02f)); bbMax = Vector3.Max(bbMax, new Vector3(0.02f));
                var sc = (bbMin + bbMax) * 0.5f; var sr = (bbMax - bbMin).Length() * 0.5f;
                void Set(string t, string at, string v) { (dr.SelectSingleNode(t) as XmlElement)?.SetAttribute(at, v); }
                Set("BoundingSphereCenter", "x", F(sc.X)); Set("BoundingSphereCenter", "y", F(sc.Y)); Set("BoundingSphereCenter", "z", F(sc.Z));
                Set("BoundingSphereRadius", "value", F(sr));
                Set("BoundingBoxMin", "x", F(bbMin.X)); Set("BoundingBoxMin", "y", F(bbMin.Y)); Set("BoundingBoxMin", "z", F(bbMin.Z));
                Set("BoundingBoxMax", "x", F(bbMax.X)); Set("BoundingBoxMax", "y", F(bbMax.Y)); Set("BoundingBoxMax", "z", F(bbMax.Z));

                if (wantModel)
                {
                    var fragXml = FragmentXml(name, dr.OuterXml, list, mat, strength, density, sc, sr);
                    var fdoc = new XmlDocument(); fdoc.LoadXml(fragXml);
                    var yftBytes = XmlMeta.GetYftData(fdoc, texDir) ?? throw new Exception("YFT build failed");
                    var yftPath = Path.Combine(outDir, name + ".yft");
                    File.WriteAllBytes(yftPath, yftBytes);
                    files.Add(yftPath);
                    if ((bool?)req["writeXml"] ?? false) File.WriteAllText(yftPath + ".xml", fragXml);
                    Verify(yftBytes, list.Count);
                }
            }
            finally { try { Directory.Delete(texDir, true); } catch { } }

            var centre = (bbMin + bbMax) * 0.5f; var radius = (bbMax - bbMin).Length() * 0.5f;
            if (wantYtyp)
            {
                var ytypName = Exporter.San((string)y["ytypName"] ?? name);
                var arch = Exporter.San((string)y["archetypeName"] ?? name);
                uint flags = (uint?)y["flags"] ?? (FlagsBreakable | (anchored ? FlagStatic : 0));
                var xml = YtypXml(ytypName, arch, name, y, flags, bbMin, bbMax, centre, radius);
                var doc = new XmlDocument(); doc.LoadXml(xml);
                var data = XmlMeta.GetData(doc, MetaFormat.RSC, "") ?? throw new Exception("YTYP build failed");
                var p = Path.Combine(outDir, ytypName + ".ytyp");
                File.WriteAllBytes(p, data);
                files.Add(p);
            }
            var info = new JsonObject { ["bbMin"] = Util.V3(bbMin), ["bbMax"] = Util.V3(bbMax), ["bsCentre"] = Util.V3(centre), ["bsRadius"] = Util.R(radius), ["pieces"] = pieceCount };
            return new JsonObject { ["files"] = files, ["archetype"] = info, ["warnings"] = warnings };
        }

        // ------------------------------------------------------------------ helpers
        static float Fl(string s) => float.Parse(s, CultureInfo.InvariantCulture);
        static string[] Rows(string text) => text.Split('\n').Select(r => r.Trim()).Where(r => r.Length > 0).ToArray();
        static int[] Ints(string text) => text.Split(new[] { ' ', '\t', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToArray();
        static Vector3 Pos(string row)
        {
            var t = row.Split(new[] { ' ', '\t' }, 4, StringSplitOptions.RemoveEmptyEntries);
            return new Vector3(Fl(t[0]), Fl(t[1]), Fl(t[2]));
        }
        static void SetV4(XmlElement g, string tag, Vector3 v)
        {
            if (g.SelectSingleNode(tag) is XmlElement e) { e.SetAttribute("x", F(v.X)); e.SetAttribute("y", F(v.Y)); e.SetAttribute("z", F(v.Z)); }
        }

        static string SkeletonXml(string name, List<Piece> list)
        {
            const string rootFlags = "RotX, RotY, RotZ, TransX, TransY, TransZ, Unk0";
            const string pieceFlags = "RotX, RotY, RotZ, Unk0";
            var sb = new StringBuilder();
            var s50 = new StringBuilder($"0 {rootFlags}"); var s58 = new StringBuilder($"0 {rootFlags} 0 0 0");
            string bone(string n, int t, int idx, int parent, int sibling, string flags, Vector3 tr) =>
                $"<Item><Name>{n}</Name><Tag value=\"{t}\" /><Index value=\"{idx}\" /><ParentIndex value=\"{parent}\" /><SiblingIndex value=\"{sibling}\" /><Flags>{flags}</Flags>" +
                $"<Translation x=\"{F(tr.X)}\" y=\"{F(tr.Y)}\" z=\"{F(tr.Z)}\" /><Rotation x=\"0\" y=\"0\" z=\"0\" w=\"1\" /><Scale x=\"1\" y=\"1\" z=\"1\" /><TransformUnk x=\"0\" y=\"4\" z=\"-3\" w=\"0\" /></Item>";
            sb.Append(bone(name, 0, 0, -1, -1, rootFlags, Vector3.Zero));
            for (int i = 0; i < list.Count; i++)
            {
                var pc = list[i]; var c = pc.Center;
                sb.Append(bone($"piece_{i + 1:000}", pc.Tag, i + 1, 0, i + 1 < list.Count ? i + 2 : -1, pieceFlags, c));
                s50.Append($" {pc.Tag} {pieceFlags}"); s58.Append($" {pc.Tag} {pieceFlags} {F(c.X)} {F(c.Y)} {F(c.Z)}");
            }
            uint u50 = JenkHash.GenHash(s50.ToString()), u54 = Animated.Crc32(s50.ToString()), u58 = Animated.Crc32(s58.ToString());
            return $"<Skeleton><Unknown1C value=\"16777216\" /><Unknown50 value=\"{u50}\" /><Unknown54 value=\"{u54}\" /><Unknown58 value=\"{u58}\" /><Bones>{sb}</Bones></Skeleton>";
        }

        static string Group(string n, int parent, float strength, float mass) =>
            $"    <Item><Name>{n}</Name><ParentIndex value=\"{parent}\" /><GlassWindowIndex value=\"0\" /><GlassFlags value=\"0\" /><Strength value=\"{F(strength)}\" />" +
            "<ForceTransmissionScaleUp value=\"0.25\" /><ForceTransmissionScaleDown value=\"0.25\" /><JointStiffness value=\"0\" /><MinSoftAngle1 value=\"-1\" /><MaxSoftAngle1 value=\"1\" /><MaxSoftAngle2 value=\"1\" /><MaxSoftAngle3 value=\"1\" />" +
            "<RotationSpeed value=\"0\" /><RotationStrength value=\"0\" /><RestoringStrength value=\"0\" /><RestoringMaxTorque value=\"0\" /><LatchStrength value=\"0\" />" +
            $"<Mass value=\"{F(mass)}\" /><MinDamageForce value=\"100\" /><DamageHealth value=\"1000\" /><UnkFloat5C value=\"10000\" /><UnkFloat60 value=\"0.3\" /><UnkFloat64 value=\"0\" /><UnkFloat68 value=\"0\" /><UnkFloat6C value=\"0\" /><UnkFloat70 value=\"1\" /><UnkFloat74 value=\"0\" /><UnkFloat78 value=\"1\" /><UnkFloatA8 value=\"0\" /></Item>\n";

        static string Child(int group, int tag, float mass, float unk, Vector3 inertia, Vector3 matrixPos) =>
            $"    <Item><GroupIndex value=\"{group}\" /><BoneTag value=\"{tag}\" /><PristineMass value=\"{F(mass)}\" /><DamagedMass value=\"{F(mass)}\" /><UnkFloat value=\"{F(unk)}\" />" +
            $"<UnkVec x=\"0\" y=\"0\" z=\"0\" w=\"0\" /><InertiaTensor x=\"{F(inertia.X)}\" y=\"{F(inertia.Y)}\" z=\"{F(inertia.Z)}\" w=\"0\" /><EventSet />" +
            $"<Drawable><Name /><Matrix>{Animated.Mat43(matrixPos)}</Matrix><BoundingSphereCenter x=\"0\" y=\"0\" z=\"0\" /><BoundingSphereRadius value=\"0\" /><BoundingBoxMin x=\"0\" y=\"0\" z=\"0\" /><BoundingBoxMax x=\"0\" y=\"0\" z=\"0\" />" +
            "<LodDistHigh value=\"0\" /><LodDistMed value=\"0\" /><LodDistLow value=\"0\" /><LodDistVlow value=\"0\" /><FlagsHigh value=\"0\" /><FlagsMed value=\"0\" /><FlagsLow value=\"0\" /><FlagsVlow value=\"0\" /></Drawable></Item>\n";

        static string FragmentXml(string name, string drawableXml, List<Piece> list, int mat, float strength, float density, Vector3 sc, float sr)
        {
            // bodies: root anchor + one box per piece (model space)
            var bodies = new List<(Vector3 mn, Vector3 mx, float mass, int group, int tag, Vector3 bone)>();
            Vector3 rMin = new Vector3(-0.02f), rMax = new Vector3(0.02f);
            bodies.Add((rMin, rMax, 1f, 0, 0, Vector3.Zero));
            foreach (var pc in list)
            {
                var mn = pc.Min; var mx = pc.Max; var s = mx - mn;
                // keep boxes at least 2 cm thick
                for (int k = 0; k < 3; k++) if (s[k] < 0.02f) { mn[k] -= 0.01f; mx[k] += 0.01f; }
                s = mx - mn;
                float mass = Math.Max(1f, Math.Min(20000f, s.X * s.Y * s.Z * density * 0.6f));
                bodies.Add((mn, mx, mass, pc.Index + 1, pc.Tag, pc.Center));
            }
            float total = bodies.Sum(b => b.mass);
            var com = bodies.Aggregate(Vector3.Zero, (acc, b) => acc + (b.mn + b.mx) * 0.5f * b.mass) / total;
            Vector3 Par(Vector3 r, float m) => new Vector3(m * (r.Y * r.Y + r.Z * r.Z), m * (r.X * r.X + r.Z * r.Z), m * (r.X * r.X + r.Y * r.Y));
            var itot = Vector3.Zero; float unk18 = 0;
            foreach (var b in bodies)
            {
                var ib = Animated.BoxInertia(b.mx - b.mn, b.mass);
                itot += ib + Par((b.mn + b.mx) * 0.5f - com, b.mass);
                unk18 = Math.Max(unk18, Math.Max(ib.X, Math.Max(ib.Y, ib.Z)));
            }
            var bMin = bodies.Select(b => b.mn).Aggregate(Vector3.Min); var bMax = bodies.Select(b => b.mx).Aggregate(Vector3.Max);
            var bc = (bMin + bMax) * 0.5f;
            float vol = bodies.Sum(b => { var s = b.mx - b.mn; return s.X * s.Y * s.Z; });

            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Fragment>\n");
            sb.Append($" <Name>pack:/{name}</Name>\n " + V("BoundingSphereCenter", sc) + $"\n <BoundingSphereRadius value=\"{F(sr)}\" />\n");
            sb.Append(" <UnknownB0 value=\"0\" />\n <UnknownB8 value=\"0\" />\n <UnknownBC value=\"0\" />\n <UnknownC0 value=\"65280\" />\n <UnknownC4 value=\"1\" />\n <UnknownCC value=\"0\" />\n");
            sb.Append(" <GravityFactor value=\"1\" />\n <BuoyancyFactor value=\"1\" />\n");
            sb.Append(drawableXml).Append('\n');
            sb.Append(" <BoneTransforms unk=\"0\">\n  <Item>1 0 0 0\n0 1 0 0\n0 0 1 0</Item>\n");
            foreach (var pc in list) { var c = pc.Center; sb.Append($"  <Item>1 0 0 {F(c.X)}\n0 1 0 {F(c.Y)}\n0 0 1 {F(c.Z)}</Item>\n"); }
            sb.Append(" </BoneTransforms>\n <Physics>\n  <LOD1>\n");
            sb.Append($"   <Unknown14 value=\"{F(unk18 / 10000f)}\" />\n   <Unknown18 value=\"{F(unk18)}\" />\n   <Unknown1C value=\"-1\" />\n");
            sb.Append("   " + V("PositionOffset", com) + "\n   " + V("Unknown40", com) + "\n   " + V("Unknown50", Vector3.Zero) + "\n");
            sb.Append("   <DampingLinearC x=\"0.02\" y=\"0.02\" z=\"0.02\" />\n   <DampingLinearV x=\"0.02\" y=\"0.02\" z=\"0.02\" />\n   <DampingLinearV2 x=\"0.01\" y=\"0.01\" z=\"0.01\" />\n");
            sb.Append("   <DampingAngularC x=\"0.02\" y=\"0.02\" z=\"0.02\" />\n   <DampingAngularV x=\"0.02\" y=\"0.02\" z=\"0.02\" />\n   <DampingAngularV2 x=\"0.01\" y=\"0.01\" z=\"0.01\" />\n");
            sb.Append($"   <Archetype>\n    <Name>{name}</Name>\n    <Mass value=\"{F(total)}\" />\n    <MassInv value=\"{F(1f / total)}\" />\n");
            sb.Append("    <Unknown48 value=\"1\" />\n    <Unknown4C value=\"150\" />\n    <Unknown50 value=\"6.2831855\" />\n    <Unknown54 value=\"1\" />\n");
            sb.Append("    " + V("InertiaTensor", itot) + "\n    " + V("InertiaTensorInv", new Vector3(1f / itot.X, 1f / itot.Y, 1f / itot.Z)) + "\n");
            sb.Append("    <Bounds type=\"Composite\">");
            sb.Append(V("BoxMin", bMin)).Append(V("BoxMax", bMax)).Append(V("BoxCenter", bc)).Append(V("SphereCenter", com));
            sb.Append($"<SphereRadius value=\"{F((bMax - bMin).Length() * 0.5f + (com - bc).Length())}\" /><Margin value=\"0\" /><Volume value=\"{F(vol)}\" />");
            sb.Append("<Inertia x=\"1\" y=\"1\" z=\"1\" /><MaterialIndex value=\"0\" /><MaterialColourIndex value=\"0\" /><ProceduralID value=\"0\" /><RoomID value=\"0\" /><PedDensity value=\"0\" /><UnkFlags value=\"0\" /><PolyFlags value=\"0\" /><UnkType value=\"2\" /><Children>");
            foreach (var b in bodies) sb.Append(Animated.BoxChild(b.mn, b.mx, mat));
            sb.Append("</Children></Bounds>\n   </Archetype>\n   <Transforms>\n");
            foreach (var b in bodies) { var t = (b.mn + b.mx) * 0.5f - com; sb.Append($"    <Item>1 0 0 0\n0 1 0 0\n0 0 1 0\n{F(t.X)} {F(t.Y)} {F(t.Z)} 0</Item>\n"); }
            sb.Append("   </Transforms>\n   <Groups>\n");
            sb.Append(Group(name.Length > 30 ? name.Substring(0, 30) : name, 255, -1f, bodies[0].mass));
            for (int i = 1; i < bodies.Count; i++) sb.Append(Group($"piece_{i:000}", 0, strength, bodies[i].mass));
            sb.Append("   </Groups>\n   <Children>\n");
            foreach (var b in bodies)
                sb.Append(Child(b.group, b.tag, b.mass, b.group == 0 ? 400f : strength, Animated.BoxInertia(b.mx - b.mn, b.mass), (b.mn + b.mx) * 0.5f - b.bone));
            sb.Append("   </Children>\n  </LOD1>\n </Physics>\n <Lights />\n</Fragment>\n");
            return sb.ToString();
        }

        static string YtypXml(string ytypName, string arch, string model, JsonObject y, uint flags, Vector3 bbMin, Vector3 bbMax, Vector3 centre, float radius)
        {
            float lod = (float?)y["lodDist"] ?? 150f;
            float hd = (float?)y["hdTextureDist"] ?? 15f;
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapTypes>\n <extensions />\n <archetypes>\n  <Item type=\"CBaseArchetypeDef\">\n");
            sb.Append($"   <lodDist value=\"{F(lod)}\" />\n   <flags value=\"{flags}\" />\n   <specialAttribute value=\"0\" />\n");
            sb.Append("   " + V("bbMin", bbMin) + "\n   " + V("bbMax", bbMax) + "\n   " + V("bsCentre", centre) + "\n");
            sb.Append($"   <bsRadius value=\"{F(radius)}\" />\n   <hdTextureDist value=\"{F(hd)}\" />\n");
            sb.Append($"   <name>{arch}</name>\n   <textureDictionary />\n   <clipDictionary />\n   <drawableDictionary />\n");
            sb.Append($"   <physicsDictionary>{arch}</physicsDictionary>\n   <assetType>ASSET_TYPE_FRAGMENT</assetType>\n   <assetName>{model}</assetName>\n   <extensions />\n");
            sb.Append("  </Item>\n </archetypes>\n");
            sb.Append($" <name>{ytypName}</name>\n <dependencies />\n <compositeEntityTypes />\n</CMapTypes>\n");
            return sb.ToString();
        }

        static void Verify(byte[] yft, int pieces)
        {
            var f = new YftFile(); RpfFile.LoadResourceFile(f, yft, 162);
            var lod = f.Fragment?.PhysicsLODGroup?.PhysicsLOD1;
            var bones = f.Fragment?.Drawable?.Skeleton?.Bones?.Items;
            var models = f.Fragment?.Drawable?.DrawableModels?.High;
            if (bones == null || bones.Length != pieces + 1) throw new Exception("YFT check failed: skeleton");
            if (models == null || models.Length != pieces) throw new Exception("YFT check failed: piece models");
            var groups = lod?.Groups?.data_items; var children = lod?.Children?.data_items;
            if (groups == null || groups.Length != pieces + 1 || groups[0].ParentIndex != 255 || groups.Skip(1).Any(g => g.ParentIndex != 0 || g.Strength <= 0)) throw new Exception("YFT check failed: groups");
            if (children == null || children.Length != pieces + 1) throw new Exception("YFT check failed: children");
            for (int i = 1; i < children.Length; i++)
                if (children[i].GroupIndex != i || children[i].BoneTag != bones[i].Tag) throw new Exception("YFT check failed: child " + i);
            if (!(lod.Archetype1?.Bound is BoundComposite bc) || (bc.Children?.data_items?.Length ?? 0) != pieces + 1) throw new Exception("YFT check failed: bounds");
        }
    }
}

// Animated door export: the door becomes a GTA fragment (.yft) driven by its own clip (.ycd),
// with an expression (.yed) so the collision follows the animation, and a fragment archetype (.ytyp).
//
//   bone 0  root  (tag 0)    group 0 (parent 255)  tiny fixed collision at the pivot
//   bone 1  door  (tag T)    group 1 (parent 0)    the door leaf + its box collision
//
// Rules taken from working vanilla / tested props:
//  - two groups minimum: the root group is the entity body and never follows a bone
//  - clips <name>_open / <name>_close (never the model name), Hash + AnimationHash set, Track 0/1/2 for every bone
//  - yed: Tracks = (T, 1, quaternion), Streams empty, Signature 3140693525, Unk7C 3
//  - ytyp: ASSET_TYPE_FRAGMENT, flags 537526816 (vanilla animated fragment 537526784 = Has Anim + Dynamic + Auto Start Anim
//          + Use Ambient Scale, plus Static 32 so it never falls), clipDictionary,
//          physicsDictionary = itself, expression extension with bare names, bbox covers the whole motion
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
    public static class Animated
    {
        public const uint FragFlags = 537526816;          // 536870912 Use Ambient Scale + 524288 Auto Start Anim + 131072 Dynamic + 512 Has Anim (YCD) + 32 Static
        const uint YedSignature = 3140693525;
        const string AnimUnk1C = "hash_22E95D79";
        const string PropTypeFlags = "OBJECT";
        const string PropIncludeFlags = "MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE, VEHICLE_NOT_BVH, VEHICLE_BVH, PED, RAGDOLL, ANIMAL, ANIMAL_RAGDOLL, OBJECT, PLANT, PROJECTILE, EXPLOSION, FORKLIFT_FORKS, TEST_WEAPON, TEST_CAMERA, TEST_AI, TEST_SCRIPT, TEST_VEHICLE_WHEEL, GLASS";

        static string F(float f) => f.ToString("R", CultureInfo.InvariantCulture);
        static string V(string tag, Vector3 v) => $"<{tag} x=\"{F(v.X)}\" y=\"{F(v.Y)}\" z=\"{F(v.Z)}\" />";

        // ------------------------------------------------------------------ motion
        public class Motion
        {
            public string Kind = "rotate";
            public Vector3 Axis = Vector3.UnitZ, Center = Vector3.Zero, Offset = Vector3.Zero;
            public float Angle, Duration = 1.5f;
            public static float Ease(float t) => t < 0.5f ? 2 * t * t : 1 - (float)Math.Pow(-2 * t + 2, 2) / 2;
            public Quaternion Rot(float u)
            {
                var ax = Axis.Length() < 1e-6f ? Vector3.UnitZ : Vector3.Normalize(Axis);
                var a = MathUtil.DegreesToRadians(Angle * Ease(u));
                return Quaternion.RotationAxis(ax, a);
            }
            public Vector3 Pos(float u) => (Center - Vector3.Transform(Center, Rot(u))) + Offset * Ease(u);
            public Vector3 Apply(Vector3 p, float u) => Vector3.Transform(p, Rot(u)) + Pos(u);
            public bool Rotates => Math.Abs(Angle) > 1e-4f;
            public bool Moves => (Center - Vector3.Transform(Center, Rot(1))).Length() > 1e-5f || Offset.Length() > 1e-5f;
        }

        static Motion ReadMotion(JsonObject a)
        {
            var m = new Motion
            {
                Kind = (string)a["kind"] ?? "rotate",
                Axis = Util.ReadV3(a["axis"], Vector3.UnitZ),
                Center = Util.ReadV3(a["center"]),
                Offset = Util.ReadV3(a["offset"]),
                Angle = (float?)a["angle"] ?? 0f,
                Duration = Math.Max(0.2f, Math.Min(20f, (float?)a["duration"] ?? 1.5f)),
            };
            if (!m.Rotates && !m.Moves) throw new Exception("This door has no motion to animate (angle / distance is 0).");
            return m;
        }

        // one clip = baked frames of the door bone (rotation + position, model space)
        public class Clip
        {
            public string Name;
            public float Fps = 30f;
            public Quaternion[] Q;
            public Vector3[] P;
            public float Duration => (Q.Length - 1) / Fps;
        }

        static Clip MotionClip(Motion m, string name, bool closing)
        {
            float fps = Math.Min(30f, 240f / m.Duration);
            int frames = Math.Max(2, (int)Math.Round(m.Duration * fps) + 1);
            var c = new Clip { Name = name, Fps = fps, Q = new Quaternion[frames], P = new Vector3[frames] };
            for (int i = 0; i < frames; i++)
            {
                float u = i / (float)(frames - 1); if (closing) u = 1 - u;
                c.Q[i] = m.Rot(u); c.P[i] = m.Pos(u);
            }
            return c;
        }

        // custom animation: frames sampled by the app ([qx,qy,qz,qw,px,py,pz] per frame)
        static Clip SampledClip(JsonObject s, string name)
        {
            float fps = (float?)s["fps"] ?? 30f;
            var fr = s["frames"] as JsonArray ?? throw new Exception("Animation has no frames");
            if (fr.Count < 2) throw new Exception("Animation needs at least 2 frames");
            if (fr.Count > 3600) throw new Exception("Animation is too long (max 2 minutes at 30 fps)");
            var c = new Clip { Name = name, Fps = fps, Q = new Quaternion[fr.Count], P = new Vector3[fr.Count] };
            for (int i = 0; i < fr.Count; i++)
            {
                var a = (fr[i] as JsonArray).Select(x => (float)x).ToArray();
                c.Q[i] = Quaternion.Normalize(new Quaternion(a[0], a[1], a[2], a[3]));
                c.P[i] = new Vector3(a[4], a[5], a[6]);
            }
            return c;
        }

        // ------------------------------------------------------------------ entry
        public static JsonNode Export(JsonObject req)
        {
            var src = (string)req["source"];
            var outDir = (string)req["outDir"];
            var name = Exporter.San((string)req["name"] ?? Path.GetFileNameWithoutExtension(src));
            var pivot = Util.ReadV3(req["pivot"]);
            var anim = req["anim"] as JsonObject;
            var col = req["collision"] as JsonObject ?? new JsonObject { ["mode"] = "auto", ["shape"] = "box" };
            var y = req["ytyp"] as JsonObject ?? new JsonObject();
            var outputs = req["outputs"] as JsonObject ?? new JsonObject();
            bool wantModel = (bool?)outputs["ydr"] ?? true, wantYtyp = (bool?)outputs["ytyp"] ?? true;
            var dict = Exporter.San((string)anim["dict"] ?? (name + "_anim"));
            if (dict == name) dict = name + "_anim";
            // door: two clips played by Lua. custom: ONE clip named like the model - GTA auto-starts and loops it (no script)
            bool custom = anim["samples"] is JsonObject;
            var clips = new List<Clip>();
            if (custom) clips.Add(SampledClip((JsonObject)anim["samples"], Exporter.San((string)y["archetypeName"] ?? name)));  // auto start plays the clip named like the archetype
            else
            {
                var motion = ReadMotion(anim);
                clips.Add(MotionClip(motion, name + "_open", false));
                clips.Add(MotionClip(motion, name + "_close", true));
            }
            bool moves = clips.Any(c => c.P.Any(v => v.Length() > 1e-5f));
            ushort tag = BoneTag(name);
            Directory.CreateDirectory(outDir);
            var warnings = new JsonArray();
            var files = new JsonArray();

            var ydr = Loader.ReadYdr(src);
            var d = ydr.Drawable;
            if (pivot != Vector3.Zero) Exporter.TranslateDrawable(d, -pivot);
            d.Name = name;

            // collision -> one box for the door leaf (fragment children must follow the bone)
            int mat = (int?)col["material"] ?? 70;
            var bound = Exporter.BuildCollision(col, d, pivot, warnings);
            Vector3 cMin, cMax;
            if (bound == null) { cMin = d.BoundingBoxMin; cMax = d.BoundingBoxMax; warnings.Add("Animated door: collision NONE is not possible for a fragment - a box was used."); }
            else
            {
                cMin = bound.BoxMin; cMax = bound.BoxMax;
                var mode = ((string)col["mode"] ?? "auto").ToLowerInvariant();
                var shape = ((string)col["shape"] ?? "box").ToLowerInvariant();
                if (mode == "keep" || mode == "import" || shape == "convex") warnings.Add("Animated door: the collision is the bounding box of your collision (fragment box).");
            }
            d.Bound = null;

            // swept bounds: the archetype / drawable box must contain the whole motion
            var (sMin, sMax) = Swept(clips, Vector3.Min(d.BoundingBoxMin, cMin), Vector3.Max(d.BoundingBoxMax, cMax));

            var texDir = Path.Combine(Path.GetTempPath(), "gdc_anim_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(texDir);
            try
            {
                if (wantModel)
                {
                    // .yft
                    var fragXml = BuildFragmentXml(ydr, name, tag, cMin, cMax, mat, sMin, sMax, texDir);
                    var fdoc = new XmlDocument(); fdoc.LoadXml(fragXml);
                    var yftBytes = XmlMeta.GetYftData(fdoc, texDir) ?? throw new Exception("YFT build failed");
                    var yftPath = Path.Combine(outDir, name + ".yft");
                    File.WriteAllBytes(yftPath, yftBytes);
                    files.Add(yftPath);
                    if ((bool?)req["writeXml"] ?? false) File.WriteAllText(yftPath + ".xml", fragXml);

                    // .ycd
                    var ycdXml = BuildYcdXml(clips, tag);
                    var cdoc = new XmlDocument(); cdoc.LoadXml(ycdXml);
                    var ycdBytes = XmlMeta.GetYcdData(cdoc) ?? throw new Exception("YCD build failed");
                    var ycdPath = Path.Combine(outDir, dict + ".ycd");
                    File.WriteAllBytes(ycdPath, ycdBytes);
                    files.Add(ycdPath);
                    if ((bool?)req["writeXml"] ?? false) File.WriteAllText(ycdPath + ".xml", ycdXml);

                    // .yed
                    var yedXml = BuildYedXml(name, tag, moves);
                    var edoc = new XmlDocument(); edoc.LoadXml(yedXml);
                    var yedBytes = XmlMeta.GetYedData(edoc, "") ?? throw new Exception("YED build failed");
                    var yedPath = Path.Combine(outDir, name + ".yed");
                    File.WriteAllBytes(yedPath, yedBytes);
                    files.Add(yedPath);

                    Verify(yftBytes, ycdBytes, yedBytes, name, tag, clips.Select(c => c.Name).ToArray(), warnings);
                }
            }
            finally { try { Directory.Delete(texDir, true); } catch { } }

            var centre = (sMin + sMax) * 0.5f;
            var radius = (sMax - sMin).Length() * 0.5f;
            var info = new JsonObject
            {
                ["bbMin"] = Util.V3(sMin), ["bbMax"] = Util.V3(sMax), ["bsCentre"] = Util.V3(centre), ["bsRadius"] = Util.R(radius),
                ["dict"] = dict, ["clips"] = new JsonArray(clips.Select(c => (JsonNode)c.Name).ToArray()), ["boneTag"] = tag,
                ["duration"] = Util.R(clips[0].Duration), ["autoStart"] = custom
            };
            if (wantYtyp)
            {
                var ytypName = Exporter.San((string)y["ytypName"] ?? name);
                var arch = Exporter.San((string)y["archetypeName"] ?? name);
                var xml = BuildYtypXml(ytypName, arch, name, dict, y, sMin, sMax, centre, radius);
                var doc = new XmlDocument(); doc.LoadXml(xml);
                var data = XmlMeta.GetData(doc, MetaFormat.RSC, "") ?? throw new Exception("YTYP build failed");
                var p = Path.Combine(outDir, ytypName + ".ytyp");
                File.WriteAllBytes(p, data);
                files.Add(p);
                VerifyYtyp(data, arch, name, dict, warnings);
                if ((bool?)req["writeXml"] ?? false) File.WriteAllText(p + ".xml", xml);
            }
            return new JsonObject { ["files"] = files, ["archetype"] = info, ["warnings"] = warnings };
        }

        public static ushort BoneTag(string name) => (ushort)(1000 + JenkHash.GenHash(name + "_door") % 60000);

        static (Vector3, Vector3) Swept(List<Clip> clips, Vector3 mn, Vector3 mx)
        {
            var corners = new List<Vector3>();
            for (int i = 0; i < 8; i++) corners.Add(new Vector3((i & 1) != 0 ? mx.X : mn.X, (i & 2) != 0 ? mx.Y : mn.Y, (i & 4) != 0 ? mx.Z : mn.Z));
            Vector3 a = mn, b = mx;
            foreach (var cl in clips)
                for (int f = 0; f < cl.Q.Length; f++)
                    foreach (var c in corners) { var p = Vector3.Transform(c, cl.Q[f]) + cl.P[f]; a = Vector3.Min(a, p); b = Vector3.Max(b, p); }
            return (a, b);
        }

        // ------------------------------------------------------------------ .yft
        static string Mat43(Vector3 t) => $"1 0 0\n0 1 0\n0 0 1\n{F(t.X)} {F(t.Y)} {F(t.Z)}";

        static Vector3 BoxInertia(Vector3 s, float m) => new Vector3(m * (s.Y * s.Y + s.Z * s.Z) / 12f, m * (s.X * s.X + s.Z * s.Z) / 12f, m * (s.X * s.X + s.Y * s.Y) / 12f);

        static string BoxChild(Vector3 mn, Vector3 mx, int mat)
        {
            var s = mx - mn; var h = s * 0.5f; var c = (mn + mx) * 0.5f;
            float margin = Math.Min(0.04f, Math.Max(0.005f, Math.Min(s.X, Math.Min(s.Y, s.Z)) * 0.25f));
            var vol = s.X * s.Y * s.Z;
            var sb = new StringBuilder();
            sb.Append("<Item type=\"Box\">");
            sb.Append(V("BoxMin", -h)).Append(V("BoxMax", h)).Append(V("BoxCenter", Vector3.Zero)).Append(V("SphereCenter", Vector3.Zero));
            sb.Append($"<SphereRadius value=\"{F(h.Length())}\" /><Margin value=\"{F(margin)}\" /><Volume value=\"{F(vol)}\" />");
            sb.Append(V("Inertia", BoxInertia(s, 1f)));
            sb.Append($"<MaterialIndex value=\"{mat}\" /><MaterialColourIndex value=\"0\" /><ProceduralID value=\"0\" /><RoomID value=\"0\" /><PedDensity value=\"0\" /><UnkFlags value=\"0\" /><PolyFlags value=\"0\" /><UnkType value=\"2\" />");
            sb.Append($"<CompositeTransform>1 0 0 0 0 1 0 0 0 0 1 0 {F(c.X)} {F(c.Y)} {F(c.Z)} 1</CompositeTransform>");
            sb.Append($"<CompositeFlags1>{PropTypeFlags}</CompositeFlags1><CompositeFlags2>{PropIncludeFlags}</CompositeFlags2>");
            sb.Append("</Item>");
            return sb.ToString();
        }

        static string BuildFragmentXml(YdrFile ydr, string name, ushort tag, Vector3 cMin, Vector3 cMax, int mat, Vector3 sMin, Vector3 sMax, string texDir)
        {
            // drawable XML from the re-pivoted ydr
            var dxml = YdrXml.GetXml(ydr, texDir);
            var ddoc = new XmlDocument(); ddoc.LoadXml(dxml);
            var dr = ddoc.DocumentElement; // <Drawable>
            foreach (var n in new[] { "Bounds", "Skeleton", "Joints", "Lights" })
                foreach (XmlNode x in dr.SelectNodes(n).Cast<XmlNode>().ToList()) dr.RemoveChild(x);
            void Set(string tagName, string attr, string val) { var e = dr.SelectSingleNode(tagName) as XmlElement; if (e != null) e.SetAttribute(attr, val); }
            var sc = (sMin + sMax) * 0.5f; var sr = (sMax - sMin).Length() * 0.5f;
            Set("BoundingSphereCenter", "x", F(sc.X)); Set("BoundingSphereCenter", "y", F(sc.Y)); Set("BoundingSphereCenter", "z", F(sc.Z));
            Set("BoundingSphereRadius", "value", F(sr));
            Set("BoundingBoxMin", "x", F(sMin.X)); Set("BoundingBoxMin", "y", F(sMin.Y)); Set("BoundingBoxMin", "z", F(sMin.Z));
            Set("BoundingBoxMax", "x", F(sMax.X)); Set("BoundingBoxMax", "y", F(sMax.Y)); Set("BoundingBoxMax", "z", F(sMax.Z));
            // every model is rigidly bound to the door bone (index 1)
            foreach (var lod in new[] { "DrawableModelsHigh", "DrawableModelsMedium", "DrawableModelsLow", "DrawableModelsVeryLow" })
                foreach (XmlElement it in dr.SelectNodes(lod + "/Item"))
                {
                    (it.SelectSingleNode("HasSkin") as XmlElement)?.SetAttribute("value", "0");
                    (it.SelectSingleNode("BoneIndex") as XmlElement)?.SetAttribute("value", "1");
                }
            // matrix (FragDrawable) after <Name>
            var nameNode = dr.SelectSingleNode("Name");
            var mEl = ddoc.CreateElement("Matrix"); mEl.InnerText = Mat43(Vector3.Zero);
            dr.InsertAfter(mEl, nameNode);
            // skeleton after the shader group
            var skelDoc = new XmlDocument(); skelDoc.LoadXml(SkeletonXml(name, tag));
            var skel = ddoc.ImportNode(skelDoc.DocumentElement, true);
            var sg = dr.SelectSingleNode("ShaderGroup");
            if (sg != null) dr.InsertAfter(skel, sg); else dr.InsertAfter(skel, mEl);

            // physics: child 0 = root (tiny box at the pivot), child 1 = door leaf
            var s = cMax - cMin;
            float doorVol = Math.Max(1e-4f, s.X * s.Y * s.Z);
            float doorMass = Math.Max(10f, Math.Min(3000f, doorVol * 500f));
            float rootMass = Math.Max(1f, doorMass * 0.05f);
            Vector3 rMin = new Vector3(-0.02f), rMax = new Vector3(0.02f);
            var cRoot = Vector3.Zero;
            var cDoor = (cMin + cMax) * 0.5f;
            var iRoot = BoxInertia(rMax - rMin, rootMass); var iDoor = BoxInertia(s, doorMass);
            float total = rootMass + doorMass;
            var com = (cRoot * rootMass + cDoor * doorMass) / total;
            Vector3 Par(Vector3 r, float m) => new Vector3(m * (r.Y * r.Y + r.Z * r.Z), m * (r.X * r.X + r.Z * r.Z), m * (r.X * r.X + r.Y * r.Y));
            var itot = iRoot + Par(cRoot - com, rootMass) + iDoor + Par(cDoor - com, doorMass);
            var bMin = Vector3.Min(rMin, cMin); var bMax = Vector3.Max(rMax, cMax);
            var bc = (bMin + bMax) * 0.5f;
            float unk18 = Math.Max(iDoor.X, Math.Max(iDoor.Y, iDoor.Z));

            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Fragment>\n");
            sb.Append($" <Name>pack:/{name}</Name>\n");
            sb.Append(" " + V("BoundingSphereCenter", sc) + $"\n <BoundingSphereRadius value=\"{F(sr)}\" />\n");
            sb.Append(" <UnknownB0 value=\"0\" />\n <UnknownB8 value=\"0\" />\n <UnknownBC value=\"0\" />\n <UnknownC0 value=\"65280\" />\n <UnknownC4 value=\"1\" />\n <UnknownCC value=\"0\" />\n");
            sb.Append(" <GravityFactor value=\"1\" />\n <BuoyancyFactor value=\"1\" />\n");
            sb.Append(dr.OuterXml).Append('\n');
            sb.Append(" <BoneTransforms unk=\"0\">\n  <Item>1 0 0 0\n0 1 0 0\n0 0 1 0</Item>\n  <Item>1 0 0 0\n0 1 0 0\n0 0 1 0</Item>\n </BoneTransforms>\n");
            sb.Append(" <Physics>\n  <LOD1>\n");
            sb.Append($"   <Unknown14 value=\"{F(unk18 / 10000f)}\" />\n   <Unknown18 value=\"{F(unk18)}\" />\n   <Unknown1C value=\"-1\" />\n");
            sb.Append("   " + V("PositionOffset", com) + "\n   " + V("Unknown40", com) + "\n   " + V("Unknown50", Vector3.Zero) + "\n");
            sb.Append("   <DampingLinearC x=\"0.02\" y=\"0.02\" z=\"0.02\" />\n   <DampingLinearV x=\"0.02\" y=\"0.02\" z=\"0.02\" />\n   <DampingLinearV2 x=\"0.01\" y=\"0.01\" z=\"0.01\" />\n");
            sb.Append("   <DampingAngularC x=\"0.02\" y=\"0.02\" z=\"0.02\" />\n   <DampingAngularV x=\"0.02\" y=\"0.02\" z=\"0.02\" />\n   <DampingAngularV2 x=\"0.01\" y=\"0.01\" z=\"0.01\" />\n");
            sb.Append("   <Archetype>\n");
            sb.Append($"    <Name>{name}</Name>\n    <Mass value=\"{F(total)}\" />\n    <MassInv value=\"{F(1f / total)}\" />\n");
            sb.Append("    <Unknown48 value=\"1\" />\n    <Unknown4C value=\"150\" />\n    <Unknown50 value=\"6.2831855\" />\n    <Unknown54 value=\"1\" />\n");
            sb.Append("    " + V("InertiaTensor", itot) + "\n    " + V("InertiaTensorInv", new Vector3(1f / itot.X, 1f / itot.Y, 1f / itot.Z)) + "\n");
            sb.Append("    <Bounds type=\"Composite\">");
            sb.Append(V("BoxMin", bMin)).Append(V("BoxMax", bMax)).Append(V("BoxCenter", bc)).Append(V("SphereCenter", com));
            sb.Append($"<SphereRadius value=\"{F((bMax - bMin).Length() * 0.5f + (com - bc).Length())}\" /><Margin value=\"0\" /><Volume value=\"{F(doorVol)}\" />");
            sb.Append("<Inertia x=\"1\" y=\"1\" z=\"1\" /><MaterialIndex value=\"0\" /><MaterialColourIndex value=\"0\" /><ProceduralID value=\"0\" /><RoomID value=\"0\" /><PedDensity value=\"0\" /><UnkFlags value=\"0\" /><PolyFlags value=\"0\" /><UnkType value=\"2\" />");
            sb.Append("<Children>").Append(BoxChild(rMin, rMax, mat)).Append(BoxChild(cMin, cMax, mat)).Append("</Children></Bounds>\n");
            sb.Append("   </Archetype>\n");
            sb.Append("   <Transforms>\n");
            foreach (var c in new[] { cRoot, cDoor }) { var t = c - com; sb.Append($"    <Item>1 0 0 0\n0 1 0 0\n0 0 1 0\n{F(t.X)} {F(t.Y)} {F(t.Z)} 0</Item>\n"); }
            sb.Append("   </Transforms>\n   <Groups>\n");
            sb.Append(GroupXml(name.Length > 30 ? name.Substring(0, 30) : name, 255, rootMass));
            sb.Append(GroupXml("door", 0, doorMass));
            sb.Append("   </Groups>\n   <Children>\n");
            sb.Append(ChildXml(0, 0, rootMass, iRoot, cRoot));
            sb.Append(ChildXml(1, tag, doorMass, iDoor, cDoor));
            sb.Append("   </Children>\n  </LOD1>\n </Physics>\n <Lights />\n</Fragment>\n");
            return sb.ToString();
        }

        static string SkeletonXml(string name, ushort tag)
        {
            const string rootFlags = "RotX, RotY, RotZ, TransX, TransY, TransZ, Unk0";
            const string doorFlags = "RotX, RotY, RotZ, TransX, TransY, TransZ, ScaleX, ScaleY, ScaleZ";
            string bone(string n, int t, int idx, int parent, string flags) =>
                $"<Item><Name>{n}</Name><Tag value=\"{t}\" /><Index value=\"{idx}\" /><ParentIndex value=\"{parent}\" /><SiblingIndex value=\"-1\" /><Flags>{flags}</Flags>" +
                "<Translation x=\"0\" y=\"0\" z=\"0\" /><Rotation x=\"0\" y=\"0\" z=\"0\" w=\"1\" /><Scale x=\"1\" y=\"1\" z=\"1\" /><TransformUnk x=\"0\" y=\"4\" z=\"-3\" w=\"0\" /></Item>";
            // skeleton signatures (same idea as Sollumz: hashes of tags/flags/transforms; the game only needs them consistent)
            string s50 = $"0 {rootFlags} {tag} {doorFlags}";
            string s58 = $"0 {rootFlags} 0 0 0 0 0 0 1 1 1 1 {tag} {doorFlags} 0 0 0 0 0 0 1 1 1 1";
            uint u50 = JenkHash.GenHash(s50), u54 = Crc32(s50), u58 = Crc32(s58);
            return $"<Skeleton><Unknown1C value=\"16777216\" /><Unknown50 value=\"{u50}\" /><Unknown54 value=\"{u54}\" /><Unknown58 value=\"{u58}\" /><Bones>" +
                bone(name, 0, 0, -1, rootFlags) + bone("door", tag, 1, 0, doorFlags) + "</Bones></Skeleton>";
        }

        static uint Crc32(string s)
        {
            uint crc = 0xFFFFFFFF;
            foreach (var b in Encoding.UTF8.GetBytes(s))
            {
                crc ^= b;
                for (int k = 0; k < 8; k++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
            }
            return ~crc;
        }

        static string GroupXml(string n, int parent, float mass) =>
            $"    <Item><Name>{n}</Name><ParentIndex value=\"{parent}\" /><GlassWindowIndex value=\"0\" /><GlassFlags value=\"0\" /><Strength value=\"-1\" />" +
            "<ForceTransmissionScaleUp value=\"0.25\" /><ForceTransmissionScaleDown value=\"0.25\" /><JointStiffness value=\"0\" /><MinSoftAngle1 value=\"-1\" /><MaxSoftAngle1 value=\"1\" /><MaxSoftAngle2 value=\"1\" /><MaxSoftAngle3 value=\"1\" />" +
            "<RotationSpeed value=\"0\" /><RotationStrength value=\"0\" /><RestoringStrength value=\"0\" /><RestoringMaxTorque value=\"0\" /><LatchStrength value=\"0\" />" +
            $"<Mass value=\"{F(mass)}\" /><MinDamageForce value=\"100\" /><DamageHealth value=\"1000\" /><UnkFloat5C value=\"0\" /><UnkFloat60 value=\"1\" /><UnkFloat64 value=\"1\" /><UnkFloat68 value=\"1\" /><UnkFloat6C value=\"1\" /><UnkFloat70 value=\"1\" /><UnkFloat74 value=\"1\" /><UnkFloat78 value=\"1\" /><UnkFloatA8 value=\"1\" /></Item>\n";

        static string ChildXml(int group, int tag, float mass, Vector3 inertia, Vector3 pos) =>
            $"    <Item><GroupIndex value=\"{group}\" /><BoneTag value=\"{tag}\" /><PristineMass value=\"{F(mass)}\" /><DamagedMass value=\"{F(mass)}\" /><UnkFloat value=\"3.4028235E+38\" />" +
            $"<UnkVec x=\"0\" y=\"0\" z=\"0\" w=\"0\" /><InertiaTensor x=\"{F(inertia.X)}\" y=\"{F(inertia.Y)}\" z=\"{F(inertia.Z)}\" w=\"0\" /><EventSet />" +
            $"<Drawable><Name /><Matrix>{Mat43(pos)}</Matrix><BoundingSphereCenter x=\"0\" y=\"0\" z=\"0\" /><BoundingSphereRadius value=\"0\" /><BoundingBoxMin x=\"0\" y=\"0\" z=\"0\" /><BoundingBoxMax x=\"0\" y=\"0\" z=\"0\" />" +
            "<LodDistHigh value=\"0\" /><LodDistMed value=\"0\" /><LodDistLow value=\"0\" /><LodDistVlow value=\"0\" /><FlagsHigh value=\"0\" /><FlagsMed value=\"0\" /><FlagsLow value=\"0\" /><FlagsVlow value=\"0\" /></Drawable></Item>\n";

        // ------------------------------------------------------------------ .ycd
        static string FloatChannel(float[] vals)
        {
            float mn = vals.Min(), mx = vals.Max();
            if (mx - mn < 1e-6f) return $"<Item><Type value=\"StaticFloat\" /><Value value=\"{F(vals[0])}\" /></Item>";
            float q = (mx - mn) / 1048575f; // 20 bits
            var sb = new StringBuilder();
            sb.Append($"<Item><Type value=\"QuantizeFloat\" /><Quantum value=\"{F(q)}\" /><Offset value=\"{F(mn)}\" /><Values>");
            sb.Append(string.Join(" ", vals.Select(F)));
            sb.Append("</Values></Item>");
            return sb.ToString();
        }

        // Rotation channels: 3 stored components + CachedQuaternion1 (the 4th is rebuilt as +sqrt(1 - others²)).
        // Drop a component that keeps one sign over the whole clip so the stored values never jump
        // (a 360° spin about Z: w goes 1 -> -1 but z stays >= 0 -> drop z).
        static string RotationChannels(Quaternion[] qs)
        {
            var q = (Quaternion[])qs.Clone();
            for (int i = 1; i < q.Length; i++) if (Quaternion.Dot(q[i], q[i - 1]) < 0) q[i] = -q[i];
            // among the components that keep one sign, drop the biggest one (rebuilding a value near 0 amplifies quantization noise)
            int drop = -1; float best = -1; bool neg = false;
            foreach (var c in new[] { 3, 0, 1, 2 })
            {
                bool pos = q.All(v => v[c] >= -1e-6f), ng = q.All(v => v[c] <= 1e-6f);
                if (!pos && !ng) continue;
                float mag = q.Average(v => Math.Abs(v[c]));
                if (mag > best + 1e-4f) { best = mag; drop = c; neg = !pos; }
            }
            if (drop >= 0 && neg) for (int i = 0; i < q.Length; i++) q[i] = -q[i];
            if (drop < 0) { drop = 3; for (int i = 0; i < q.Length; i++) if (q[i].W < 0) q[i] = -q[i]; }
            var sb = new StringBuilder("<Item><Channels>");
            for (int c = 0; c < 4; c++) if (c != drop) sb.Append(FloatChannel(q.Select(v => v[c]).ToArray()));
            sb.Append($"<Item><Type value=\"CachedQuaternion1\" /><QuatIndex value=\"{drop}\" /></Item></Channels></Item>");
            return sb.ToString();
        }

        static string BuildYcdXml(List<Clip> clips, ushort tag)
        {
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ClipDictionary>\n <Clips>\n");
            foreach (var cl in clips)
            {
                var c = cl.Name;
                sb.Append($"  <Item><Hash>{c}</Hash><Name>pack:/{c}.clip</Name><Type value=\"Animation\" /><Unknown30 value=\"1\" /><Tags />");
                sb.Append("<Properties><Item><NameHash>hash_BF6A5D60</NameHash><UnkHash>hash_996C3B27</UnkHash><Attributes><Item><NameHash>hash_BF6A5D60</NameHash><Type value=\"Int\" /><Value value=\"32\" /></Item></Attributes></Item></Properties>");
                sb.Append($"<AnimationHash>{c}</AnimationHash><StartTime value=\"0\" /><EndTime value=\"{F(cl.Duration)}\" /><Rate value=\"1\" /></Item>\n");
            }
            sb.Append(" </Clips>\n <Animations>\n");
            foreach (var cl in clips)
            {
                var c = cl.Name; int frames = cl.Q.Length;
                var px = cl.P.Select(v => v.X).ToArray(); var py = cl.P.Select(v => v.Y).ToArray(); var pz = cl.P.Select(v => v.Z).ToArray();
                sb.Append($"  <Item><Hash>{c}</Hash><Unknown10 value=\"1\" /><FrameCount value=\"{frames}\" /><SequenceFrameLimit value=\"{frames + 30}\" /><Duration value=\"{F(cl.Duration)}\" /><Unknown1C>{AnimUnk1C}</Unknown1C>");
                sb.Append("<BoneIds>");
                foreach (var tr in new[] { 0, 1, 2 })
                    foreach (var b in new[] { 0, (int)tag })
                        sb.Append($"<Item><BoneId value=\"{b}\" /><Track value=\"{tr}\" /><Unk0 value=\"{(tr == 1 ? 1 : 0)}\" /></Item>");
                sb.Append("</BoneIds>");
                sb.Append($"<Sequences><Item><Hash>hash_{JenkHash.GenHash(c + "_seq"):X8}</Hash><FrameCount value=\"{frames}\" /><SequenceData>");
                string stat3(Vector3 v) => $"<Item><Channels><Item><Type value=\"StaticVector3\" /><Value x=\"{F(v.X)}\" y=\"{F(v.Y)}\" z=\"{F(v.Z)}\" /></Item></Channels></Item>";
                const string statQ = "<Item><Channels><Item><Type value=\"StaticQuaternion\" /><Value x=\"0\" y=\"0\" z=\"0\" w=\"1\" /></Item></Channels></Item>";
                // track 0 (position): root, door
                sb.Append(stat3(Vector3.Zero));
                if (px.Max() - px.Min() < 1e-6f && py.Max() - py.Min() < 1e-6f && pz.Max() - pz.Min() < 1e-6f) sb.Append(stat3(cl.P[0]));
                else sb.Append("<Item><Channels>" + FloatChannel(px) + FloatChannel(py) + FloatChannel(pz) + "</Channels></Item>");
                // track 1 (rotation): root, door
                sb.Append(statQ);
                bool still = cl.Q.All(v => Math.Abs(Quaternion.Dot(v, cl.Q[0])) > 0.9999999f);
                if (still)
                {
                    var q0 = cl.Q[0];
                    sb.Append($"<Item><Channels><Item><Type value=\"StaticQuaternion\" /><Value x=\"{F(q0.X)}\" y=\"{F(q0.Y)}\" z=\"{F(q0.Z)}\" w=\"{F(q0.W)}\" /></Item></Channels></Item>");
                }
                else sb.Append(RotationChannels(cl.Q));
                // track 2 (scale): root, door
                sb.Append(stat3(Vector3.One)).Append(stat3(Vector3.One));
                sb.Append("</SequenceData></Item></Sequences></Item>\n");
            }
            sb.Append(" </Animations>\n</ClipDictionary>\n");
            return sb.ToString();
        }

        // ------------------------------------------------------------------ .yed
        static string BuildYedXml(string name, ushort tag, bool moves)
        {
            var tracks = new StringBuilder();
            if (moves) tracks.Append($"<Item><BoneId value=\"{tag}\" /><Track value=\"0\" /><Format value=\"0\" /><UnkFlag value=\"False\" /></Item>");
            tracks.Append($"<Item><BoneId value=\"{tag}\" /><Track value=\"1\" /><Format value=\"1\" /><UnkFlag value=\"False\" /></Item>");
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ExpressionDictionary><Item>" +
                $"<Name>pack:/{name}.expr</Name><Signature value=\"{YedSignature}\" /><Unk7C value=\"3\" /><Tracks>{tracks}</Tracks>" +
                "</Item></ExpressionDictionary>";
        }

        // ------------------------------------------------------------------ .ytyp
        static string BuildYtypXml(string ytypName, string arch, string model, string dict, JsonObject y, Vector3 bbMin, Vector3 bbMax, Vector3 centre, float radius)
        {
            float lod = (float?)y["lodDist"] ?? 100f;
            float hd = (float?)y["hdTextureDist"] ?? 15f;
            uint flags = (uint?)y["flags"] ?? FragFlags;
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapTypes>\n <extensions />\n <archetypes>\n  <Item type=\"CBaseArchetypeDef\">\n");
            sb.Append($"   <lodDist value=\"{F(lod)}\" />\n   <flags value=\"{flags}\" />\n   <specialAttribute value=\"0\" />\n");
            sb.Append("   " + V("bbMin", bbMin) + "\n   " + V("bbMax", bbMax) + "\n   " + V("bsCentre", centre) + "\n");
            sb.Append($"   <bsRadius value=\"{F(radius)}\" />\n   <hdTextureDist value=\"{F(hd)}\" />\n");
            sb.Append($"   <name>{arch}</name>\n   <textureDictionary />\n   <clipDictionary>{dict}</clipDictionary>\n   <drawableDictionary />\n");
            sb.Append($"   <physicsDictionary>{arch}</physicsDictionary>\n   <assetType>ASSET_TYPE_FRAGMENT</assetType>\n   <assetName>{model}</assetName>\n");
            sb.Append("   <extensions>\n    <Item type=\"CExtensionDefExpression\">\n");
            sb.Append($"     <name>{model}</name>\n     <offsetPosition x=\"0\" y=\"0\" z=\"0\" />\n");
            sb.Append($"     <expressionDictionaryName>{model}</expressionDictionaryName>\n     <expressionName>{model}</expressionName>\n");
            sb.Append("     <creatureMetadataName />\n     <initialiseOnCollision value=\"false\" />\n    </Item>\n   </extensions>\n");
            sb.Append("  </Item>\n </archetypes>\n");
            sb.Append($" <name>{ytypName}</name>\n <dependencies />\n <compositeEntityTypes />\n</CMapTypes>\n");
            return sb.ToString();
        }

        // ------------------------------------------------------------------ read back
        static void Verify(byte[] yft, byte[] ycd, byte[] yed, string name, ushort tag, string[] clipNames, JsonArray warnings)
        {
            var f = new YftFile(); RpfFile.LoadResourceFile(f, yft, 162);
            var lod = f.Fragment?.PhysicsLODGroup?.PhysicsLOD1;
            var bones = f.Fragment?.Drawable?.Skeleton?.Bones?.Items;
            if (bones == null || bones.Length != 2 || bones[1].Tag != tag) throw new Exception("YFT check failed: skeleton");
            var groups = lod?.Groups?.data_items; var children = lod?.Children?.data_items;
            if (groups == null || groups.Length != 2 || groups[0].ParentIndex != 255 || groups[1].ParentIndex != 0) throw new Exception("YFT check failed: physics groups");
            if (children == null || children.Length != 2 || children[1].BoneTag != tag || children[1].GroupIndex != 1) throw new Exception("YFT check failed: physics children");
            if (!(lod.Archetype1?.Bound is BoundComposite bc) || (bc.Children?.data_items?.Length ?? 0) != 2) throw new Exception("YFT check failed: fragment bounds");

            var c = new YcdFile(); RpfFile.LoadResourceFile(c, ycd, 46);
            var cm = c.ClipMap; var am = c.AnimMap;
            if (cm == null || clipNames.Any(n => !cm.ContainsKey(JenkHash.GenHash(n)))) throw new Exception("YCD check failed: clips");
            if (am == null || am.Count != clipNames.Length) throw new Exception("YCD check failed: animations");
            foreach (var ca in cm.Values)
            {
                var anim = (ca.Clip as ClipAnimation)?.Animation;
                if (anim == null) throw new Exception("YCD check failed: clip without animation");
                if (anim.FindBoneIndex(tag, 1) < 0 || anim.FindBoneIndex(tag, 0) < 0) throw new Exception("YCD check failed: door bone track");
            }

            var e = new YedFile(); RpfFile.LoadResourceFile(e, yed, 25);
            var ex = e.ExpressionDictionary?.Expressions?.data_items;
            if (ex == null || ex.Length != 1 || ex[0].NameHash.Hash != JenkHash.GenHash(name)) throw new Exception("YED check failed");
            if (ex[0].Signature != YedSignature || !(ex[0].Tracks?.data_items?.Any(t => t.BoneId == tag && t.Track == 1) ?? false)) throw new Exception("YED check failed: tracks");
        }

        static void VerifyYtyp(byte[] data, string arch, string model, string dict, JsonArray warnings)
        {
            var y = new YtypFile(); y.Load(data);
            var a = y.AllArchetypes?.FirstOrDefault() ?? throw new Exception("YTYP check failed");
            var b = a._BaseArchetypeDef;
            if (b.assetType != rage__fwArchetypeDef__eAssetType.ASSET_TYPE_FRAGMENT) throw new Exception("YTYP check failed: asset type");
            if (b.clipDictionary.Hash != JenkHash.GenHash(dict)) throw new Exception("YTYP check failed: clip dictionary");
            var ext = a.Extensions?.OfType<MCExtensionDefExpression>().FirstOrDefault();
            if (ext == null) throw new Exception("YTYP check failed: expression extension missing");
            if (ext._Data.expressionDictionaryName.Hash != JenkHash.GenHash(model) || ext._Data.expressionName.Hash != JenkHash.GenHash(model))
                throw new Exception("YTYP check failed: expression names");
        }
    }
}

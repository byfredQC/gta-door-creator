// Destruct .ycd: instead of real physics, the pieces play a baked explosion clip that loops by itself
// (Auto Start Anim, no script):  intact -> explosion (pieces fly, spin, bounce on the ground) -> lie on the ground -> rebuild -> loop
//
// The motion is simulated here once (deterministic for a seed) and used both by the app preview and the export,
// so what the user sees in the app is exactly what GTA plays.
//   bone k translation = piece centre + offset(t), rotation = q(t) (the bone sits at the piece centre)
//   clip name = archetype name (auto start), dictionary = <name>_anim, .yed tracks every piece bone so the collision follows
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using CodeWalker.GameFiles;
using SharpDX;

namespace DoorCore
{
    public static class DestructAnim
    {
        public const float Fps = 30f;
        const int SeqLimit = 127;              // frames per sequence (vanilla clips are split the same way)
        const uint YedSignature = 3140693525;
        static string F(float f) => Animated.F(f);

        public class Sim
        {
            public int Frames;
            public float Duration => (Frames - 1) / Fps;
            public Vector3[][] Off;            // [piece][frame] offset from the rest centre
            public Quaternion[][] Rot;         // [piece][frame] rotation about the piece centre
            public float ExplodeAt, LandedAt, RebuildAt;
        }

        public static float ForceOf(JsonObject a)
        {
            var f = a?["force"];
            if (f is JsonValue v && v.TryGetValue<string>(out var s))
                return s switch { "light" => 4f, "strong" => 11f, "huge" => 16f, _ => 7f };
            return Math.Max(1f, Math.Min(40f, (float?)f ?? 7f));
        }

        // boxes in any space (only differences matter); the ground is the lowest point of the whole prop
        public static Sim Simulate(IList<(Vector3 mn, Vector3 mx)> boxes, JsonObject a, int seed)
        {
            a ??= new JsonObject();
            float force = ForceOf(a);
            float intact = Clamp((float?)a["intact"] ?? 1.5f, 0f, 20f);
            float rest = Clamp((float?)a["rest"] ?? 3f, 0f, 60f);
            float rebuild = Clamp((float?)a["rebuild"] ?? 1.5f, 0.3f, 20f);
            int n = boxes.Count;
            var gMin = boxes.Select(b => b.mn).Aggregate(Vector3.Min); var gMax = boxes.Select(b => b.mx).Aggregate(Vector3.Max);
            var size = gMax - gMin; float big = Math.Max(size.X, Math.Max(size.Y, size.Z));
            float ground = gMin.Z;
            // explosion origin: centre of the footprint, a bit under the middle height
            var origin = new Vector3((gMin.X + gMax.X) * 0.5f, (gMin.Y + gMax.Y) * 0.5f, gMin.Z + size.Z * 0.3f);
            float scale = (float)Math.Sqrt(Math.Max(1f, big / 4f));
            var rnd = new Random(seed * 104729 + 7);
            float R(float lo, float hi) => lo + (float)rnd.NextDouble() * (hi - lo);

            const float dt = 1f / 240f; const float g = 9.81f;
            int maxFly = (int)(6f * Fps);
            var pos = new Vector3[n]; var vel = new Vector3[n]; var w = new Vector3[n]; var q = new Quaternion[n]; var half = new Vector3[n];
            var settled = new bool[n];
            for (int i = 0; i < n; i++)
            {
                var c = (boxes[i].mn + boxes[i].mx) * 0.5f; half[i] = (boxes[i].mx - boxes[i].mn) * 0.5f;
                var d = c - origin; d.Z = Math.Max(d.Z, 0) + size.Z * 0.15f + 0.1f;
                if (d.LengthSquared() < 1e-6f) d = new Vector3(R(-1, 1), R(-1, 1), 1);
                d = Vector3.Normalize(d + new Vector3(R(-0.35f, 0.35f), R(-0.35f, 0.35f), R(0f, 0.4f)));
                vel[i] = d * force * scale * R(0.65f, 1.25f);
                var ax = new Vector3(R(-1, 1), R(-1, 1), R(-1, 1)); if (ax.LengthSquared() < 1e-4f) ax = Vector3.UnitX;
                w[i] = Vector3.Normalize(ax) * R(2f, 7f) * Math.Min(1.5f, force / 7f);
                q[i] = Quaternion.Identity;
            }
            var flyOff = new List<Vector3[]>(); var flyRot = new List<Quaternion[]>();
            var cent = boxes.Select(b => (b.mn + b.mx) * 0.5f).ToArray();
            int stepsPerFrame = (int)Math.Round(1f / (Fps * dt));
            for (int f = 0; f <= maxFly; f++)
            {
                flyOff.Add(pos.ToArray()); flyRot.Add(q.ToArray());
                if (f > 0 && settled.All(s => s)) break;
                for (int s = 0; s < stepsPerFrame; s++)
                    for (int i = 0; i < n; i++)
                    {
                        if (settled[i]) continue;
                        vel[i].Z -= g * dt;
                        pos[i] += vel[i] * dt;
                        float wl = w[i].Length();
                        if (wl > 1e-5f) q[i] = Quaternion.Normalize(Quaternion.RotationAxis(w[i] / wl, wl * dt) * q[i]);
                        // lowest point of the rotated piece box
                        var m = Matrix.RotationQuaternion(q[i]);
                        float low = Math.Abs(m.M13) * half[i].X + Math.Abs(m.M23) * half[i].Y + Math.Abs(m.M33) * half[i].Z;
                        float bottom = cent[i].Z + pos[i].Z - low;
                        if (bottom < ground)
                        {
                            pos[i].Z += ground - bottom;
                            if (vel[i].Z < 0) vel[i].Z = -vel[i].Z * 0.3f;
                            vel[i].X *= 1f - 6f * dt; vel[i].Y *= 1f - 6f * dt; w[i] *= 1f - 5f * dt;
                            if (vel[i].Length() < 0.25f + 0.05f * scale && w[i].Length() < 0.6f) settled[i] = true;
                        }
                    }
            }
            int fly = flyOff.Count;   // frames incl. the first (rest) one
            int iFr = (int)Math.Round(intact * Fps), rFr = (int)Math.Round(rest * Fps), bFr = Math.Max(2, (int)Math.Round(rebuild * Fps));
            int total = iFr + fly + rFr + bFr;   // last frame == first frame (seamless loop)
            var sim = new Sim { Frames = total, Off = new Vector3[n][], Rot = new Quaternion[n][], ExplodeAt = iFr / Fps, LandedAt = (iFr + fly - 1) / Fps, RebuildAt = (iFr + fly + rFr) / Fps };
            for (int i = 0; i < n; i++)
            {
                var o = new Vector3[total]; var r = new Quaternion[total];
                var endP = flyOff[fly - 1][i]; var endQ = flyRot[fly - 1][i];
                float lift = Math.Max(0.3f, half[i].Length());
                for (int f = 0; f < total; f++)
                {
                    if (f < iFr) { o[f] = Vector3.Zero; r[f] = Quaternion.Identity; }
                    else if (f < iFr + fly) { o[f] = flyOff[f - iFr][i]; r[f] = flyRot[f - iFr][i]; }
                    else if (f < iFr + fly + rFr) { o[f] = endP; r[f] = endQ; }
                    else
                    {
                        float u = (f - (iFr + fly + rFr) + 1) / (float)bFr;      // reaches 1 on the last frame
                        float e = u * u * (3 - 2 * u);
                        o[f] = Vector3.Lerp(endP, Vector3.Zero, e) + new Vector3(0, 0, (float)Math.Sin(Math.PI * e) * lift);
                        r[f] = Quaternion.Slerp(endQ, Quaternion.Identity, e);
                    }
                }
                o[total - 1] = Vector3.Zero; r[total - 1] = Quaternion.Identity;
                sim.Off[i] = o; sim.Rot[i] = r;
            }
            return sim;
        }
        static float Clamp(float v, float lo, float hi) => Math.Max(lo, Math.Min(hi, v));

        // swept box of every piece over the whole clip (silent rule: the bbox must cover the animation)
        public static (Vector3, Vector3) Swept(IList<(Vector3 mn, Vector3 mx)> boxes, Sim s)
        {
            Vector3 a = new Vector3(float.MaxValue), b = new Vector3(float.MinValue);
            for (int i = 0; i < boxes.Count; i++)
            {
                var c = (boxes[i].mn + boxes[i].mx) * 0.5f; var h = (boxes[i].mx - boxes[i].mn) * 0.5f;
                for (int f = 0; f < s.Frames; f++)
                    for (int k = 0; k < 8; k++)
                    {
                        var corner = new Vector3((k & 1) != 0 ? h.X : -h.X, (k & 2) != 0 ? h.Y : -h.Y, (k & 4) != 0 ? h.Z : -h.Z);
                        var p = c + s.Off[i][f] + Vector3.Transform(corner, s.Rot[i][f]);
                        a = Vector3.Min(a, p); b = Vector3.Max(b, p);
                    }
            }
            return (a, b);
        }

        // ------------------------------------------------------------------ app preview
        public static JsonNode Preview(JsonObject req)
        {
            var boxes = new List<(Vector3, Vector3)>();
            foreach (var p in req["pieces"] as JsonArray ?? throw new Exception("no pieces"))
                boxes.Add((Util.ReadV3(p["min"]), Util.ReadV3(p["max"])));
            if (boxes.Count == 0) throw new Exception("no pieces");
            var s = Simulate(boxes, req["anim"] as JsonObject, (int?)req["seed"] ?? 1);
            var arr = new JsonArray();
            for (int i = 0; i < boxes.Count; i++)
            {
                var fl = new float[s.Frames * 7];
                for (int f = 0; f < s.Frames; f++)
                {
                    var o = s.Off[i][f]; var q = s.Rot[i][f];
                    fl[f * 7] = o.X; fl[f * 7 + 1] = o.Y; fl[f * 7 + 2] = o.Z; fl[f * 7 + 3] = q.X; fl[f * 7 + 4] = q.Y; fl[f * 7 + 5] = q.Z; fl[f * 7 + 6] = q.W;
                }
                arr.Add(Util.B64(fl));
            }
            return new JsonObject { ["fps"] = Fps, ["frames"] = s.Frames, ["duration"] = Util.R(s.Duration), ["explodeAt"] = Util.R(s.ExplodeAt), ["landedAt"] = Util.R(s.LandedAt), ["rebuildAt"] = Util.R(s.RebuildAt), ["tracks"] = arr };
        }

        // ------------------------------------------------------------------ .ycd (one clip, every piece bone, split in sequences)
        public static string BuildYcdXml(string clip, ushort[] tags, Vector3[] centres, Sim s)
        {
            int frames = s.Frames;
            // bone order: root then piece tags ascending, same order for each track
            var order = Enumerable.Range(0, tags.Length).OrderBy(i => tags[i]).ToArray();
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ClipDictionary>\n <Clips>\n");
            sb.Append($"  <Item><Hash>{clip}</Hash><Name>pack:/{clip}.clip</Name><Type value=\"Animation\" /><Unknown30 value=\"1\" /><Tags />");
            sb.Append("<Properties><Item><NameHash>hash_BF6A5D60</NameHash><UnkHash>hash_996C3B27</UnkHash><Attributes><Item><NameHash>hash_BF6A5D60</NameHash><Type value=\"Int\" /><Value value=\"32\" /></Item></Attributes></Item></Properties>");
            sb.Append($"<AnimationHash>{clip}</AnimationHash><StartTime value=\"0\" /><EndTime value=\"{F(s.Duration)}\" /><Rate value=\"1\" /></Item>\n");
            sb.Append(" </Clips>\n <Animations>\n");
            sb.Append($"  <Item><Hash>{clip}</Hash><Unknown10 value=\"1\" /><FrameCount value=\"{frames}\" /><SequenceFrameLimit value=\"{SeqLimit}\" /><Duration value=\"{F(s.Duration)}\" /><Unknown1C>hash_22E95D79</Unknown1C>");
            sb.Append("<BoneIds>");
            foreach (var tr in new[] { 0, 1, 2 })
            {
                sb.Append($"<Item><BoneId value=\"0\" /><Track value=\"{tr}\" /><Unk0 value=\"{(tr == 1 ? 1 : 0)}\" /></Item>");
                foreach (var i in order) sb.Append($"<Item><BoneId value=\"{tags[i]}\" /><Track value=\"{tr}\" /><Unk0 value=\"{(tr == 1 ? 1 : 0)}\" /></Item>");
            }
            sb.Append("</BoneIds><Sequences>");
            string stat3(Vector3 v) => $"<Item><Channels><Item><Type value=\"StaticVector3\" /><Value x=\"{F(v.X)}\" y=\"{F(v.Y)}\" z=\"{F(v.Z)}\" /></Item></Channels></Item>";
            string statQ(Quaternion q0) { var q = q0.W < 0 ? -q0 : q0; return $"<Item><Channels><Item><Type value=\"StaticQuaternion\" /><Value x=\"{F(q.X)}\" y=\"{F(q.Y)}\" z=\"{F(q.Z)}\" w=\"{F(q.W)}\" /></Item></Channels></Item>"; }
            int seqCount = Math.Max(1, (int)Math.Ceiling((frames - 1) / (double)SeqLimit));
            for (int sq = 0; sq < seqCount; sq++)
            {
                int f0 = sq * SeqLimit, f1 = Math.Min(frames - 1, f0 + SeqLimit);   // inclusive: a sequence also holds the first frame of the next
                int cnt = f1 - f0 + 1;
                sb.Append($"<Item><Hash>hash_{JenkHash.GenHash(clip + "_seq" + sq):X8}</Hash><FrameCount value=\"{cnt}\" /><SequenceData>");
                // track 0 position
                sb.Append(stat3(Vector3.Zero));
                foreach (var i in order)
                {
                    var p = Enumerable.Range(f0, cnt).Select(f => centres[i] + s.Off[i][f]).ToArray();
                    bool still = p.All(v => (v - p[0]).LengthSquared() < 1e-12f);
                    if (still) sb.Append(stat3(p[0]));
                    else sb.Append("<Item><Channels>" + Animated.FloatChannel(p.Select(v => v.X).ToArray()) + Animated.FloatChannel(p.Select(v => v.Y).ToArray()) + Animated.FloatChannel(p.Select(v => v.Z).ToArray()) + "</Channels></Item>");
                }
                // track 1 rotation
                sb.Append(statQ(Quaternion.Identity));
                foreach (var i in order)
                {
                    var q = Enumerable.Range(f0, cnt).Select(f => s.Rot[i][f]).ToArray();
                    if (q.All(v => Math.Abs(Quaternion.Dot(v, q[0])) > 0.9999999f)) sb.Append(statQ(q[0]));
                    else sb.Append(Animated.RotationChannels(q));
                }
                // track 2 scale
                sb.Append(stat3(Vector3.One));
                foreach (var i in order) sb.Append(stat3(Vector3.One));
                sb.Append("</SequenceData></Item>");
            }
            sb.Append("</Sequences></Item>\n </Animations>\n</ClipDictionary>\n");
            return sb.ToString();
        }

        // ------------------------------------------------------------------ .yed (collision follows every piece)
        public static string BuildYedXml(string name, ushort[] tags)
        {
            var tracks = new StringBuilder();
            foreach (var t in tags.OrderBy(t => t))
            {
                tracks.Append($"<Item><BoneId value=\"{t}\" /><Track value=\"0\" /><Format value=\"0\" /><UnkFlag value=\"False\" /></Item>");
                tracks.Append($"<Item><BoneId value=\"{t}\" /><Track value=\"1\" /><Format value=\"1\" /><UnkFlag value=\"False\" /></Item>");
            }
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ExpressionDictionary><Item>" +
                $"<Name>pack:/{name}.expr</Name><Signature value=\"{YedSignature}\" /><Unk7C value=\"3\" /><Tracks>{tracks}</Tracks>" +
                "</Item></ExpressionDictionary>";
        }

        // read back: every piece bone is driven, frames match the simulation (positions within 1 cm, rotations within ~1°)
        public static void Verify(byte[] ycd, byte[] yed, string clip, string name, ushort[] tags, Vector3[] centres, Sim s)
        {
            var c = new YcdFile(); RpfFile.LoadResourceFile(c, ycd, 46);
            if (c.ClipMap == null || !c.ClipMap.TryGetValue(JenkHash.GenHash(clip), out var ce)) throw new Exception("YCD check failed: clip " + clip);
            var anim = (ce.Clip as ClipAnimation)?.Animation ?? throw new Exception("YCD check failed: no animation");
            if (anim.Frames != s.Frames) throw new Exception("YCD check failed: frame count");
            var rnd = new Random(3);
            for (int k = 0; k < Math.Min(tags.Length, 40); k++)
            {
                int i = tags.Length <= 40 ? k : rnd.Next(tags.Length);
                int bp = anim.FindBoneIndex(tags[i], 0), br = anim.FindBoneIndex(tags[i], 1);
                if (bp < 0 || br < 0) throw new Exception("YCD check failed: bone " + tags[i] + " not driven");
                for (int f = 0; f < s.Frames - 1; f += Math.Max(1, s.Frames / 60))
                {
                    var fp = new Animation.FramePosition { Frame0 = f, Frame1 = f + 1, Alpha0 = 1, Alpha1 = 0 };
                    var p = anim.EvaluateVector4(fp, bp, false); var exp = centres[i] + s.Off[i][f];
                    if ((new Vector3(p.X, p.Y, p.Z) - exp).Length() > 0.01f + exp.Length() * 1e-4f) throw new Exception($"YCD check failed: piece {i + 1} position at frame {f}");
                    var q = anim.EvaluateQuaternion(fp, br, false);
                    if (Math.Abs(Quaternion.Dot(Quaternion.Normalize(q), s.Rot[i][f])) < 0.9998f) throw new Exception($"YCD check failed: piece {i + 1} rotation at frame {f}");
                }
            }
            var e = new YedFile(); RpfFile.LoadResourceFile(e, yed, 25);
            var ex = e.ExpressionDictionary?.Expressions?.data_items;
            if (ex == null || ex.Length != 1 || ex[0].NameHash.Hash != JenkHash.GenHash(name) || ex[0].Signature != YedSignature) throw new Exception("YED check failed");
            var tr = ex[0].Tracks?.data_items;
            if (tr == null || tags.Any(t => !tr.Any(x => x.BoneId == t && x.Track == 1))) throw new Exception("YED check failed: tracks");
        }
    }
}

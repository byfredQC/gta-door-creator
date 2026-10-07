// CREATE TEXTURES: RGBA images made by the app -> GTA textures.
//   .dds  BC1 (DXT1, opaque) or BC3 (DXT5, with alpha), full mip chain down to 4 px - what CodeWalker / OpenIV import
//   .ytd  all of them in one texture dictionary (usage DIFFUSE / NORMAL (_n) / SPECULAR (_s)), ready to stream
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using CodeWalker.GameFiles;
using CodeWalker.Utils;

namespace DoorCore
{
    public static class TexBuild
    {
        public static JsonNode Build(JsonObject req)
        {
            var outDir = (string)req["outDir"];
            var ytdName = (string)req["ytd"];                    // null = only .dds files
            bool writeDds = (bool?)req["dds"] ?? true;
            var items = req["textures"] as JsonArray ?? throw new Exception("No texture");
            Directory.CreateDirectory(outDir);
            var files = new JsonArray(); var texs = new List<Texture>(); var info = new JsonArray();
            foreach (JsonObject it in items)
            {
                var name = Exporter.San((string)it["name"]);
                int w = (int)it["w"], h = (int)it["h"];
                var rgba = Convert.FromBase64String((string)it["rgba"]);
                if (rgba.Length != w * h * 4) throw new Exception($"{name}: wrong image size");
                if (w < 4 || h < 4 || (w & (w - 1)) != 0 || (h & (h - 1)) != 0) throw new Exception($"{name}: size must be a power of two (4…4096)");
                bool alpha = false; for (int i = 3; i < rgba.Length; i += 4) if (rgba[i] < 250) { alpha = true; break; }
                var dds = Dds(rgba, w, h, alpha, out int mips);
                if (writeDds) { var p = Path.Combine(outDir, name + ".dds"); File.WriteAllBytes(p, dds); files.Add(p); }
                var tex = DDSIO.GetTexture(dds) ?? throw new Exception($"{name}: DDS read-back failed");
                tex.Name = name; tex.NameHash = JenkHash.GenHash(name.ToLowerInvariant());
                var usage = (string)it["usage"];
                tex.Usage = usage == "normal" ? TextureUsage.NORMAL : usage == "spec" ? TextureUsage.SPECULAR : TextureUsage.DIFFUSE;
                if (tex.Width != w || tex.Height != h || tex.Levels != mips) throw new Exception($"{name}: DDS check failed");
                texs.Add(tex);
                info.Add(new JsonObject { ["name"] = name, ["w"] = w, ["h"] = h, ["format"] = alpha ? "DXT5" : "DXT1", ["mips"] = mips, ["bytes"] = dds.Length });
            }
            if (!string.IsNullOrWhiteSpace(ytdName))
            {
                var dupe = texs.GroupBy(t => t.NameHash).FirstOrDefault(g => g.Count() > 1);
                if (dupe != null) throw new Exception("Two textures have the same name: " + dupe.First().Name);
                var y = new YtdFile { TextureDict = new TextureDictionary() };
                y.TextureDict.BuildFromTextureList(texs.OrderBy(t => t.NameHash).ToList());
                var data = y.Save();
                var p = Path.Combine(outDir, Exporter.San(ytdName) + ".ytd");
                File.WriteAllBytes(p, data); files.Add(p);
                // read back
                var chk = new YtdFile(); RpfFile.LoadResourceFile(chk, data, 13);
                var got = chk.TextureDict?.Textures?.data_items;
                if (got == null || got.Length != texs.Count || texs.Any(t => !got.Any(g => g.Name == t.Name && g.Width == t.Width && g.Height == t.Height))) throw new Exception("YTD check failed");
            }
            return new JsonObject { ["files"] = files, ["textures"] = info };
        }

        // ------------------------------------------------------------------ DDS (BC1 / BC3 + mips)
        static byte[] Dds(byte[] rgba, int w, int h, bool alpha, out int mips)
        {
            var levels = new List<byte[]>(); var lw = new List<int>(); var lh = new List<int>();
            byte[] cur = rgba; int cw = w, ch = h;
            while (true)
            {
                levels.Add(alpha ? Bc3(cur, cw, ch) : Bc1(cur, cw, ch, false)); lw.Add(cw); lh.Add(ch);
                if (cw <= 4 || ch <= 4) break;
                cur = Half(cur, cw, ch); cw /= 2; ch /= 2;
            }
            mips = levels.Count;
            var ms = new MemoryStream(); var bw = new BinaryWriter(ms);
            bw.Write(0x20534444u);                       // "DDS "
            bw.Write(124u); bw.Write(0x1u | 0x2u | 0x4u | 0x1000u | 0x20000u | 0x80000u);   // CAPS HEIGHT WIDTH PIXELFORMAT MIPMAPCOUNT LINEARSIZE
            bw.Write((uint)h); bw.Write((uint)w); bw.Write((uint)levels[0].Length); bw.Write(0u); bw.Write((uint)mips);
            for (int i = 0; i < 11; i++) bw.Write(0u);
            bw.Write(32u); bw.Write(0x4u); bw.Write(alpha ? 0x35545844u : 0x31545844u);    // DDPF_FOURCC, "DXT5" / "DXT1"
            for (int i = 0; i < 5; i++) bw.Write(0u);
            bw.Write(0x1000u | 0x8u | 0x400000u); bw.Write(0u); bw.Write(0u); bw.Write(0u); bw.Write(0u);   // TEXTURE COMPLEX MIPMAP
            foreach (var l in levels) bw.Write(l);
            return ms.ToArray();
        }

        // 2x2 box filter (colour in linear-ish space is overkill here)
        static byte[] Half(byte[] s, int w, int h)
        {
            int nw = w / 2, nh = h / 2; var d = new byte[nw * nh * 4];
            for (int y = 0; y < nh; y++)
                for (int x = 0; x < nw; x++)
                    for (int c = 0; c < 4; c++)
                    {
                        int a = s[((2 * y) * w + 2 * x) * 4 + c] + s[((2 * y) * w + 2 * x + 1) * 4 + c] + s[((2 * y + 1) * w + 2 * x) * 4 + c] + s[((2 * y + 1) * w + 2 * x + 1) * 4 + c];
                        d[(y * nw + x) * 4 + c] = (byte)((a + 2) / 4);
                    }
            return d;
        }

        static ushort To565(int r, int g, int b) => (ushort)(((r * 31 + 127) / 255) << 11 | ((g * 63 + 127) / 255) << 5 | ((b * 31 + 127) / 255));
        static void From565(ushort c, out int r, out int g, out int b) { r = (c >> 11) * 255 / 31; g = ((c >> 5) & 63) * 255 / 63; b = (c & 31) * 255 / 31; }

        // BC1 block colour: endpoints = extremes along the main axis (luma-weighted bounding box diagonal), 4-colour mode
        static void ColourBlock(byte[] px, int w, int h, int bx, int by, byte[] dst, int o)
        {
            var c = new int[16, 3];
            for (int i = 0; i < 16; i++)
            {
                int x = Math.Min(w - 1, bx + (i & 3)), y = Math.Min(h - 1, by + (i >> 2)), p = (y * w + x) * 4;
                c[i, 0] = px[p]; c[i, 1] = px[p + 1]; c[i, 2] = px[p + 2];
            }
            // principal axis by power iteration on the covariance
            double mr = 0, mg = 0, mb = 0; for (int i = 0; i < 16; i++) { mr += c[i, 0]; mg += c[i, 1]; mb += c[i, 2]; }
            mr /= 16; mg /= 16; mb /= 16;
            double[,] cov = new double[3, 3];
            for (int i = 0; i < 16; i++) { double[] v = { c[i, 0] - mr, c[i, 1] - mg, c[i, 2] - mb }; for (int a = 0; a < 3; a++) for (int b2 = 0; b2 < 3; b2++) cov[a, b2] += v[a] * v[b2]; }
            double[] ax = { 1, 1, 1 };
            for (int it = 0; it < 6; it++) { var n = new double[3]; for (int a = 0; a < 3; a++) for (int b2 = 0; b2 < 3; b2++) n[a] += cov[a, b2] * ax[b2]; double l = Math.Sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]); if (l < 1e-9) break; ax = new[] { n[0] / l, n[1] / l, n[2] / l }; }
            double mn = double.MaxValue, mx = double.MinValue; int imn = 0, imx = 0;
            for (int i = 0; i < 16; i++) { double d = (c[i, 0] - mr) * ax[0] + (c[i, 1] - mg) * ax[1] + (c[i, 2] - mb) * ax[2]; if (d < mn) { mn = d; imn = i; } if (d > mx) { mx = d; imx = i; } }
            ushort c0 = To565(c[imx, 0], c[imx, 1], c[imx, 2]), c1 = To565(c[imn, 0], c[imn, 1], c[imn, 2]);
            if (c0 < c1) (c0, c1) = (c1, c0);
            uint idx = 0;
            if (c0 != c1)
            {
                From565(c0, out int r0, out int g0, out int b0); From565(c1, out int r1, out int g1, out int b1);
                int[,] pal = { { r0, g0, b0 }, { r1, g1, b1 }, { (2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3 }, { (r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3 } };
                for (int i = 0; i < 16; i++)
                {
                    int best = 0, bd = int.MaxValue;
                    for (int k = 0; k < 4; k++) { int dr = c[i, 0] - pal[k, 0], dg = c[i, 1] - pal[k, 1], db = c[i, 2] - pal[k, 2]; int d = dr * dr * 3 + dg * dg * 4 + db * db * 2; if (d < bd) { bd = d; best = k; } }
                    idx |= (uint)best << (2 * i);
                }
            }
            dst[o] = (byte)c0; dst[o + 1] = (byte)(c0 >> 8); dst[o + 2] = (byte)c1; dst[o + 3] = (byte)(c1 >> 8);
            dst[o + 4] = (byte)idx; dst[o + 5] = (byte)(idx >> 8); dst[o + 6] = (byte)(idx >> 16); dst[o + 7] = (byte)(idx >> 24);
        }

        static byte[] Bc1(byte[] px, int w, int h, bool _)
        {
            int bw = Math.Max(1, (w + 3) / 4), bh = Math.Max(1, (h + 3) / 4); var d = new byte[bw * bh * 8];
            for (int by = 0; by < bh; by++) for (int bx = 0; bx < bw; bx++) ColourBlock(px, w, h, bx * 4, by * 4, d, (by * bw + bx) * 8);
            return d;
        }

        static byte[] Bc3(byte[] px, int w, int h)
        {
            int bw = Math.Max(1, (w + 3) / 4), bh = Math.Max(1, (h + 3) / 4); var d = new byte[bw * bh * 16];
            for (int by = 0; by < bh; by++)
                for (int bx = 0; bx < bw; bx++)
                {
                    int o = (by * bw + bx) * 16;
                    var a = new int[16]; int amin = 255, amax = 0;
                    for (int i = 0; i < 16; i++) { int x = Math.Min(w - 1, bx * 4 + (i & 3)), y = Math.Min(h - 1, by * 4 + (i >> 2)); a[i] = px[(y * w + x) * 4 + 3]; amin = Math.Min(amin, a[i]); amax = Math.Max(amax, a[i]); }
                    d[o] = (byte)amax; d[o + 1] = (byte)amin;
                    ulong bits = 0;
                    if (amax > amin)
                    {
                        var pal = new int[8]; pal[0] = amax; pal[1] = amin; for (int k = 1; k < 7; k++) pal[k + 1] = ((7 - k) * amax + k * amin) / 7;
                        for (int i = 0; i < 16; i++) { int best = 0, bd = int.MaxValue; for (int k = 0; k < 8; k++) { int dd = Math.Abs(a[i] - pal[k]); if (dd < bd) { bd = dd; best = k; } } bits |= (ulong)best << (3 * i); }
                    }
                    for (int k = 0; k < 6; k++) d[o + 2 + k] = (byte)(bits >> (8 * k));
                    ColourBlock(px, w, h, bx * 4, by * 4, d, o + 8);
                }
            return d;
        }
    }
}

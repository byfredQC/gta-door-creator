using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;
using System.Xml;
using CodeWalker.GameFiles;

namespace DoorCore
{
    // Builds small sample props (box meshes + embedded texture) so the app can be tried without game files.
    public static class TestBuilder
    {
        public static JsonNode Build(JsonObject req)
        {
            var outPath = (string)req["out"];
            var kind = (string)req["kind"] ?? "door";
            var name = Path.GetFileNameWithoutExtension(outPath).ToLowerInvariant();
            var dir = Path.Combine(Path.GetTempPath(), "doorcore_build_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(Path.Combine(dir, name + "_d.dds"), MakeDds(128, 128, kind));

            var boxes = new List<float[]>(); // minx,miny,minz,maxx,maxy,maxz
            if (kind == "garage")
            {
                // 3m wide, 2.4m tall roller-style panel, origin at bottom centre
                for (int i = 0; i < 5; i++) boxes.Add(new[] { -1.5f, -0.03f, i * 0.48f + 0.005f, 1.5f, 0.03f, (i + 1) * 0.48f - 0.005f });
                boxes.Add(new[] { -0.15f, -0.07f, 0.15f, 0.15f, -0.03f, 0.2f });
            }
            else
            {
                // 1m wide, 2.1m tall, 5cm thick, origin at bottom centre (a typical un-pivoted prop)
                boxes.Add(new[] { -0.5f, -0.025f, 0f, 0.5f, 0.025f, 2.1f });
                boxes.Add(new[] { 0.32f, -0.08f, 0.98f, 0.42f, -0.025f, 1.02f }); // handle front
                boxes.Add(new[] { 0.32f, 0.025f, 0.98f, 0.42f, 0.08f, 1.02f });   // handle back
            }
            var xml = DrawableXml(name, boxes);
            var doc = new XmlDocument(); doc.LoadXml(xml);
            var ydr = XmlYdr.GetYdr(doc, dir);
            var data = ydr.Save();
            File.WriteAllBytes(outPath, data);
            try { Directory.Delete(dir, true); } catch { }
            return new JsonObject { ["file"] = outPath, ["bytes"] = data.Length };
        }

        static string F(float f) => Util.F(f);

        static string DrawableXml(string name, List<float[]> boxes)
        {
            var verts = new StringBuilder(); var idx = new StringBuilder();
            float[] mn = { 1e9f, 1e9f, 1e9f }, mx = { -1e9f, -1e9f, -1e9f };
            int vbase = 0;
            foreach (var b in boxes)
            {
                for (int k = 0; k < 3; k++) { mn[k] = Math.Min(mn[k], b[k]); mx[k] = Math.Max(mx[k], b[k + 3]); }
                // 6 faces, 4 verts each
                var faces = new (int axis, int sign)[] { (0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1) };
                foreach (var (axis, sign) in faces)
                {
                    int u = (axis + 1) % 3, v = (axis + 2) % 3;
                    for (int c = 0; c < 4; c++)
                    {
                        var p = new float[3];
                        p[axis] = sign < 0 ? b[axis] : b[axis + 3];
                        bool cu = c == 1 || c == 2, cv = c >= 2;
                        p[u] = cu ? b[u + 3] : b[u];
                        p[v] = cv ? b[v + 3] : b[v];
                        var n = new float[3]; n[axis] = sign;
                        // UVs: map the large face to the texture
                        float tu = (axis == 1) ? (p[0] - mn[0]) / Math.Max(0.01f, 1f) : (cu ? 1 : 0);
                        float tv = (axis == 1) ? 1f - p[2] / 2.4f : (cv ? 1 : 0);
                        verts.Append($"{F(p[0])} {F(p[1])} {F(p[2])}   {F(n[0])} {F(n[1])} {F(n[2])}   255 255 255 255   {F(tu)} {F(tv)}\n");
                    }
                    if (sign > 0) idx.Append($"{vbase} {vbase + 1} {vbase + 2} {vbase} {vbase + 2} {vbase + 3} ");
                    else idx.Append($"{vbase} {vbase + 2} {vbase + 1} {vbase} {vbase + 3} {vbase + 2} ");
                    vbase += 4;
                }
            }
            float cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, cz = (mn[2] + mx[2]) / 2;
            float r = (float)Math.Sqrt((mx[0] - mn[0]) * (mx[0] - mn[0]) + (mx[1] - mn[1]) * (mx[1] - mn[1]) + (mx[2] - mn[2]) * (mx[2] - mn[2])) / 2;
            string V(string t, float x, float y, float z) => $"<{t} x=\"{F(x)}\" y=\"{F(y)}\" z=\"{F(z)}\" />";
            string V4(string t, float x, float y, float z) => $"<{t} x=\"{F(x)}\" y=\"{F(y)}\" z=\"{F(z)}\" w=\"0\" />";
            return $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<Drawable>
 <Name>{name}</Name>
 {V("BoundingSphereCenter", cx, cy, cz)}
 <BoundingSphereRadius value=""{F(r)}"" />
 {V("BoundingBoxMin", mn[0], mn[1], mn[2])}
 {V("BoundingBoxMax", mx[0], mx[1], mx[2])}
 <LodDistHigh value=""9998"" /><LodDistMed value=""9998"" /><LodDistLow value=""9998"" /><LodDistVlow value=""9998"" />
 <FlagsHigh value=""1"" /><FlagsMed value=""0"" /><FlagsLow value=""0"" /><FlagsVlow value=""0"" />
 <ShaderGroup>
  <Unknown30 value=""8"" />
  <TextureDictionary>
   <Item>
    <Name>{name}_d</Name><Unk32 value=""128"" /><Usage>DIFFUSE</Usage><UsageFlags>UNK24</UsageFlags><ExtraFlags value=""0"" />
    <Width value=""128"" /><Height value=""128"" /><MipLevels value=""1"" /><Format>D3DFMT_A8R8G8B8</Format><FileName>{name}_d.dds</FileName>
   </Item>
  </TextureDictionary>
  <Shaders>
   <Item>
    <Name>default</Name><FileName>default.sps</FileName><RenderBucket value=""0"" />
    <Parameters>
     <Item name=""DiffuseSampler"" type=""Texture""><Name>{name}_d</Name><Unk32 value=""128"" /></Item>
     <Item name=""matMaterialColorScale"" type=""Vector"" x=""1"" y=""0"" z=""0"" w=""1"" />
     <Item name=""HardAlphaBlend"" type=""Vector"" x=""1"" y=""0"" z=""0"" w=""0"" />
     <Item name=""useTessellation"" type=""Vector"" x=""0"" y=""0"" z=""0"" w=""0"" />
     <Item name=""wetnessMultiplier"" type=""Vector"" x=""1"" y=""0"" z=""0"" w=""0"" />
     <Item name=""globalAnimUV1"" type=""Vector"" x=""0"" y=""1"" z=""0"" w=""0"" />
     <Item name=""globalAnimUV0"" type=""Vector"" x=""1"" y=""0"" z=""0"" w=""0"" />
    </Parameters>
   </Item>
  </Shaders>
 </ShaderGroup>
 <DrawableModelsHigh>
  <Item>
   <RenderMask value=""255"" /><Flags value=""0"" /><HasSkin value=""0"" /><BoneIndex value=""0"" /><Unknown1 value=""0"" />
   <Geometries>
    <Item>
     <ShaderIndex value=""0"" />
     {V4("BoundingBoxMin", mn[0], mn[1], mn[2])}
     {V4("BoundingBoxMax", mx[0], mx[1], mx[2])}
     <VertexBuffer>
      <Flags value=""0"" />
      <Layout type=""GTAV1""><Position /><Normal /><Colour0 /><TexCoord0 /></Layout>
      <Data>
{verts}      </Data>
     </VertexBuffer>
     <IndexBuffer><Data>{idx}</Data></IndexBuffer>
    </Item>
   </Geometries>
  </Item>
 </DrawableModelsHigh>
</Drawable>";
        }

        static byte[] MakeDds(int w, int h, string kind)
        {
            var ms = new MemoryStream(); var bw = new BinaryWriter(ms);
            bw.Write(0x20534444); // 'DDS '
            bw.Write(124); bw.Write(0x1 | 0x2 | 0x4 | 0x1000 | 0x8); bw.Write(h); bw.Write(w); bw.Write(w * 4); bw.Write(0); bw.Write(1);
            for (int i = 0; i < 11; i++) bw.Write(0);
            bw.Write(32); bw.Write(0x41); bw.Write(0); bw.Write(32);
            bw.Write(0x00FF0000); bw.Write(0x0000FF00); bw.Write(0x000000FF); bw.Write(unchecked((int)0xFF000000));
            bw.Write(0x1000); bw.Write(0); bw.Write(0); bw.Write(0); bw.Write(0);
            var rnd = new Random(7);
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int r, g, b;
                    if (kind == "garage")
                    {
                        bool groove = (y % 26) < 2 || (x % 32) == 0;
                        int v = groove ? 120 : 190 + (x * 7 + y * 3) % 12;
                        r = v; g = v + 4; b = v + 10;
                    }
                    else
                    {
                        double grain = Math.Sin(x * 0.35 + Math.Sin(y * 0.05) * 4) * 0.5 + 0.5;
                        bool panel = (x > 16 && x < 112 && ((y > 10 && y < 58) || (y > 70 && y < 118)));
                        bool edge = panel && (x == 17 || x == 111 || y == 11 || y == 57 || y == 71 || y == 117);
                        r = (int)(110 + grain * 40) - (edge ? 40 : 0) + (panel ? 10 : 0);
                        g = (int)(66 + grain * 25) - (edge ? 25 : 0) + (panel ? 6 : 0);
                        b = (int)(34 + grain * 12) - (edge ? 12 : 0);
                    }
                    bw.Write((byte)Math.Clamp(b, 0, 255)); bw.Write((byte)Math.Clamp(g, 0, 255)); bw.Write((byte)Math.Clamp(r, 0, 255)); bw.Write((byte)255);
                }
            return ms.ToArray();
        }
    }
}

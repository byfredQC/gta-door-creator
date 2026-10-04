using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using CodeWalker.GameFiles;
using CodeWalker.Utils;
using SharpDX;

namespace DoorCore
{
    public static class Loader
    {
        public static JsonNode Load(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) throw new Exception("File not found: " + path);
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext == ".xml") return LoadYdrXml(path);
            switch (ext)
            {
                case ".ydr": return LoadYdr(path);
                case ".ytyp": return LoadYtyp(path);
                case ".ybn": return LoadYbn(path);
                case ".ytd": return LoadYtd(path);
                default: throw new Exception("Unsupported file type '" + ext + "'. Drop a .ydr, .ydr.xml, .ytyp, .ybn or .ytd file.");
            }
        }

        public static YdrFile ReadYdr(string path)
        {
            var ydr = new YdrFile();
            Util.LoadResource(ydr, path);
            if (ydr.Drawable == null) throw new Exception("Could not read the drawable in " + Path.GetFileName(path) + " (unsupported or corrupt YDR).");
            return ydr;
        }

        // ---------------------------------------------------------------- YDR
        static JsonNode LoadYdr(string path)
        {
            var ydr = ReadYdr(path);
            var d = ydr.Drawable;
            var res = new JsonObject();
            res["kind"] = "ydr";
            res["file"] = Path.GetFileName(path);
            res["path"] = path;
            res["name"] = Path.GetFileNameWithoutExtension(path).ToLowerInvariant();
            res["drawableName"] = d.Name ?? "";
            res["gen9"] = (ydr.RpfFileEntry as RpfResourceFileEntry)?.Version == 159;
            res["bbMin"] = Util.V3(d.BoundingBoxMin);
            res["bbMax"] = Util.V3(d.BoundingBoxMax);
            res["bsCenter"] = Util.V3(d.BoundingCenter);
            res["bsRadius"] = Util.R(d.BoundingSphereRadius);
            res["lodDistHigh"] = Util.R(d.LodDistHigh);
            res["hasSkeleton"] = d.Skeleton != null;
            res["boneCount"] = d.Skeleton?.Bones?.Items?.Length ?? 0;
            res["lightCount"] = d.LightAttributes?.data_items?.Length ?? 0;

            // materials
            var shaders = d.ShaderGroup?.Shaders?.data_items ?? new ShaderFX[0];
            var mats = new JsonArray();
            foreach (var s in shaders) mats.Add(ShaderJson(s));
            res["materials"] = mats;

            // meshes (high LOD; fall back to whatever exists)
            var models = d.DrawableModels?.High ?? d.AllModels ?? new DrawableModel[0];
            var meshes = new JsonArray();
            int vtotal = 0, ttotal = 0;
            var warnings = new JsonArray();
            foreach (var m in models)
            {
                if (m?.Geometries == null) continue;
                if (m.BoneIndex != 0 || m.HasSkin != 0) warnings.Add("Model is bound to a bone/skinned - preview shows it in bind pose.");
                foreach (var g in m.Geometries)
                {
                    var mesh = MeshJson(g, shaders);
                    if (mesh == null) continue;
                    vtotal += (int)mesh["vertexCount"];
                    ttotal += (int)mesh["triangleCount"];
                    meshes.Add(mesh);
                }
            }
            res["meshes"] = meshes;
            res["vertexCount"] = vtotal;
            res["triangleCount"] = ttotal;
            res["lods"] = new JsonObject
            {
                ["high"] = d.DrawableModels?.High?.Length ?? 0,
                ["med"] = d.DrawableModels?.Med?.Length ?? 0,
                ["low"] = d.DrawableModels?.Low?.Length ?? 0,
                ["vlow"] = d.DrawableModels?.VLow?.Length ?? 0,
            };

            // embedded textures
            res["textures"] = TexturesJson(d.ShaderGroup?.TextureDictionary);
            res["hasEmbeddedTextures"] = (d.ShaderGroup?.TextureDictionary?.Textures?.data_items?.Length ?? 0) > 0;

            // embedded collision
            if (d.Bound != null)
            {
                res["collision"] = BoundJson(d.Bound);
            }
            if ((bool)res["gen9"]) warnings.Add("This is a Gen9 (Enhanced) YDR. FiveM needs legacy YDRs - the export converts it, but check the shaders in-game.");
            res["warnings"] = warnings;
            return res;
        }

        static JsonObject ShaderJson(ShaderFX s)
        {
            var o = new JsonObject();
            o["name"] = Hashes.Name(s.Name.Hash);
            o["file"] = Hashes.Name(s.FileName.Hash);
            var texs = new JsonObject();
            var ps = s.ParametersList?.Parameters;
            var hs = s.ParametersList?.Hashes;
            if (ps != null && hs != null)
            {
                for (int i = 0; i < ps.Length && i < hs.Length; i++)
                {
                    if (ps[i].Data is TextureBase tb)
                    {
                        var pname = Hashes.Name((uint)hs[i]).ToLowerInvariant();
                        texs[pname] = (tb.Name ?? "").ToLowerInvariant();
                    }
                }
            }
            o["textures"] = texs;
            return o;
        }

        static JsonObject MeshJson(DrawableGeometry g, ShaderFX[] shaders)
        {
            var vd = g.VertexData;
            var ib = g.IndexBuffer?.Indices;
            if (vd?.VertexBytes == null || vd.Info == null || ib == null) return null;
            int vc = vd.VertexCount;
            var info = vd.Info;
            bool hasNorm = ((info.Flags >> 3) & 1) == 1;
            bool hasUv = ((info.Flags >> 6) & 1) == 1;
            bool hasCol = ((info.Flags >> 4) & 1) == 1;
            var pos = new float[vc * 3];
            var nrm = hasNorm ? new float[vc * 3] : null;
            var uv = hasUv ? new float[vc * 2] : null;
            var col = hasCol ? new byte[vc * 4] : null;
            for (int v = 0; v < vc; v++)
            {
                var p = ReadComp(vd, v, 0);
                pos[v * 3] = p.X; pos[v * 3 + 1] = p.Y; pos[v * 3 + 2] = p.Z;
                if (hasNorm) { var n = ReadComp(vd, v, 3); nrm[v * 3] = n.X; nrm[v * 3 + 1] = n.Y; nrm[v * 3 + 2] = n.Z; }
                if (hasUv) { var t = ReadComp(vd, v, 6); uv[v * 2] = t.X; uv[v * 2 + 1] = t.Y; }
                if (hasCol)
                {
                    var o = v * info.Stride + info.GetComponentOffset(4);
                    if (o + 4 <= vd.VertexBytes.Length) Buffer.BlockCopy(vd.VertexBytes, o, col, v * 4, 4);
                }
            }
            var idx = ib.Select(i => (uint)i).ToArray();
            var m = new JsonObject();
            m["shaderIndex"] = (int)g.ShaderID;
            m["vertexCount"] = vc;
            m["triangleCount"] = idx.Length / 3;
            m["positions"] = Util.B64(pos);
            if (nrm != null) m["normals"] = Util.B64(nrm);
            if (uv != null) m["uvs"] = Util.B64(uv);
            if (col != null) m["colors"] = Convert.ToBase64String(col);
            m["indices"] = Util.B64(idx);
            return m;
        }

        // Reads any vertex component and returns it as a Vector4
        public static Vector4 ReadComp(VertexData vd, int v, int comp)
        {
            var info = vd.Info;
            var t = info.GetComponentType(comp);
            int o = v * info.Stride + info.GetComponentOffset(comp);
            var b = vd.VertexBytes;
            switch (t)
            {
                case VertexComponentType.Float: return new Vector4(BitConverter.ToSingle(b, o), 0, 0, 0);
                case VertexComponentType.Float2: return new Vector4(BitConverter.ToSingle(b, o), BitConverter.ToSingle(b, o + 4), 0, 0);
                case VertexComponentType.Float3: return new Vector4(BitConverter.ToSingle(b, o), BitConverter.ToSingle(b, o + 4), BitConverter.ToSingle(b, o + 8), 0);
                case VertexComponentType.Float4: return new Vector4(BitConverter.ToSingle(b, o), BitConverter.ToSingle(b, o + 4), BitConverter.ToSingle(b, o + 8), BitConverter.ToSingle(b, o + 12));
                case VertexComponentType.Half2: return new Vector4((float)BitConverter.ToHalf(b, o), (float)BitConverter.ToHalf(b, o + 2), 0, 0);
                case VertexComponentType.Half4: return new Vector4((float)BitConverter.ToHalf(b, o), (float)BitConverter.ToHalf(b, o + 2), (float)BitConverter.ToHalf(b, o + 4), (float)BitConverter.ToHalf(b, o + 6));
                case VertexComponentType.Colour:
                case VertexComponentType.UByte4: return new Vector4(b[o] / 255f, b[o + 1] / 255f, b[o + 2] / 255f, b[o + 3] / 255f);
                case VertexComponentType.RGBA8SNorm: return new Vector4((sbyte)b[o] / 127f, (sbyte)b[o + 1] / 127f, (sbyte)b[o + 2] / 127f, (sbyte)b[o + 3] / 127f);
                case VertexComponentType.FloatUnk: // dec3n packed normal
                    {
                        uint u = BitConverter.ToUInt32(b, o);
                        float D(uint x) { int s = (int)(x << 22) >> 22; return s / 511f; }
                        return new Vector4(D(u & 0x3FF), D((u >> 10) & 0x3FF), D((u >> 20) & 0x3FF), 0);
                    }
                default: return Vector4.Zero;
            }
        }

        // Writes a Float3 position back
        public static void WritePos(VertexData vd, int v, Vector3 p)
        {
            var info = vd.Info;
            int o = v * info.Stride + info.GetComponentOffset(0);
            var t = info.GetComponentType(0);
            var b = vd.VertexBytes;
            if (t == VertexComponentType.Float3 || t == VertexComponentType.Float4)
            {
                Buffer.BlockCopy(BitConverter.GetBytes(p.X), 0, b, o, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(p.Y), 0, b, o + 4, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(p.Z), 0, b, o + 8, 4);
            }
            else if (t == VertexComponentType.Half4)
            {
                Buffer.BlockCopy(BitConverter.GetBytes((System.Half)p.X), 0, b, o, 2);
                Buffer.BlockCopy(BitConverter.GetBytes((System.Half)p.Y), 0, b, o + 2, 2);
                Buffer.BlockCopy(BitConverter.GetBytes((System.Half)p.Z), 0, b, o + 4, 2);
            }
            else throw new Exception("Unsupported position format: " + t);
        }

        // ---------------------------------------------------------------- textures
        public static JsonArray TexturesJson(TextureDictionary td)
        {
            var arr = new JsonArray();
            var texs = td?.Textures?.data_items;
            if (texs == null) return arr;
            foreach (var t in texs)
            {
                try
                {
                    int mip = 0; int w = t.Width, h = t.Height;
                    while ((w > 512 || h > 512) && mip < t.Levels - 1) { mip++; w = Math.Max(1, w / 2); h = Math.Max(1, h / 2); }
                    var px = DDSIO.GetPixels(t, mip);
                    if (px == null) continue;
                    for (int i = 0; i + 3 < px.Length; i += 4) { var tmp = px[i]; px[i] = px[i + 2]; px[i + 2] = tmp; } // BGRA -> RGBA
                    arr.Add(new JsonObject
                    {
                        ["name"] = (t.Name ?? "").ToLowerInvariant(),
                        ["width"] = w,
                        ["height"] = h,
                        ["format"] = t.Format.ToString(),
                        ["rgba"] = Convert.ToBase64String(px)
                    });
                }
                catch (Exception) { /* unsupported format - skip preview */ }
            }
            return arr;
        }

        // ---------------------------------------------------------------- YDR XML (CodeWalker / Sollumz export)
        static JsonNode LoadYdrXml(string xmlPath)
        {
            var doc = new System.Xml.XmlDocument();
            doc.Load(xmlPath);
            if (doc.DocumentElement?.Name != "Drawable")
                throw new Exception(Path.GetFileName(xmlPath) + " is not a YDR XML (root <" + doc.DocumentElement?.Name + ">). Export the drawable as .ydr.xml from CodeWalker.");
            var dir = Path.GetDirectoryName(Path.GetFullPath(xmlPath));
            var file = Path.GetFileName(xmlPath);
            var stem = file.EndsWith(".ydr.xml", StringComparison.OrdinalIgnoreCase) ? file.Substring(0, file.Length - 8) : Path.GetFileNameWithoutExtension(file);
            var name = (doc.DocumentElement.SelectSingleNode("Name")?.InnerText ?? "").Trim();
            if (name.EndsWith(".#dr")) name = name.Substring(0, name.Length - 4);
            if (string.IsNullOrEmpty(name)) name = stem;
            name = name.ToLowerInvariant();

            // DDS files: CodeWalker exports them into a folder named after the file
            var ddsNames = new List<string>();
            foreach (System.Xml.XmlNode n in doc.SelectNodes("/Drawable/ShaderGroup/TextureDictionary/Item/FileName")) ddsNames.Add(n.InnerText.Trim());
            string ddsFolder = dir;
            foreach (var cand in new[] { Path.Combine(dir, stem), Path.Combine(dir, name), dir })
            {
                if (Directory.Exists(cand) && ddsNames.Any(f => File.Exists(Path.Combine(cand, f)))) { ddsFolder = cand; break; }
            }
            // embedded textures whose .dds is missing: drop them from the XML so the shaders reference them externally
            int missing = 0;
            var tdNode = doc.SelectSingleNode("/Drawable/ShaderGroup/TextureDictionary");
            if (tdNode != null)
            {
                foreach (System.Xml.XmlNode item in tdNode.SelectNodes("Item"))
                {
                    var fn = item.SelectSingleNode("FileName")?.InnerText?.Trim();
                    if (string.IsNullOrEmpty(fn) || !File.Exists(Path.Combine(ddsFolder, fn))) { tdNode.RemoveChild(item); missing++; }
                }
                if (tdNode.SelectNodes("Item").Count == 0) tdNode.ParentNode.RemoveChild(tdNode);
            }
            var ydr = XmlYdr.GetYdr(doc, ddsFolder);
            if (ydr?.Drawable == null) throw new Exception("Could not convert " + file);
            var d = ydr.Drawable;
            d.Name = name;

            var tmp = Path.Combine(Path.GetTempPath(), "gta-door-creator", "xml", Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tmp);
            var ydrPath = Path.Combine(tmp, name + ".ydr");
            File.WriteAllBytes(ydrPath, ydr.Save());

            var res = (JsonObject)LoadYdr(ydrPath);
            res["file"] = file;
            res["sourceXml"] = xmlPath;
            res["name"] = name;
            res["type"] = "YDR XML";
            var w = res["warnings"] as JsonArray ?? new JsonArray();
            if (missing > 0)
                w.Add($"{missing} of {ddsNames.Count} textures not found (no .dds next to the XML) - they are referenced from the texture dictionary instead of embedded. Put the exported '{stem}' texture folder next to the XML to embed them.");
            res["warnings"] = w;
            return res;
        }

        // ---------------------------------------------------------------- YTYP
        static JsonNode LoadYtyp(string path)
        {
            // make names readable: register the file stem and every model file next to it
            try
            {
                JenkIndex.Ensure(Path.GetFileNameWithoutExtension(path).ToLowerInvariant());
                foreach (var f in Directory.GetFiles(Path.GetDirectoryName(Path.GetFullPath(path))))
                    JenkIndex.Ensure(Path.GetFileNameWithoutExtension(f).ToLowerInvariant());
            }
            catch { }
            var ytyp = new YtypFile();
            Util.LoadResource(ytyp, path);
            var res = new JsonObject { ["kind"] = "ytyp", ["file"] = Path.GetFileName(path), ["path"] = path };
            res["name"] = Hashes.Name(ytyp.CMapTypes.name.Hash);
            var arr = new JsonArray();
            foreach (var a in ytyp.AllArchetypes ?? new Archetype[0])
            {
                var b = a._BaseArchetypeDef;
                arr.Add(new JsonObject
                {
                    ["name"] = Hashes.Name(a.Hash.Hash),
                    ["type"] = a.Type.ToString(),
                    ["lodDist"] = Util.R(b.lodDist),
                    ["hdTextureDist"] = Util.R(b.hdTextureDist),
                    ["flags"] = b.flags,
                    ["specialAttribute"] = b.specialAttribute,
                    ["bbMin"] = Util.V3(b.bbMin),
                    ["bbMax"] = Util.V3(b.bbMax),
                    ["bsCentre"] = Util.V3(b.bsCentre),
                    ["bsRadius"] = Util.R(b.bsRadius),
                    ["textureDictionary"] = Hashes.Name(b.textureDictionary.Hash),
                    ["physicsDictionary"] = Hashes.Name(b.physicsDictionary.Hash),
                    ["assetType"] = b.assetType.ToString(),
                    ["assetName"] = Hashes.Name(b.assetName.Hash),
                });
            }
            res["archetypes"] = arr;
            return res;
        }

        // ---------------------------------------------------------------- YBN
        static JsonNode LoadYbn(string path)
        {
            var ybn = new YbnFile();
            Util.LoadResource(ybn, path);
            if (ybn.Bounds == null) throw new Exception("Could not read bounds in " + Path.GetFileName(path));
            var res = BoundJson(ybn.Bounds);
            res["kind"] = "ybn";
            res["file"] = Path.GetFileName(path);
            res["path"] = path;
            return res;
        }

        // ---------------------------------------------------------------- YTD
        static JsonNode LoadYtd(string path)
        {
            var ytd = new YtdFile();
            Util.LoadResource(ytd, path);
            return new JsonObject
            {
                ["kind"] = "ytd",
                ["file"] = Path.GetFileName(path),
                ["path"] = path,
                ["textures"] = TexturesJson(ytd.TextureDict)
            };
        }

        // ---------------------------------------------------------------- bounds -> preview triangles
        public static JsonObject BoundJson(Bounds b)
        {
            var tris = new List<float>();
            var types = new List<string>();
            CollectTris(b, tris, types);
            return new JsonObject
            {
                ["type"] = b.Type.ToString(),
                ["parts"] = new JsonArray(types.Select(t => (JsonNode)t).ToArray()),
                ["bbMin"] = Util.V3(b.BoxMin),
                ["bbMax"] = Util.V3(b.BoxMax),
                ["triangles"] = Util.B64(tris.ToArray()),
            };
        }

        static void CollectTris(Bounds b, List<float> tris, List<string> types)
        {
            if (b == null) return;
            var M = (b.Parent != null) ? b.Transform : Matrix.Identity;
            switch (b)
            {
                case BoundComposite c:
                    foreach (var ch in c.Children?.data_items ?? new Bounds[0]) CollectTris(ch, tris, types);
                    return;
                case BoundGeometry g: // includes BVH
                    types.Add(b.Type.ToString());
                    if (g.Polygons == null) return;
                    foreach (var p in g.Polygons)
                    {
                        if (p is BoundPolygonTriangle t)
                        {
                            AddV(tris, g.GetVertexPos(t.vertIndex1)); AddV(tris, g.GetVertexPos(t.vertIndex2)); AddV(tris, g.GetVertexPos(t.vertIndex3));
                        }
                        else if (p is BoundPolygonBox pb)
                        {
                            var a = new[] { g.GetVertexPos(pb.boxIndex1), g.GetVertexPos(pb.boxIndex2), g.GetVertexPos(pb.boxIndex3), g.GetVertexPos(pb.boxIndex4) };
                            var mn = Vector3.Min(Vector3.Min(a[0], a[1]), Vector3.Min(a[2], a[3]));
                            var mx = Vector3.Max(Vector3.Max(a[0], a[1]), Vector3.Max(a[2], a[3]));
                            AddBox(tris, mn, mx, Matrix.Identity);
                        }
                    }
                    return;
                default:
                    types.Add(b.Type.ToString());
                    AddBox(tris, b.BoxMin, b.BoxMax, M);
                    return;
            }
        }
        static void AddV(List<float> l, Vector3 v) { l.Add(v.X); l.Add(v.Y); l.Add(v.Z); }
        static void AddBox(List<float> l, Vector3 mn, Vector3 mx, Matrix m)
        {
            var c = new Vector3[8];
            for (int i = 0; i < 8; i++)
            {
                var v = new Vector3((i & 1) == 0 ? mn.X : mx.X, (i & 2) == 0 ? mn.Y : mx.Y, (i & 4) == 0 ? mn.Z : mx.Z);
                c[i] = Vector3.TransformCoordinate(v, m);
            }
            int[] f = { 0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5 };
            foreach (var i in f) AddV(l, c[i]);
        }
    }
}

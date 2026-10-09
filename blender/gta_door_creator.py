# GTA Door Creator - Blender add-on (needs Sollumz)
# Make a GTA V / FiveM door from your model, inside Blender:
#   auto detect (type, hinge side), pivot on the hinge, box collision, YTYP archetype (door flags + specialAttribute),
#   GTA door sound (game.dat151.rel), preview of the opening, and a ready FiveM resource (Sollumz export).
bl_info = {
    "name": "GTA Door Creator (Sollumz)",
    "author": "byfred",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar (N) > Door Creator",
    "description": "Make GTA V / FiveM doors: pivot, collision, ytyp, sound and FiveM resource - with Sollumz",
    "category": "Import-Export",
}

import math
import os
import struct

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, PointerProperty, StringProperty
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------- data
FLAG_DYNAMIC = 131072
FLAG_DOOR_PHYSICS = 67108864
SPECIAL = {"normal": "IS_NORMAL_DOOR", "sliding": "IS_SLIDING_DOOR", "sliding_v": "IS_SLIDING_DOOR_VERTICAL", "garage": "IS_GARAGE_DOOR"}
SOUND_TYPE = {"normal": 4, "sliding": 0, "sliding_v": 1, "garage": 2}
SOUND_DEFAULT = {4: "86e5cee2", 0: "5c5c68cb", 1: "098b9ab5", 2: "a04a33e1"}
MATERIALS = [
    ("70", "Bois (WOOD_SOLID_MEDIUM)", ""), ("71", "Bois gros (WOOD_SOLID_LARGE)", ""), ("56", "Métal (METAL_SOLID_MEDIUM)", ""),
    ("67", "Porte de garage (METAL_GARAGE_DOOR)", ""), ("112", "Verre (GLASS_SHOOT_THROUGH)", ""), ("1", "Béton (CONCRETE)", ""),
    ("87", "Plastique (PLASTIC_HOLLOW)", ""), ("116", "Tôle (CAR_METAL)", ""),
]
DOOR_SOUNDS = [
    ("86e5cee2", 4, "Wooden interior door (house / office)"),
    ("172111ad", 4, "Glass shop door"),
    ("1597136c", 4, "Chain-link fence gate"),
    ("8f0e2208", 4, "Large metal gate"),
    ("bc038e9f", 4, "Metal shop / club door"),
    ("38063124", 4, "Back / service door"),
    ("21693e4b", 4, "Fire / security door"),
    ("2c48fb10", 4, "Bars gate / jail cell"),
    ("052535f0", 4, "Heavy glass door (jewelry store)"),
    ("2a5e1272", 4, "Reinforced security door"),
    ("bce501a7", 4, "Villa double gate"),
    ("318d9b1a", 4, "Farm / ranch gate"),
    ("4850fe95", 4, "24/7 store / gas station door"),
    ("845aa41a", 4, "Wooden fence gate"),
    ("51a19a73", 4, "Trailer door"),
    ("fee4d97f", 4, "Factory gate"),
    ("fab83354", 4, "Residential fence gate"),
    ("75857fcb", 4, "Vault / heavy main door"),
    ("e215af52", 4, "Bridge / yard gate"),
    ("07dc5a6e", 4, "Office door (light)"),
    ("253193d2", 4, "Bank counter door"),
    ("034872be", 4, "Dam door (heavy metal)"),
    ("2d9d252b", 4, "Lab door (Humane Labs)"),
    ("0d23fd27", 4, "Police station door"),
    ("037778af", 4, "Clothing store / barber door"),
    ("f95707f8", 4, "Meth lab door"),
    ("21ecc221", 4, "Safe door"),
    ("4d753457", 0, "Elevator door"),
    ("0c746482", 0, "Big sliding gate (prison / military)"),
    ("d234505d", 0, "Sliding chain-link gate"),
    ("188c4706", 0, "Residential sliding gate"),
    ("5c5c68cb", 0, "Glass sliding door (lab)"),
    ("d456a4cc", 0, "Sliding gate (heavy)"),
    ("28806a76", 0, "Elevator door (FIB)"),
    ("bc9a1406", 0, "Factory sliding gate"),
    ("8a0d8ff3", 0, "Sliding yard gate"),
    ("5cdd15ab", 0, "Sliding gate (light)"),
    ("28714b31", 0, "Patio sliding door (house)"),
    ("4cc78db0", 0, "Security sliding gate (FIB)"),
    ("571453f2", 0, "Docks sliding gate"),
    ("098b9ab5", 1, "Roller shutter"),
    ("51c64198", 1, "Vertical security gate"),
    ("a04a33e1", 2, "Garage door"),
    ("a705ebec", 2, "Workshop garage door (LS Customs)"),
    ("83344932", 2, "Pay'n'Spray door"),
    ("981ef0a5", 3, "Barrier arm"),
    ("97da4960", 3, "Railway barrier"),
]


def joaat(s):
    h = 0
    for c in s.lower().encode("utf-8"):
        h = (h + c) & 0xFFFFFFFF
        h = (h + (h << 10)) & 0xFFFFFFFF
        h ^= h >> 6
    h = (h + (h << 3)) & 0xFFFFFFFF
    h ^= h >> 11
    h = (h + (h << 15)) & 0xFFFFFFFF
    return h


def sanitize(name):
    out = "".join(c if (c.isalnum() or c == "_") else "_" for c in (name or "").strip().lower())
    return out or "my_door"


# ---------------------------------------------------------------------------- door sound (game.dat151.rel)
# Same bytes as CodeWalker writes: DoorAudioSettingsLink "dasl_<joaat(model)>" -> vanilla DoorAudioSettings.
def build_door_audio_rel(links):
    """links = [(model_name, settings_hex8), ...] -> bytes of a game.dat151.rel"""
    items = [(joaat("dasl_%08x" % joaat(m)), int(s, 16)) for m, s in links]
    data = struct.pack("<I", 7126027)
    for _, door in items:
        data += struct.pack("<II", 0x75, door)          # type 117 DoorAudioSettingsLink (+3 bytes 0), Door hash
    out = struct.pack("<II", 151, len(data)) + data
    out += struct.pack("<II", 4, 0)                    # name table: length 4, 0 names
    out += struct.pack("<I", len(items))
    for i, (h, _) in enumerate(items):
        out += struct.pack("<III", h, 4 + 8 * i, 8)     # index: hash, offset in data, length
    out += struct.pack("<I", len(items))
    for i in range(len(items)):
        out += struct.pack("<I", 16 + 8 * i)            # hash table: file offsets of the Door hashes
    out += struct.pack("<I", 0)                        # pack table
    return out


# ---------------------------------------------------------------------------- model analysis (same rules as the app)
def is_sollumz():
    return hasattr(bpy.types.Object, "sollum_type")


def find_drawable(obj):
    while obj is not None:
        if getattr(obj, "sollum_type", "") == "sollumz_drawable":
            return obj
        obj = obj.parent
    return None


def door_meshes(context):
    """(drawable or None, [mesh objects])"""
    sel = list(context.selected_objects) or ([context.active_object] if context.active_object else [])
    for o in sel:
        d = find_drawable(o)
        if d:
            meshes = [c for c in d.children_recursive if c.type == "MESH" and getattr(c, "sollum_type", "") == "sollumz_drawable_model"]
            return d, meshes
    return None, [o for o in sel if o.type == "MESH"]


def sollumz_module(sub):
    """a Sollumz sub-module whatever the add-on is called (legacy 'sollumz' or extension 'bl_ext.<repo>.sollumz')"""
    import sys
    for k, m in list(sys.modules.items()):
        if k.endswith("." + sub) and "sollumz" in k.lower():
            return m
    return None


def ensure_sollumz_materials(context, meshes):
    """Sollumz only exports meshes with Sollumz shader materials: convert / add default.sps when needed"""
    sm = sollumz_module("ydr.shader_materials")
    idx = 0
    if sm is not None:
        for i, s in enumerate(getattr(sm, "shadermats", [])):
            if getattr(s, "value", "") == "default.sps":
                idx = i
                break
    for o in meshes:
        mats = [m for m in o.data.materials if m]
        if mats and all(getattr(m, "sollum_type", "") == "sollumz_material_shader" for m in mats):
            continue
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        context.view_layer.objects.active = o
        if mats:
            try:
                bpy.ops.sollumz.autoconvertmaterials()
            except Exception:
                pass
        if not any(getattr(m, "sollum_type", "") == "sollumz_material_shader" for m in o.data.materials if m):
            o.data.materials.clear()
            bpy.ops.sollumz.createshadermaterial(shader_index=idx)


def world_points(meshes):
    pts = []
    for o in meshes:
        mw = o.matrix_world
        pts.extend(mw @ v.co for v in o.data.vertices)
    return pts


def analyze(pts):
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = mx - mn
    wa = 0 if size.x >= size.y else 1
    ta = 1 - wa
    c = (mn + mx) * 0.5
    mid = sorted(p[ta] for p in pts)[len(pts) // 2]          # main slab = around the median (a handle shifts the bbox centre)
    offs = sorted(abs(p[ta] - mid) for p in pts)
    slab = offs[int(len(offs) * 0.6)] if offs else size[ta] / 2
    hs, hn = 0.0, 0
    if size[ta] > 0.001:
        for p in pts:
            if abs(p[ta] - mid) > slab * 1.35 + 0.004 and mn.z + size.z * 0.2 < p.z < mx.z - size.z * 0.2:
                hs += p[wa]
                hn += 1
    handle = None
    if hn >= 4:
        rel = (hs / hn - mn[wa]) / max(1e-4, size[wa])
        if rel < 0.4 or rel > 0.6:
            handle = "max" if rel > 0.5 else "min"
    return {"min": mn, "max": mx, "size": size, "center": c, "wa": wa, "ta": ta, "handle": handle}


def left_end(an):
    # screen-left in FRONT view (camera on the -thickness side), same convention as the app
    return "max" if an["ta"] == 0 else "min"


def detect(name, an):
    W, H = an["size"][an["wa"]], an["size"].z
    n = name.lower()
    s = {"normal": 0.15, "sliding": 0.1, "garage": 0.1}
    if any(k in n for k in ("garage", "gar_", "shutter", "roller", "rollup", "roll_up")):
        s["garage"] += 0.55
    if any(k in n for k in ("slid", "elev", "lift", "autodoor", "auto_door", "_sl_", "doorsl", "_sld", "sldoor")):
        s["sliding"] += 0.6
    if ("door" in n or "gate" in n) and "gar" not in n:
        s["normal"] += 0.3
    if 0.55 <= W <= 1.6 and 1.7 <= H <= 3.2:
        s["normal"] += 0.35
    if W > 2.2 and H > 1.8:
        s["garage"] += 0.4
    if an["handle"]:
        s["normal"] += 0.25
    kind = max(s, key=s.get)
    le = left_end(an)
    hinge = "LEFT"
    if an["handle"]:
        hinge = "RIGHT" if an["handle"] == le else "LEFT"
    elif n.rstrip("0123456789").endswith("_r"):
        hinge = "RIGHT"
    return kind.upper(), hinge


def pivot_point(an, props):
    """world position of the door origin"""
    wa, ta = an["wa"], an["ta"]
    p = Vector(an["center"])
    p.z = an["min"].z
    if props.door_type == "NORMAL":
        le = left_end(an)
        lo, hi = an["min"][wa], an["max"][wa]
        left, right = (lo, hi) if le == "min" else (hi, lo)
        p[wa] = left if props.hinge == "LEFT" else right
    p[ta] = an["center"][ta]
    return p


# ---------------------------------------------------------------------------- properties
def _preview_update(self, context):
    d = bpy.data.objects.get(self.drawable_name)
    if not d or "gdc_base" not in d:
        return
    base = Matrix([list(d["gdc_base"][i * 4:i * 4 + 4]) for i in range(4)])
    t = self.preview
    if self.door_type == "NORMAL":
        sign = -1.0 if (self.hinge == "LEFT") != self.flip else 1.0
        m = base @ Matrix.Rotation(math.radians(self.angle) * t * sign, 4, "Z")
    elif self.door_type == "SLIDING":
        w = float(d.get("gdc_width", 1.0))
        axis = Vector(d.get("gdc_waxis", (1.0, 0.0, 0.0)))
        if self.slide_dir == "UP":
            off = Vector((0, 0, float(d.get("gdc_height", 2.0))))
        else:
            off = axis * w * (1 if self.slide_dir == "RIGHT" else -1)
        m = Matrix.Translation(off * t) @ base
    else:
        m = Matrix.Translation(Vector((0, 0, float(d.get("gdc_height", 2.5)) * t))) @ base
    d.matrix_world = m


def _sound_items(self, context):
    t = SOUND_TYPE["sliding_v" if (self.door_type == "SLIDING" and self.slide_dir == "UP") or (self.door_type == "GARAGE" and self.garage_kind == "ROLLUP") else self.door_type.lower()]
    items = [("AUTO", "Auto (son par défaut de ce type)", ""), ("NONE", "Aucun son", "")]
    items += [(sid, label, "") for sid, st, label in DOOR_SOUNDS if st == t]
    items += [(sid, "(autre type) " + label, "") for sid, st, label in DOOR_SOUNDS if st != t]
    return items


class GDC_Props(bpy.types.PropertyGroup):
    name: StringProperty(name="Nom", default="my_door", description="Nom du modèle et de l'archétype (évite les noms GTA vanilla)")
    door_type: EnumProperty(name="Type", items=[("NORMAL", "Normale", "Porte à charnière"), ("SLIDING", "Coulissante", "Porte coulissante"), ("GARAGE", "Garage", "Porte de garage")], default="NORMAL")
    hinge: EnumProperty(name="Charnière", items=[("LEFT", "Gauche", ""), ("RIGHT", "Droite", "")], default="LEFT")
    flip: BoolProperty(name="Inverser le sens (aperçu)", default=False)
    angle: FloatProperty(name="Angle d'ouverture", default=90, min=10, max=180, update=_preview_update)
    slide_dir: EnumProperty(name="Glisse vers", items=[("LEFT", "Gauche", ""), ("RIGHT", "Droite", ""), ("UP", "Haut", "")], default="RIGHT")
    garage_kind: EnumProperty(name="Garage", items=[("SECTIONAL", "Sectionnelle", "specialAttribute 5"), ("ROLLUP", "Enroulable / levante", "specialAttribute 10")], default="SECTIONAL")
    collision: EnumProperty(name="Collision", items=[("BOX", "Boîte (recommandé)", "Une boîte de collision, idéal pour les portes dynamiques"), ("KEEP", "Garder la mienne", "Garde la collision déjà dans le drawable"), ("NONE", "Aucune", "")], default="BOX")
    material: EnumProperty(name="Matériau", items=MATERIALS, default="70")
    sound: EnumProperty(name="Son", items=_sound_items)
    lod_dist: FloatProperty(name="Distance LOD", default=100, min=10, max=1000)
    preview: FloatProperty(name="Ouverture", default=0, min=0, max=1, subtype="FACTOR", update=_preview_update)
    drawable_name: StringProperty()
    info: StringProperty()


# ---------------------------------------------------------------------------- operators
class GDC_OT_detect(bpy.types.Operator):
    bl_idname = "gdc.detect"
    bl_label = "Détection auto"
    bl_description = "Devine le type de porte et le côté de la charnière (poignée, taille, nom)"

    def execute(self, context):
        p = context.scene.gdc
        d, meshes = door_meshes(context)
        if not meshes:
            self.report({"ERROR"}, "Sélectionne ton modèle de porte (mesh ou Drawable Sollumz)")
            return {"CANCELLED"}
        an = analyze(world_points(meshes))
        base_name = (d.name if d else meshes[0].name).split(".")[0]
        kind, hinge = detect(base_name, an)
        p.door_type, p.hinge = kind, hinge
        if p.name in ("", "my_door"):
            p.name = sanitize(base_name)
        W, H = an["size"][an["wa"]], an["size"].z
        p.info = f"{W:.2f} × {H:.2f} m · {'poignée trouvée' if an['handle'] else 'pas de poignée'} → {kind.lower()}, charnière {hinge.lower()}"
        self.report({"INFO"}, p.info)
        return {"FINISHED"}


class GDC_OT_make(bpy.types.Operator):
    bl_idname = "gdc.make"
    bl_label = "Créer la porte"
    bl_description = "Place l'origine sur le pivot, crée le Drawable, la collision et l'archétype YTYP (Sollumz)"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        if not is_sollumz():
            self.report({"ERROR"}, "Sollumz n'est pas activé - installe / active Sollumz d'abord")
            return {"CANCELLED"}
        p = context.scene.gdc
        name = sanitize(p.name)
        p.name = name
        if context.object and context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        drawable, meshes = door_meshes(context)
        if not meshes:
            self.report({"ERROR"}, "Sélectionne ton modèle de porte (mesh ou Drawable Sollumz)")
            return {"CANCELLED"}
        # reset an older preview
        if drawable and "gdc_base" in drawable:
            drawable.matrix_world = Matrix([list(drawable["gdc_base"][i * 4:i * 4 + 4]) for i in range(4)])
        an = analyze(world_points(meshes))
        piv = pivot_point(an, p)

        if drawable is None:
            # plain meshes: bake their transform, then put the pivot at the world origin and let Sollumz make the Drawable
            for o in meshes:
                mw = o.matrix_world.copy()
                o.parent = None
                if o.data.users > 1:
                    o.data = o.data.copy()
                o.data.transform(mw)
                o.matrix_world = Matrix.Identity(4)
                o.data.transform(Matrix.Translation(-piv))
                o.data.update()
            ensure_sollumz_materials(context, meshes)
            sc = context.scene
            for attr, val in (("auto_create_embedded_col", False), ("center_drawable_to_selection", False), ("create_seperate_drawables", False)):
                if hasattr(sc, attr):
                    setattr(sc, attr, val)
            bpy.ops.object.select_all(action="DESELECT")
            for o in meshes:
                o.select_set(True)
            context.view_layer.objects.active = meshes[0]
            bpy.ops.sollumz.converttodrawable()
            drawable = find_drawable(meshes[0])
            if drawable is None:
                self.report({"ERROR"}, "Sollumz n'a pas pu créer le Drawable")
                return {"CANCELLED"}
            drawable.matrix_world = Matrix.Identity(4)
        else:
            # existing drawable: move its origin to the pivot, children stay where they are
            kids = [(c, c.matrix_world.copy()) for c in drawable.children]
            mw = drawable.matrix_world.copy()
            mw.translation = piv
            drawable.matrix_world = mw
            context.view_layer.update()
            for c, m in kids:
                c.matrix_world = m
        drawable.name = name
        context.view_layer.update()

        # ---- collision
        inv = drawable.matrix_world.inverted()
        lp = [inv @ q for q in world_points(meshes)]
        lmn = Vector((min(v.x for v in lp), min(v.y for v in lp), min(v.z for v in lp)))
        lmx = Vector((max(v.x for v in lp), max(v.y for v in lp), max(v.z for v in lp)))
        comps = [c for c in drawable.children if getattr(c, "sollum_type", "") == "sollumz_bound_composite"]
        if p.collision in ("BOX", "NONE"):
            for c in comps:
                for cc in list(c.children_recursive):
                    bpy.data.objects.remove(cc, do_unlink=True)
                bpy.data.objects.remove(c, do_unlink=True)
        if p.collision == "BOX":
            self.make_box(context, drawable, lmn, lmx, int(p.material), name)

        # ---- ytyp + archetype
        sc = context.scene
        yi = next((i for i, y in enumerate(sc.ytyps) if y.name == name), -1)
        if yi < 0:
            y = sc.ytyps.add()
            y.name = name
            yi = len(sc.ytyps) - 1
        sc.ytyp_index = yi
        y = sc.ytyps[yi]
        for i in reversed(range(len(y.archetypes))):
            if y.archetypes[i].name == name:
                y.archetypes.remove(i)
        bpy.ops.object.select_all(action="DESELECT")
        drawable.select_set(True)
        context.view_layer.objects.active = drawable
        if hasattr(sc, "create_archetype_type"):
            try:
                sc.create_archetype_type = "sollumz_archetype_base"
            except Exception:
                pass
        bpy.ops.sollumz.createarchetypefromselected()
        arch = next((a for a in y.archetypes if a.name == name), None)
        if arch is None:
            self.report({"ERROR"}, "Sollumz n'a pas créé l'archétype")
            return {"CANCELLED"}
        kind = "normal" if p.door_type == "NORMAL" else ("sliding_v" if p.slide_dir == "UP" else "sliding") if p.door_type == "SLIDING" else ("garage" if p.garage_kind == "SECTIONAL" else "sliding_v")
        arch.flags.total = str(FLAG_DYNAMIC | FLAG_DOOR_PHYSICS)
        arch.special_attribute = SPECIAL[kind]
        arch.lod_dist = p.lod_dist
        arch.hd_texture_dist = 15

        # ---- preview data
        drawable["gdc_base"] = [x for row in drawable.matrix_world for x in row]
        wv = Vector((0, 0, 0))
        wv[an["wa"]] = 1
        drawable["gdc_waxis"] = list(wv)
        drawable["gdc_width"] = an["size"][an["wa"]]
        drawable["gdc_height"] = an["size"].z
        p.drawable_name = drawable.name
        p.preview = 0
        p.info = f"Porte prête : {name} · {SPECIAL[kind].lower()} · collision {p.collision.lower()}"
        self.report({"INFO"}, p.info)
        return {"FINISHED"}

    @staticmethod
    def make_box(context, drawable, lmn, lmx, mat, name):
        sc = context.scene
        bpy.ops.object.select_all(action="DESELECT")
        drawable.select_set(True)
        context.view_layer.objects.active = drawable
        sc.create_bound_type = "sollumz_bound_composite"
        bpy.ops.sollumz.createbound()
        comp = next(c for c in drawable.children if getattr(c, "sollum_type", "") == "sollumz_bound_composite")
        comp.name = name + ".col"
        comp.matrix_parent_inverse = Matrix.Identity(4)
        comp.location = (0, 0, 0)
        bpy.ops.object.select_all(action="DESELECT")
        comp.select_set(True)
        context.view_layer.objects.active = comp
        sc.create_bound_type = "sollumz_bound_box"
        bpy.ops.sollumz.createbound()
        box = next(c for c in comp.children if getattr(c, "sollum_type", "") == "sollumz_bound_box")
        box.name = name + ".box"
        box.matrix_parent_inverse = Matrix.Identity(4)
        box.location = (0, 0, 0)
        size = lmx - lmn
        for k in range(3):
            if size[k] < 0.02:
                size[k] = 0.02
        # the Sollumz box mesh is a 1 m cube centred on its origin
        bm = box.data
        bmn = Vector((min(v.co.x for v in bm.vertices), min(v.co.y for v in bm.vertices), min(v.co.z for v in bm.vertices)))
        bmx = Vector((max(v.co.x for v in bm.vertices), max(v.co.y for v in bm.vertices), max(v.co.z for v in bm.vertices)))
        bc, bs = (bmn + bmx) * 0.5, bmx - bmn
        bm.transform(Matrix.Translation(-bc))
        bm.transform(Matrix.Diagonal((size.x / max(bs.x, 1e-6), size.y / max(bs.y, 1e-6), size.z / max(bs.z, 1e-6), 1)))
        bm.transform(Matrix.Translation((lmn + lmx) * 0.5))
        bm.update()
        box.data.materials.clear()
        bpy.ops.object.select_all(action="DESELECT")
        box.select_set(True)
        context.view_layer.objects.active = box
        context.window_manager.sz_collision_material_index = mat
        bpy.ops.sollumz.createcollisionmaterial()


class GDC_OT_preview_reset(bpy.types.Operator):
    bl_idname = "gdc.preview_reset"
    bl_label = "Fermer"
    bl_description = "Remet la porte fermée"

    def execute(self, context):
        context.scene.gdc.preview = 0
        return {"FINISHED"}


def manifest(name, ytyp, audio, sound_label):
    lines = ["-- Generated by GTA Door Creator (Blender)", "fx_version 'cerulean'", "game 'gta5'", "", f"name '{name}'",
             f"description 'Door: {name}'", "version '1.0.0'", "", "this_is_a_map 'yes'", "", "files {", f"  'stream/{ytyp}',"]
    if audio:
        lines.append(f"  'audio/{audio}',")
    lines += ["}", "", f"data_file 'DLC_ITYP_REQUEST' 'stream/{ytyp}'"]
    if audio:
        lines += ["", f"-- door sound (GTA: {sound_label})", f"data_file 'AUDIO_GAMEDATA' 'audio/{audio.replace('.dat151.rel', '.dat')}'"]
    return "\n".join(lines) + "\n"


class GDC_OT_export(bpy.types.Operator):
    bl_idname = "gdc.export"
    bl_label = "Exporter la ressource FiveM"
    bl_description = "Crée <nom>/stream (ydr + ytyp via Sollumz), audio (son) et fxmanifest.lua"

    directory: StringProperty(subtype="DIR_PATH")

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        p = context.scene.gdc
        d = bpy.data.objects.get(p.drawable_name)
        if not d:
            self.report({"ERROR"}, "Clique d'abord sur « Créer la porte »")
            return {"CANCELLED"}
        p.preview = 0
        name = d.name
        root = os.path.join(bpy.path.abspath(self.directory), name)
        stream = os.path.join(root, "stream")
        os.makedirs(stream, exist_ok=True)
        sc = context.scene
        yi = next((i for i, y in enumerate(sc.ytyps) if y.name == name), -1)
        if yi >= 0:
            sc.ytyp_index = yi
        if context.object and context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        d.hide_set(False)
        d.select_set(True)
        context.view_layer.objects.active = d
        before = set(os.listdir(stream))
        try:
            bpy.ops.sollumz.export_assets(directory=stream, direct_export=True, use_custom_settings=True,
                                          target_formats={"NATIVE"}, target_versions={"GEN8"}, limit_to_selected=True,
                                          export_ytyps=True, export_ytyps_include="SELECTED")
        except TypeError:
            # older Sollumz: settings come from its preferences
            bpy.ops.sollumz.export_assets(directory=stream, direct_export=True)
        files = sorted(set(os.listdir(stream)) - before) or sorted(os.listdir(stream))
        native = [f for f in files if f.endswith((".ydr", ".ytyp"))]
        xml_only = not native and any(f.endswith(".xml") for f in files)

        # sound
        audio, label = None, ""
        if p.sound != "NONE":
            kind = "sliding_v" if (p.door_type == "SLIDING" and p.slide_dir == "UP") or (p.door_type == "GARAGE" and p.garage_kind == "ROLLUP") else p.door_type.lower()
            sid = SOUND_DEFAULT[SOUND_TYPE[kind]] if p.sound == "AUTO" else p.sound
            label = next((l for s, _, l in DOOR_SOUNDS if s == sid), sid)
            audio = f"{name}_game.dat151.rel"
            os.makedirs(os.path.join(root, "audio"), exist_ok=True)
            with open(os.path.join(root, "audio", audio), "wb") as f:
                f.write(build_door_audio_rel([(name, sid)]))
        ytyp = f"{name}.ytyp"
        with open(os.path.join(root, "fxmanifest.lua"), "w", encoding="utf-8") as f:
            f.write(manifest(name, ytyp, audio, label))
        with open(os.path.join(root, "README.txt"), "w", encoding="utf-8") as f:
            f.write(f"{name}\n{'=' * len(name)}\nGenerated by GTA Door Creator (Blender + Sollumz).\n\n"
                    f"1. Copy this folder into your server resources and add  ensure {name}  to server.cfg.\n"
                    f"2. Place the model \"{name}\" in your ymap / MLO (CodeWalker).\n"
                    f"3. In-game it is a GTA door (no script){', with the sound: ' + label if audio else ''}.\n\n"
                    "AFTER CHANGING THE FILES: disconnect and reconnect to the server (a restart is not enough).\n")
        if xml_only:
            msg = "Sollumz a exporté en XML (.ydr.xml / .ytyp.xml) : active « Native » (PyMateria) dans les préférences Sollumz, ou convertis les .xml avec CodeWalker"
            self.report({"WARNING"}, msg)
            p.info = msg
        else:
            p.info = f"Ressource prête : {root}  ({', '.join(files) or 'aucun fichier exporté ?'})"
            self.report({"INFO"}, p.info)
        return {"FINISHED"}


# ---------------------------------------------------------------------------- UI
class GDC_PT_panel(bpy.types.Panel):
    bl_label = "GTA Door Creator"
    bl_idname = "GDC_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Door Creator"

    def draw(self, context):
        lay = self.layout
        p = context.scene.gdc
        if not is_sollumz():
            lay.label(text="Sollumz n'est pas activé", icon="ERROR")
            lay.label(text="Installe Sollumz puis réactive cet add-on")
            return
        box = lay.box()
        box.label(text="1 · Ton modèle", icon="MESH_CUBE")
        d, meshes = door_meshes(context)
        box.label(text=(f"{d.name} (Drawable)" if d else f"{len(meshes)} mesh sélectionné(s)") if meshes else "Sélectionne ta porte", icon="CHECKMARK" if meshes else "INFO")
        box.operator("gdc.detect", icon="VIEWZOOM")
        if p.info:
            box.label(text=p.info)

        box = lay.box()
        box.label(text="2 · Réglages", icon="PREFERENCES")
        box.prop(p, "name")
        box.prop(p, "door_type", expand=True)
        if p.door_type == "NORMAL":
            box.prop(p, "hinge", expand=True)
        elif p.door_type == "SLIDING":
            box.prop(p, "slide_dir", expand=True)
        else:
            box.prop(p, "garage_kind", expand=True)
        box.prop(p, "collision")
        if p.collision == "BOX":
            box.prop(p, "material")
        box.prop(p, "sound")
        box.prop(p, "lod_dist")
        box.operator("gdc.make", icon="MOD_BUILD")

        box = lay.box()
        box.label(text="3 · Aperçu", icon="PLAY")
        col = box.column()
        col.enabled = bool(p.drawable_name and bpy.data.objects.get(p.drawable_name))
        col.prop(p, "preview", slider=True)
        if p.door_type == "NORMAL":
            row = col.row()
            row.prop(p, "angle")
            row.prop(p, "flip", text="", icon="ARROW_LEFTRIGHT")
        col.operator("gdc.preview_reset", icon="LOOP_BACK")
        col.label(text="(seulement dans Blender : en jeu c'est le système de portes GTA)")

        box = lay.box()
        box.label(text="4 · Export", icon="EXPORT")
        row = box.row()
        row.enabled = bool(p.drawable_name and bpy.data.objects.get(p.drawable_name))
        row.scale_y = 1.4
        row.operator("gdc.export", icon="FILE_FOLDER")


classes = (GDC_Props, GDC_OT_detect, GDC_OT_make, GDC_OT_preview_reset, GDC_OT_export, GDC_PT_panel)


def register():
    for c in classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.gdc = PointerProperty(type=GDC_Props)


def unregister():
    del bpy.types.Scene.gdc
    for c in reversed(classes):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()

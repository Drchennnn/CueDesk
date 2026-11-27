"""Windows PE EXE icon stamper and GUI launcher compiler using native Win32 APIs."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import struct
import subprocess
import sys

RT_ICON = 3
RT_GROUP_ICON = 14
RT_VERSION = 16
LANG_EN_US = 1033
LOAD_LIBRARY_AS_DATAFILE = 0x00000002


def parse_ico(ico_bytes: bytes) -> list[dict]:
    """Parse a standard Windows .ico file into its constituent image entries."""
    if len(ico_bytes) < 6:
        raise ValueError("ICO file too short")
    reserved, ico_type, count = struct.unpack_from("<HHH", ico_bytes, 0)
    if reserved != 0 or ico_type != 1 or count == 0:
        raise ValueError(f"Invalid ICO header: reserved={reserved}, type={ico_type}, count={count}")
    entries = []
    for i in range(count):
        off = 6 + i * 16
        w, h, color_count, res, planes, bit_count, size, img_offset = struct.unpack_from("<BBBBHHII", ico_bytes, off)
        data = ico_bytes[img_offset : img_offset + size]
        if len(data) != size:
            raise ValueError(f"Truncated ICO image entry #{i}")
        entries.append(
            {
                "width": w,
                "height": h,
                "color_count": color_count,
                "reserved": res,
                "planes": planes or 1,
                "bit_count": bit_count or 32,
                "size": size,
                "data": data,
            }
        )
    return entries


def build_group_icon_dir(entries: list[dict], start_id: int = 1) -> bytes:
    """Build a Windows PE RT_GROUP_ICON (GRPICONDIR) payload referencing RT_ICON IDs."""
    parts = [struct.pack("<HHH", 0, 1, len(entries))]
    for idx, entry in enumerate(entries):
        icon_id = start_id + idx
        parts.append(
            struct.pack(
                "<BBBBHHIH",
                entry["width"],
                entry["height"],
                entry["color_count"],
                entry["reserved"],
                entry["planes"],
                entry["bit_count"],
                entry["size"],
                icon_id,
            )
        )
    return b"".join(parts)


def _setup_kernel32():
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.LoadLibraryExW.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_uint32]
    k32.LoadLibraryExW.restype = ctypes.c_void_p
    k32.FreeLibrary.argtypes = [ctypes.c_void_p]
    k32.FreeLibrary.restype = ctypes.c_bool

    enum_name_cb = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
    enum_lang_cb = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint16, ctypes.c_void_p)

    k32.EnumResourceNamesW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, enum_name_cb, ctypes.c_void_p]
    k32.EnumResourceNamesW.restype = ctypes.c_bool
    k32.EnumResourceLanguagesW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, enum_lang_cb, ctypes.c_void_p]
    k32.EnumResourceLanguagesW.restype = ctypes.c_bool

    k32.BeginUpdateResourceW.argtypes = [ctypes.c_wchar_p, ctypes.c_bool]
    k32.BeginUpdateResourceW.restype = ctypes.c_void_p
    k32.UpdateResourceW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint16, ctypes.c_void_p, ctypes.c_uint32]
    k32.UpdateResourceW.restype = ctypes.c_bool
    k32.EndUpdateResourceW.argtypes = [ctypes.c_void_p, ctypes.c_bool]
    k32.EndUpdateResourceW.restype = ctypes.c_bool
    return k32, enum_name_cb, enum_lang_cb


def list_exe_icon_resources(exe_path: Path) -> dict[str, list[tuple[int | str, list[int]]]]:
    """Enumerate RT_GROUP_ICON and RT_ICON resource IDs & languages inside a Windows PE binary."""
    if sys.platform != "win32":
        return {"groups": [], "icons": []}
    k32, enum_name_cb, enum_lang_cb = _setup_kernel32()
    hmod = k32.LoadLibraryExW(str(exe_path.resolve()), None, LOAD_LIBRARY_AS_DATAFILE)
    if not hmod:
        raise OSError(f"LoadLibraryExW failed for {exe_path} (err={ctypes.get_last_error()})")
    try:
        def _enum(res_type: int) -> list[tuple[int | str, list[int]]]:
            out: list[tuple[int | str, list[int]]] = []

            def on_name(h, t, name, _lp):
                langs: list[int] = []

                def on_lang(_h2, _t2, _n2, lang, _lp2):
                    langs.append(int(lang))
                    return True

                k32.EnumResourceLanguagesW(h, t, name, enum_lang_cb(on_lang), 0)
                key: int | str = int(name) if name < 0x10000 else ctypes.wstring_at(name)
                out.append((key, langs))
                return True

            k32.EnumResourceNamesW(hmod, ctypes.c_void_p(res_type), enum_name_cb(on_name), 0)
            return out

        return {"groups": _enum(RT_GROUP_ICON), "icons": _enum(RT_ICON)}
    finally:
        k32.FreeLibrary(hmod)


def _res_id_ptr(res_id: int | str):
    if isinstance(res_id, int):
        return ctypes.c_void_p(res_id)
    return ctypes.cast(ctypes.c_wchar_p(res_id), ctypes.c_void_p)


def stamp_exe_icon(exe_path: Path, ico_path: Path) -> dict:
    """Replace the primary application icon inside a Windows PE executable."""
    if sys.platform != "win32":
        return {"skipped": True, "reason": "non-win32"}
    exe_path = exe_path.resolve()
    ico_path = ico_path.resolve()
    entries = parse_ico(ico_path.read_bytes())
    existing = list_exe_icon_resources(exe_path)

    primary_group_id: int | str = 1
    primary_lang = LANG_EN_US
    if existing["groups"]:
        primary_group_id = existing["groups"][0][0]
        if existing["groups"][0][1]:
            primary_lang = existing["groups"][0][1][0]

    k32, _, _ = _setup_kernel32()
    hupdate = k32.BeginUpdateResourceW(str(exe_path), False)
    if not hupdate:
        raise OSError(f"BeginUpdateResourceW failed for {exe_path} (err={ctypes.get_last_error()})")

    committed = False
    try:
        # Remove previous icon resources cleanly
        for gid, langs in existing["groups"]:
            for lang in langs or [primary_lang]:
                k32.UpdateResourceW(hupdate, ctypes.c_void_p(RT_GROUP_ICON), _res_id_ptr(gid), lang, None, 0)
        for iid, langs in existing["icons"]:
            for lang in langs or [primary_lang]:
                k32.UpdateResourceW(hupdate, ctypes.c_void_p(RT_ICON), _res_id_ptr(iid), lang, None, 0)

        # Write new RT_ICON resources (IDs 1..N)
        for idx, entry in enumerate(entries, start=1):
            buf = ctypes.create_string_buffer(entry["data"], len(entry["data"]))
            ok = k32.UpdateResourceW(
                hupdate,
                ctypes.c_void_p(RT_ICON),
                ctypes.c_void_p(idx),
                primary_lang,
                buf,
                len(entry["data"]),
            )
            if not ok:
                raise OSError(f"UpdateResourceW(RT_ICON #{idx}) failed (err={ctypes.get_last_error()})")

        # Write new RT_GROUP_ICON referencing IDs 1..N
        group_data = build_group_icon_dir(entries, start_id=1)
        gbuf = ctypes.create_string_buffer(group_data, len(group_data))
        ok = k32.UpdateResourceW(
            hupdate,
            ctypes.c_void_p(RT_GROUP_ICON),
            _res_id_ptr(primary_group_id),
            primary_lang,
            gbuf,
            len(group_data),
        )
        if not ok:
            raise OSError(f"UpdateResourceW(RT_GROUP_ICON) failed (err={ctypes.get_last_error()})")

        if not k32.EndUpdateResourceW(hupdate, False):
            raise OSError(f"EndUpdateResourceW failed for {exe_path} (err={ctypes.get_last_error()})")
        committed = True
    finally:
        if not committed:
            k32.EndUpdateResourceW(hupdate, True)

    after = list_exe_icon_resources(exe_path)
    if len(after["groups"]) < 1 or len(after["icons"]) != len(entries):
        raise RuntimeError(f"Icon verification failed on {exe_path}: {after}")
    return {
        "exe": str(exe_path),
        "icon_count": len(entries),
        "group_id": primary_group_id,
        "lang": primary_lang,
    }


def _pad4(data: bytes) -> bytes:
    rem = len(data) % 4
    return data + (b"\x00" * (4 - rem)) if rem else data


def _ver_node(key: str, value: bytes = b"", w_type: int = 1, children: list[bytes] | None = None, value_len: int | None = None) -> bytes:
    key_bytes = (key + "\x00").encode("utf-16-le")
    header_plus_key = _pad4(struct.pack("<HHH", 0, 0, w_type) + key_bytes)
    if value_len is None:
        value_len = (len(value) // 2) if w_type == 1 else len(value)
    body = header_plus_key + value
    if children:
        body = _pad4(body)
        for idx, child in enumerate(children):
            body += child if idx == len(children) - 1 else _pad4(child)
    return struct.pack("<HHH", len(body), value_len, w_type) + body[6:]


def _parse_ver_quad(ver: str) -> tuple[int, int, int, int]:
    nums = [int(p) for p in str(ver or "1.0.0.0").split(".") if p.isdigit()]
    while len(nums) < 4:
        nums.append(0)
    return tuple(max(0, min(65535, n)) for n in nums[:4])


def build_vs_version_info(
    *,
    product_name: str = "CueDesk",
    file_description: str = "CueDesk",
    company_name: str = "CueDesk",
    internal_name: str = "CueDesk",
    original_filename: str = "CueDesk.exe",
    file_version: str = "1.0.0.0",
    product_version: str = "1.0.0",
) -> bytes:
    """Build a Win32 RT_VERSION (VS_VERSION_INFO) resource blob with UTF-16 string tables."""
    f1, f2, f3, f4 = _parse_ver_quad(file_version)
    p1, p2, p3, p4 = _parse_ver_quad(product_version)
    fixed = struct.pack(
        "<13I",
        0xFEEF04BD,
        0x00010000,
        (f1 << 16) | f2,
        (f3 << 16) | f4,
        (p1 << 16) | p2,
        (p3 << 16) | p4,
        0x0000003F,
        0x00000000,
        0x00040004,
        0x00000001,
        0x00000000,
        0x00000000,
        0x00000000,
    )
    strings = [
        ("CompanyName", company_name),
        ("FileDescription", file_description),
        ("FileVersion", file_version),
        ("InternalName", internal_name),
        ("OriginalFilename", original_filename),
        ("ProductName", product_name),
        ("ProductVersion", product_version),
    ]
    string_nodes = [
        _ver_node(k, (v + "\x00").encode("utf-16-le"), w_type=1)
        for k, v in strings
    ]
    string_table = _ver_node("040904b0", b"", w_type=1, children=string_nodes, value_len=0)
    string_file_info = _ver_node("StringFileInfo", b"", w_type=1, children=[string_table], value_len=0)
    translation = _ver_node("Translation", struct.pack("<HH", 0x0409, 0x04B0), w_type=0, value_len=4)
    var_file_info = _ver_node("VarFileInfo", b"", w_type=1, children=[translation], value_len=0)
    return _ver_node("VS_VERSION_INFO", fixed, w_type=0, children=[string_file_info, var_file_info], value_len=len(fixed))


def stamp_exe_version_info(
    exe_path: Path,
    *,
    product_name: str = "CueDesk",
    file_description: str = "CueDesk",
    company_name: str = "CueDesk",
    internal_name: str = "CueDesk",
    original_filename: str = "CueDesk.exe",
    file_version: str = "1.0.0.0",
    product_version: str = "1.0.0",
) -> dict:
    """Replace the PE RT_VERSION resource so Windows Taskbar, Explorer, and Mic Privacy show CueDesk."""
    if sys.platform != "win32":
        return {"skipped": True, "reason": "non-win32"}
    exe_path = exe_path.resolve()
    k32, enum_name_cb, enum_lang_cb = _setup_kernel32()
    hmod = k32.LoadLibraryExW(str(exe_path), None, LOAD_LIBRARY_AS_DATAFILE)
    if not hmod:
        raise OSError(f"LoadLibraryExW failed for {exe_path} (err={ctypes.get_last_error()})")
    existing_ver: list[tuple[int | str, list[int]]] = []
    try:
        def on_name(h, t, name, _lp):
            langs: list[int] = []
            def on_lang(_h2, _t2, _n2, lang, _lp2):
                langs.append(int(lang))
                return True
            k32.EnumResourceLanguagesW(h, t, name, enum_lang_cb(on_lang), 0)
            key: int | str = int(name) if name < 0x10000 else ctypes.wstring_at(name)
            existing_ver.append((key, langs))
            return True
        k32.EnumResourceNamesW(hmod, ctypes.c_void_p(RT_VERSION), enum_name_cb(on_name), 0)
    finally:
        k32.FreeLibrary(hmod)

    payload = build_vs_version_info(
        product_name=product_name,
        file_description=file_description,
        company_name=company_name,
        internal_name=internal_name,
        original_filename=original_filename,
        file_version=file_version,
        product_version=product_version,
    )
    hupdate = k32.BeginUpdateResourceW(str(exe_path), False)
    if not hupdate:
        raise OSError(f"BeginUpdateResourceW failed for {exe_path} (err={ctypes.get_last_error()})")
    committed = False
    try:
        for vid, langs in existing_ver:
            for lang in langs or [LANG_EN_US]:
                k32.UpdateResourceW(hupdate, ctypes.c_void_p(RT_VERSION), _res_id_ptr(vid), lang, None, 0)
        buf = ctypes.create_string_buffer(payload, len(payload))
        ok = k32.UpdateResourceW(hupdate, ctypes.c_void_p(RT_VERSION), ctypes.c_void_p(1), LANG_EN_US, buf, len(payload))
        if not ok:
            raise OSError(f"UpdateResourceW(RT_VERSION) failed (err={ctypes.get_last_error()})")
        if not k32.EndUpdateResourceW(hupdate, False):
            raise OSError(f"EndUpdateResourceW(RT_VERSION) failed (err={ctypes.get_last_error()})")
        committed = True
    finally:
        if not committed:
            k32.EndUpdateResourceW(hupdate, True)
    return {"exe": str(exe_path), "product_name": product_name, "bytes": len(payload)}


def compile_launcher_exe(src_cs: Path, ico_path: Path, out_exe: Path) -> Path:
    """Compile a zero-console Windows GUI launcher .exe with the embedded .ico."""
    windir = Path(os.environ.get("WINDIR", r"C:\Windows"))
    csc = windir / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    if not csc.is_file():
        csc = windir / "Microsoft.NET/Framework/v4.0.30319/csc.exe"
    if not csc.is_file():
        raise FileNotFoundError(f"C# compiler csc.exe not found under {windir}")
    out_exe.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(csc),
        "/nologo",
        "/target:winexe",
        "/platform:anycpu",
        "/optimize+",
        "/codepage:65001",
        f"/win32icon:{ico_path.resolve()}",
        f"/out:{out_exe.resolve()}",
        str(src_cs.resolve()),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not out_exe.is_file():
        raise RuntimeError(f"csc launcher build failed ({proc.returncode}): {proc.stdout}\n{proc.stderr}")
    return out_exe

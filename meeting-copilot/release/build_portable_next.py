"""Build a clean, isolated Windows portable test release from the verified portable baseline.

Never modifies the baseline directory or overwrites an existing output directory or zip.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
ROOT = PROJECT.parent

spec_bp = importlib.util.spec_from_file_location("build_portable", HERE / "build_portable.py")
bp = importlib.util.module_from_spec(spec_bp)
spec_bp.loader.exec_module(bp)

spec_pb = importlib.util.spec_from_file_location("patch_baseline", HERE / "patch_baseline.py")
pb = importlib.util.module_from_spec(spec_pb)
spec_pb.loader.exec_module(pb)

spec_iu = importlib.util.spec_from_file_location("icon_util", HERE / "icon_util.py")
iu = importlib.util.module_from_spec(spec_iu)
spec_iu.loader.exec_module(iu)

MAIN = "out/main/index.js"
ASR_WORKER = "out/main/asrWorker.js"
PRELOAD = "out/preload/index.js"
RENDERER_JS = "out/renderer/assets/index-hyFYaQxP.js"
RENDERER_CSS = "out/renderer/assets/index-BJg-OUFD.css"
LEGACY_SETUP_HTML = "out/renderer/setup.html"

RETIRED_SETUP_HTML = b"""<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>MeetingCopilot</title></head>
<body><p>Legacy setup wizard withdrawn; onboarding is unified inside main renderer (index.html).</p></body>
</html>
"""


def sha256_file(file: Path) -> str:
    h = hashlib.sha256()
    with file.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def copy_baseline_runtime(baseline: Path, destination: Path) -> None:
    """Copy the read-only portable runtime skeleton without any user data."""
    app_src = baseline / "app"
    if not (app_src / "MeetingCopilot.exe").is_file() or not (app_src / "resources/app.asar").is_file():
        raise ValueError(f"Invalid portable baseline directory: {baseline}")

    def safe_copy2(src_file: str, dst_file: str) -> str:
        src_p = Path(src_file)
        dst_p = Path(dst_file)
        try:
            return shutil.copy2(src_file, dst_file)
        except PermissionError:
            # Windows FrameServer/COM can keep a registered DirectShow DLL (e.g. softcam.dll)
            # mapped in memory; reuse it if its contents are byte-identical to the baseline.
            if dst_p.is_file() and sha256_file(src_p) == sha256_file(dst_p):
                return dst_file
            raise

    shutil.copytree(
        app_src,
        destination / "app",
        dirs_exist_ok=True,
        copy_function=safe_copy2,
        ignore=shutil.ignore_patterns("*.bak", "*.tmp", "*.log", "__pycache__", "*.pyc"),
    )

    # Sync latest editable backend modules from repository into packaged tools
    tools = destination / "app/resources/tools"
    tools.mkdir(parents=True, exist_ok=True)
    for file in (PROJECT / "v2").glob("*.cjs"):
        target = tools / "knowledge-v2" / file.name
        target.parent.mkdir(exist_ok=True)
        shutil.copy2(file, target)

    for rel in [
        "window-controls.cjs",
        "written-window.cjs",
        "shortcut-runtime.cjs",
        "quiet-capture.cjs",
        "interview-export.cjs",
        "interview-prompt.cjs",
        "eye-contact.cjs",
        "maxine-sdk.cjs",
    ]:
        src = PROJECT / rel
        if src.is_file():
            shutil.copy2(src, tools / src.name)

    extra_tools_dir = PROJECT / "tools"
    if extra_tools_dir.is_dir():
        for src in extra_tools_dir.glob("*.cjs"):
            shutil.copy2(src, tools / src.name)

    shutil.copy2(HERE / "portable-bootstrap.cjs", tools / "portable-bootstrap.cjs")

    quiet_exe = ROOT / "bin/QuietCapture.exe"
    if quiet_exe.is_file():
        shutil.copy2(quiet_exe, tools / "QuietCapture.exe")

    multimodal_src = PROJECT / "multimodal-router.cjs"
    if multimodal_src.is_file():
        shutil.copy2(multimodal_src, destination / "app/resources/multimodal/multimodal-router.cjs")

    # Sync custom Nailong app/tray icon assets and stamp into packaged Electron EXE
    assets_dir = PROJECT / "assets"
    res_dir = destination / "app/resources/resources"
    res_dir.mkdir(parents=True, exist_ok=True)
    ico_src = assets_dir / "app-icon.ico"
    if ico_src.is_file():
        shutil.copy2(ico_src, res_dir / "app-icon.ico")
        iu.stamp_exe_icon(destination / "app/MeetingCopilot.exe", ico_src)
    png_src = assets_dir / "app-icon.png"
    if png_src.is_file():
        shutil.copy2(png_src, res_dir / "app-icon.png")
    tray_dir = res_dir / "tray"
    tray_dir.mkdir(parents=True, exist_ok=True)
    for tray_name in ("tray.png", "tray@2x.png"):
        tsrc = assets_dir / tray_name
        if tsrc.is_file():
            shutil.copy2(tsrc, tray_dir / tray_name)


def verify_build(destination: Path) -> dict:
    if any((destination / "data").iterdir()):
        raise ValueError("Release data directory must be empty")
    forbidden = {"sessions.json", "Local State", "Preferences", ".env"}
    for file in destination.rglob("*"):
        if file.is_file() and (file.name in forbidden or file.suffix in {".bak", ".log", ".tmp", ".pyc"}):
            raise ValueError(f"Unexpected private or temporary file: {file}")

    for file in (destination / "config").rglob("*.json"):
        json.loads(file.read_text("utf-8"))

    for file in (destination / "app/resources/tools").rglob("*.cjs"):
        subprocess.run(["node", "--check", str(file)], check=True, capture_output=True)

    asar_path = destination / "app/resources/app.asar"
    raw = asar_path.read_bytes()
    header, offset = bp.asar.read_header(raw)

    checks = [
        (MAIN, "main-check.cjs"),
        (ASR_WORKER, "worker-check.cjs"),
        (PRELOAD, "preload-check.cjs"),
        (RENDERER_JS, "renderer-check.mjs"),
    ]
    for member, tmp_name in checks:
        content = bp.asar.read_member(raw, header, offset, member)
        tmp = destination / tmp_name
        try:
            tmp.write_bytes(content)
            subprocess.run(["node", "--check", str(tmp)], check=True, capture_output=True)
        finally:
            tmp.unlink(missing_ok=True)

    private_markers = [str(Path.home()).encode("utf-8"), b"D:\\download\\", b"D:/download/"]
    for name, entry in bp.members(header):
        if not name.startswith("out/") or "offset" not in entry or entry.get("unpacked"):
            continue
        content = bp.asar.read_member(raw, header, offset, name)
        if any(marker in content for marker in private_markers):
            raise ValueError(f"Local personal path found in packaged member: {name}")

    main_bytes = bp.asar.read_member(raw, header, offset, MAIN).decode("utf-8")
    if "openSetupWindow(" in main_bytes.split("electron.ipcMain.handle(IPC.onboardingRerun", 1)[1]:
        raise ValueError("Legacy openSetupWindow() is still invoked by main onboarding paths")

    return {
        "asar_sha256": sha256_file(asar_path),
        "archive_members": len(list(bp.members(header))),
        "blank_profile": True,
        "syntax_check": "passed",
        "archive_readback": "passed",
        "loaded_renderer_entry": "out/renderer/index.html",
        "legacy_setup_window": "withdrawn (routed to in-app V3 QuickStartModal)",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--baseline",
        type=Path,
        default=ROOT / "releases/MeetingCopilot",
        help="Read-only verified portable release directory",
    )
    parser.add_argument("--output", type=Path, required=True, help="Fresh output directory (must not exist)")
    parser.add_argument(
        "--ui-js",
        type=Path,
        default=PROJECT / "ui/dist/index-hyFYaQxP.js",
        help="Compiled renderer JS bundle",
    )
    parser.add_argument(
        "--ui-css",
        type=Path,
        default=PROJECT / "ui/dist/index-BJg-OUFD.css",
        help="Compiled renderer CSS bundle",
    )
    parser.add_argument("--no-zip", action="store_true", help="Skip creating companion .zip archive")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing output directory and companion .zip (refuses to overwrite baseline)",
    )
    parser.add_argument(
        "--skip-baseline-hash",
        action="store_true",
        help="Allow building from a baseline whose ASAR hash differs from the handoff snapshot",
    )
    args = parser.parse_args()

    baseline = args.baseline.resolve()
    destination = args.output.resolve()
    archive = destination.parent / f"{destination.name}.zip"

    if destination == baseline:
        raise ValueError(f"Refusing to overwrite read-only baseline directory: {baseline}")
    if destination.exists():
        if not args.overwrite:
            raise ValueError(f"Output directory already exists: {destination}")
        locked_files: list[Path] = []
        def _on_rm_error(func, failed_path, exc_info):
            err = exc_info[1]
            p = Path(failed_path)
            if isinstance(err, PermissionError) and p.is_file() and p.name.lower() == "softcam.dll":
                locked_files.append(p)
                return
            if locked_files and p.is_dir():
                return
            raise err
        shutil.rmtree(destination, onerror=_on_rm_error)
        if locked_files:
            # Ensure data/ is completely clean even when Windows COM keeps softcam.dll mapped
            data_dir = destination / "data"
            if data_dir.exists():
                shutil.rmtree(data_dir)
    if not args.no_zip and archive.exists():
        if not args.overwrite:
            raise ValueError(f"Output zip already exists: {archive}")
        archive.unlink()

    baseline_asar = baseline / "app/resources/app.asar"
    digest = sha256_file(baseline_asar)
    if not args.skip_baseline_hash and digest != pb.BASELINE_ASAR_SHA256:
        raise ValueError(f"Baseline ASAR hash mismatch: {digest} != {pb.BASELINE_ASAR_SHA256}")

    if not args.ui_js.is_file() or not args.ui_css.is_file():
        raise ValueError(f"Compiled UI assets missing: {args.ui_js} / {args.ui_css}")

    destination.mkdir(parents=True, exist_ok=True)
    copy_baseline_runtime(baseline, destination)

    original = baseline_asar.read_bytes()
    header, offset = bp.asar.read_header(original)
    main_patched = pb.patch_main(bp.asar.read_member(original, header, offset, MAIN))
    worker_patched = pb.patch_asr_worker(bp.asar.read_member(original, header, offset, ASR_WORKER))
    preload_patched = pb.patch_preload(bp.asar.read_member(original, header, offset, PRELOAD))
    replacements = {
        MAIN: main_patched,
        ASR_WORKER: worker_patched,
        PRELOAD: preload_patched,
        RENDERER_JS: args.ui_js.read_bytes(),
        RENDERER_CSS: args.ui_css.read_bytes(),
        LEGACY_SETUP_HTML: RETIRED_SETUP_HTML,
    }
    (destination / "app/resources/app.asar").write_bytes(bp.compact_archive(original, replacements))

    bp.write_configuration(destination)
    # New blank releases default to light theme aligned with the redesigned UI; existing configs remain untouched.
    defaults_settings_path = destination / "config/defaults/settings.json"
    defaults_settings = json.loads(defaults_settings_path.read_text("utf-8"))
    defaults_settings.setdefault("ui", {})["theme"] = "light"
    bp.write_json(defaults_settings_path, defaults_settings)
    bp.write_launchers(destination)

    # Compile a zero-console top-level MeetingCopilot.exe launcher carrying the custom app icon
    launcher_cs = ROOT / "src/MeetingCopilotLauncher.cs"
    ico_src = PROJECT / "assets/app-icon.ico"
    if sys.platform == "win32" and launcher_cs.is_file() and ico_src.is_file():
        iu.compile_launcher_exe(launcher_cs, ico_src, destination / "MeetingCopilot.exe")

    # Copy RAG scripts and docs
    rag = destination / "rag"
    rag.mkdir(exist_ok=True)
    for name in ["service.py", "query_rewrite.py", "requirements.txt"]:
        shutil.copy2(PROJECT / "rag" / name, rag / name)
    shutil.copy2(HERE / "configure-rag.cjs", rag / "configure-rag.cjs")
    for doc_src, doc_name in [
        (HERE / "配置指南.txt", "配置指南.txt"),
        (HERE / "README.txt", "README.txt"),
        (ROOT / "licenses/MeetingCopilot-LICENSE.txt", "LICENSE.MeetingCopilot.txt"),
    ]:
        if doc_src.is_file():
            shutil.copy2(doc_src, destination / doc_name)

    status = verify_build(destination)
    manifest = {
        str(file.relative_to(destination)).replace("\\", "/"): sha256_file(file)
        for file in sorted(destination.rglob("*"))
        if file.is_file()
    }
    bp.write_json(
        destination / "release-manifest.json",
        {
            "name": "MeetingCopilot Integrated Next",
            "upstream_version": "0.2.0-beta.1",
            "baseline_asar_sha256": digest,
            "verification": status,
            "files_sha256": manifest,
        },
    )

    result = {
        "folder": str(destination),
        "files": len(manifest) + 1,
        **status,
    }
    if not args.no_zip:
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
            for file in sorted(destination.rglob("*")):
                if file.is_file():
                    out.write(file, str(Path(destination.name) / file.relative_to(destination)))
        # Verify zipped ASAR matches unpacked ASAR byte-for-byte
        with zipfile.ZipFile(archive, "r") as zf:
            zipped_asar = zf.read(f"{destination.name}/app/resources/app.asar")
            if hashlib.sha256(zipped_asar).hexdigest() != status["asar_sha256"]:
                raise ValueError("Zipped ASAR hash mismatch")
        result["zip"] = str(archive)
        result["zip_bytes"] = archive.stat().st_size

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

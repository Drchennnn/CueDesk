"""Install only the curated RAG adapter and its local Qdrant service."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import install as archive

HERE = Path(__file__).resolve().parent
SUPPORTED_LIBRARY = "edeabd001f2ef5533720eaafa94d372e7eebc1aeb821af9743f2796dc5f1e194"


def read_json(file):
    return json.loads(file.read_text(encoding="utf-8-sig"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, default=Path(os.environ["LOCALAPPDATA"]) / "MeetingCopilot/vector-rag")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    options = read_json(runtime / "options.json")
    report = read_json(runtime / "ingestion-report.json")
    snapshot = read_json(runtime / "snapshot.json")
    validation = read_json(runtime / "retrieval-validation.json")
    if any(item["snapshot_sha256"] != options["snapshot_sha256"] for item in [report, snapshot, validation]):
        raise ValueError("Index and validation snapshots differ")
    if report["entries"] != len(snapshot["entries"]) or report["points"] < report["entries"]:
        raise ValueError("Incomplete vector index")
    for entry in snapshot["entries"]:
        file = Path(options["source_root"]) / entry["file_path"]
        if hashlib.sha256(file.read_bytes()).hexdigest() != entry["document_hash"]:
            raise ValueError("Source changed after indexing: " + entry["entry_id"])
    destination = Path(os.environ["LOCALAPPDATA"]) / "Programs/meeting-copilot/resources/tools/knowledge-v2"
    library = destination / "library.cjs"
    source = HERE / "v2/library.cjs"
    receipt_file = runtime / "installation.json"
    receipt = read_json(receipt_file) if receipt_file.exists() else {}
    if hashlib.sha256(library.read_bytes()).hexdigest() not in {SUPPORTED_LIBRARY, receipt.get("library_sha256"), hashlib.sha256(source.read_bytes()).hexdigest()}:
        raise ValueError("Installed knowledge library changed. Review the current version before installation.")
    config_file = Path(os.environ["APPDATA"]) / "MeetingCopilot/interview-library.json"
    config = read_json(config_file)
    if Path(config["root"]).resolve() != Path(options["library_root"]).resolve():
        raise ValueError("Library root changed")
    replacements = {destination / name: HERE / "v2" / name for name in ["library.cjs", "vector-source.cjs", "vector-client.cjs", "dialogue.cjs", "turn-policy.cjs", "evidence.cjs"]}
    replacements[runtime / "service.py"] = HERE / "rag/service.py"
    replacements[runtime / "query_rewrite.py"] = HERE / "rag/query_rewrite.py"
    # Update the preview hint because embedding, rewriting and reranking use APIs.
    asar_file = destination.parents[1] / "app.asar"
    original = asar_file.read_bytes()
    header, offset = archive.read_header(original)
    old_hint = "输入问题，检查将使用的资料（不请求 API）"
    new_hint = "输入问题预览资料（向量模式调用纠错、Embedding 和重排 API，不生成回答）"
    renderer = next("out/renderer/assets/" + name for name in
                    header["files"]["out"]["files"]["renderer"]["files"]["assets"]["files"]
                    if name.endswith(".js") and "资料检索测试问题" in
                    archive.read_member(original, header, offset, "out/renderer/assets/" + name).decode("utf-8"))
    content = archive.read_member(original, header, offset, renderer).decode("utf-8")
    if content.count(old_hint) == 1:
        changed = content.replace(old_hint, new_hint)
        check_file = runtime / "renderer-check.mjs"
        check_file.write_text(changed, encoding="utf-8")
        subprocess.run(["node", "--check", str(check_file)], check=True)
        stage_archive = runtime / "preview-hint.asar"
        stage_archive.write_bytes(archive.replace_member(original, renderer, changed.encode("utf-8")))
        replacements[asar_file] = stage_archive
    elif new_hint not in content:
        raise ValueError("Unknown preview hint version")
    for file in replacements.values():
        if file.suffix == ".cjs":
            subprocess.run(["node", "--check", str(file)], check=True)
        elif file.suffix == ".py":
            compile(file.read_text(encoding="utf-8"), str(file), "exec")
    if args.check:
        print("Source hashes, complete ingestion, validation snapshot and module syntax passed")
        return
    running = subprocess.run(["powershell", "-NoProfile", "-Command",
        "if (Get-Process MeetingCopilot -ErrorAction SilentlyContinue) { exit 1 }"], capture_output=True)
    if running.returncode:
        raise RuntimeError("Close MeetingCopilot before installing the adapter")
    backup = runtime / "backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    backup.mkdir(parents=True)
    shutil.copy2(config_file, backup / config_file.name)
    previous = {}
    for target in replacements:
        previous[target] = target.exists()
        if target.exists():
            shutil.copy2(target, backup / target.name)
    try:
        for target, origin in replacements.items():
            stage = target.with_suffix(target.suffix + ".vector-stage")
            shutil.copy2(origin, stage)
            os.replace(stage, target)
        config["vector_rag"] = options
        stage = config_file.with_suffix(".vector-stage")
        stage.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(stage, config_file)
        receipt_stage = receipt_file.with_suffix(".tmp")
        receipt_stage.write_text(json.dumps({"library_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                                            "backup": str(backup)}, indent=2), encoding="utf-8")
        os.replace(receipt_stage, receipt_file)
    except Exception:
        shutil.copy2(backup / config_file.name, config_file)
        for target, existed in previous.items():
            if existed:
                shutil.copy2(backup / target.name, target)
            elif target.exists():
                target.unlink()
        raise
    print(json.dumps({"installed": True, "backup": str(backup), "entries": report["entries"],
                      "model": report["model"], "dimensions": report["dimensions"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()

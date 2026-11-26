"""Minimal ASAR archive reader/writer with SHA-256 block integrity support."""
from __future__ import annotations

import hashlib
import json
import struct


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_header(archive: bytes):
    size, header_size, _, json_size = struct.unpack_from("<4I", archive)
    if size != 4 or json_size > header_size - 8 or header_size + 8 > len(archive):
        raise ValueError("Invalid ASAR header")
    return json.loads(archive[16:16 + json_size]), 8 + header_size


def entry_for(header: dict, filename: str) -> dict:
    entry = header
    for part in filename.split("/"):
        entry = entry["files"][part]
    if entry.get("unpacked") or "offset" not in entry:
        raise ValueError("Expected a packed file: " + filename)
    return entry


def read_member(archive: bytes, header: dict, data_start: int, filename: str) -> bytes:
    entry = entry_for(header, filename)
    start = data_start + int(entry["offset"])
    return archive[start:start + entry["size"]]


def replace_member(archive: bytes, filename: str, content: bytes) -> bytes:
    header, data_start = read_header(archive)
    entry = entry_for(header, filename)
    block_size = entry.get("integrity", {}).get("blockSize", 4194304)
    entry.update(
        size=len(content),
        offset=str(len(archive) - data_start),
        integrity={
            "algorithm": "SHA256",
            "hash": sha256(content),
            "blockSize": block_size,
            "blocks": [sha256(content[i:i + block_size]) for i in range(0, len(content), block_size)],
        },
    )
    encoded = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    payload = struct.pack("<I", len(encoded)) + encoded
    payload += b"\0" * (-len(payload) % 4)
    header_pickle = struct.pack("<I", len(payload)) + payload
    return struct.pack("<II", 4, len(header_pickle)) + header_pickle + archive[data_start:] + content


def replace_members(archive: bytes, replacements: dict[str, bytes]) -> bytes:
    for filename, content in replacements.items():
        archive = replace_member(archive, filename, content)
    return archive

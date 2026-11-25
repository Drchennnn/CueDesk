"""Exact-once anchor patches for the portable 0.2.0-beta.1 main and preload entries."""
from __future__ import annotations

BASELINE_ASAR_SHA256 = "fd6b8422c15ad9f26ee489b865306646247a71fc2c0e6bdf080962aac5477907"


def replace_once(text: str, before: str, after: str, label: str = "") -> str:
    count = text.count(before)
    if count != 1:
        hint = label or before[:100]
        raise ValueError(f"Expected anchor once (found {count}) at {hint}")
    return text.replace(before, after, 1)


def patch_main(raw: bytes) -> bytes:
    """Apply incremental main-process enhancements onto the verified portable baseline."""
    text = raw.decode("utf-8")

    # Fix existing baseline bug where shotEvidence passed a function instead of an options object to multimodalRouter.chat
    old_shot_opts = "ac.signal, unifiedProgress(sendEv, payload.requestId), shotEvidence ? (() => {}) : unifiedResults(sendEv, payload.requestId)"
    new_shot_opts = "ac.signal, unifiedProgress(sendEv, payload.requestId), shotEvidence ? {} : unifiedResults(sendEv, payload.requestId)"
    if old_shot_opts in text:
        text = replace_once(text, old_shot_opts, new_shot_opts, "shotAsk options fix")

    return text.encode("utf-8")


def patch_preload(raw: bytes) -> bytes:
    """Apply incremental preload IPC enhancements onto the verified portable baseline."""
    text = raw.decode("utf-8")
    return text.encode("utf-8")

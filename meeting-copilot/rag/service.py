"""Qwen embeddings + official Qdrant local storage and hybrid Query API."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import threading
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager

from dashscope import TextEmbedding, TextReRank
from fastapi import FastAPI, HTTPException
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient, models
import uvicorn
import psutil
from query_rewrite import QueryRewriter


def read_json(file):
    return json.loads(Path(file).read_text(encoding="utf-8-sig"))


def write_json(file, value):
    target = Path(file)
    stage = target.with_suffix(".tmp")
    stage.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(stage, target)


class VectorIndex:
    def __init__(self, config):
        self.config = config
        self.snapshot = read_json(config["snapshot"])
        self.client = QdrantClient(path=config["storage"], force_disable_check_same_thread=True)
        self.lock = threading.RLock()
        self.cache = OrderedDict()
        self.result_cache = OrderedDict()
        self.chunks = {c["chunk_id"]: c["content"] for e in self.snapshot["entries"] for c in e["chunks"]}
        self.stats = {}
        self.rewriter = QueryRewriter(config)

    def embed(self, texts, text_type):
        # Use the official provider SDK. Retry only transient failures.
        attempts = 4 if text_type == "document" else 1
        for attempt in range(attempts):
            response = TextEmbedding.call(
                model=self.config["model"], input=texts,
                api_key=os.environ["DASHSCOPE_API_KEY"],
                dimension=self.config["dimensions"], text_type=text_type,
                output_type="dense&sparse", timeout=20 if text_type == "document" else 3,
                base_address=self.config["base_address"],
            )
            if response.status_code == 200:
                items = sorted(response.output["embeddings"], key=lambda item: item["text_index"])
                if len(items) != len(texts):
                    raise ValueError("Embedding response count mismatch")
                for item in items:
                    dense = item["embedding"]
                    if len(dense) != self.config["dimensions"] or not all(math.isfinite(x) for x in dense):
                        raise ValueError("Invalid dense embedding")
                    sparse = item.get("sparse_embedding", [])
                    if not sparse:
                        raise ValueError("Qwen sparse embedding is missing")
                return items, response.usage.get("total_tokens", 0)
            if response.status_code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise RuntimeError(f"Qwen Embedding HTTP {response.status_code}, code {response.code}")
            time.sleep(2 ** attempt)

    @staticmethod
    def vectors(item):
        sparse = item["sparse_embedding"]
        return {"dense": item["embedding"], "sparse": models.SparseVector(
            indices=[term["index"] for term in sparse], values=[term["value"] for term in sparse]
        )}

    def records(self):
        # UTF-8 bytes are a conservative upper bound for the Qwen BPE token count.
        # Preserve each native citation block, splitting only its search vectors.
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=7000, chunk_overlap=400,
            length_function=lambda text: len(text.encode("utf-8")),
            separators=["\n\n", "\n", "。", "；", " ", ""],
        )
        result = []
        for entry in self.snapshot["entries"]:
            for chunk in entry["chunks"]:
                prefix = entry["question"] + "\n"
                if len(prefix.encode("utf-8")) > 1000:
                    raise ValueError("Question title exceeds indexing budget")
                for number, text in enumerate(splitter.split_text(chunk["content"])):
                    text = prefix + text
                    if len(text.encode("utf-8")) > 8000:
                        raise ValueError("Embedding input exceeds conservative token budget")
                    identity = entry["entry_id"] + ":" + chunk["content_hash"] + ":" + str(number)
                    payload = {
                        "entry_id": entry["entry_id"], "question": entry["question"],
                        "document_id": entry["document_id"], "document_hash": entry["document_hash"],
                        "chunk_id": chunk["chunk_id"], "content_hash": chunk["content_hash"],
                        "document_type": "technical_reference", "personal_experience": False,
                        "source_location": chunk["source_location"], "sources": entry["sources"],
                        "file_path": entry["file_path"], "segment": number,
                    }
                    result.append((str(uuid.uuid5(uuid.NAMESPACE_URL, identity)), text, payload))
        return result

    def sync(self):
        records = self.records()
        signature = {"snapshot": self.snapshot["snapshot_sha256"], "model": self.config["model"],
                     "dimensions": self.config["dimensions"], "base_address": self.config["base_address"],
                     "recipe": "qwen-dense-sparse-utf8-7000-overlap400-v1"}
        digest = hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()
        collection = "interview_" + digest[:24]
        alias = self.config["collection_alias"]
        aliases = {a.alias_name: a.collection_name for a in self.client.get_aliases().aliases}
        if aliases.get(alias) == collection and self.client.count(collection).count == len(records):
            self.stats = read_json(self.config["report"])
            return
        if self.client.collection_exists(collection):
            self.client.delete_collection(collection)  # Incomplete derived build from an interrupted run.
        self.client.create_collection(
            collection_name=collection,
            vectors_config={"dense": models.VectorParams(size=self.config["dimensions"], distance=models.Distance.COSINE)},
            sparse_vectors_config={"sparse": models.SparseVectorParams()},
        )
        started = time.perf_counter()
        tokens = 0
        # Cache batches on disk so a retry or rate-limit interruption avoids rebilling completed work.
        cache = Path(self.config["embedding_cache"]) / digest
        cache.mkdir(parents=True, exist_ok=True)
        for offset in range(0, len(records), 10):
            batch = records[offset:offset + 10]
            file = cache / f"{offset:05d}.json"
            if file.exists():
                saved = read_json(file)
                items, usage = saved["items"], saved["tokens"]
            else:
                items, usage = self.embed([record[1] for record in batch], "document")
                write_json(file, {"items": items, "tokens": usage})
            tokens += usage
            self.client.upsert(collection_name=collection, wait=True, points=[
                models.PointStruct(id=record[0], vector=self.vectors(item), payload=record[2])
                for record, item in zip(batch, items)
            ])
            if offset % 100 == 0:
                print(json.dumps({"indexed": min(offset + 10, len(records)), "total": len(records)}), flush=True)
        if self.client.count(collection).count != len(records):
            raise ValueError("Qdrant point count mismatch")
        changes = []
        if alias in aliases:
            changes.append(models.DeleteAliasOperation(delete_alias=models.DeleteAlias(alias_name=alias)))
        changes.append(models.CreateAliasOperation(create_alias=models.CreateAlias(alias_name=alias, collection_name=collection)))
        self.client.update_collection_aliases(change_aliases_operations=changes)
        self.stats = {
            "snapshot_sha256": self.snapshot["snapshot_sha256"], "model": self.config["model"],
            "dimensions": self.config["dimensions"], "entries": len(self.snapshot["entries"]),
            "native_chunks": sum(len(e["chunks"]) for e in self.snapshot["entries"]),
            "points": len(records), "embedding_tokens": tokens,
            "seconds": round(time.perf_counter() - started, 2), "collection": collection,
            "max_embedding_utf8_bytes": max(len(r[1].encode("utf-8")) for r in records),
        }
        write_json(self.config["report"], self.stats)
        print(json.dumps(self.stats, ensure_ascii=False), flush=True)

    def search(self, question, limit, context_question="", previous_assistant_draft=""):
        started = time.perf_counter()
        cache_key = (question, context_question, previous_assistant_draft)
        with self.lock:
            if cache_key in self.result_cache:
                cached = self.result_cache[cache_key]
                return {**cached, "hits": cached["hits"][:limit], "milliseconds": round(1000 * (time.perf_counter() - started), 1)}
            plan = self.rewriter.prepare(question, context_question, previous_assistant_draft)
            missing = [text for text in plan["queries"] if text not in self.cache]
            if missing:
                items, _ = self.embed(missing, "query")
                for text, item in zip(missing, items):
                    self.cache[text] = self.vectors(item)
            prefetch = []
            for text in plan["queries"]:
                query = self.cache[text]
                prefetch.extend([models.Prefetch(query=query["dense"], using="dense", limit=60),
                                 models.Prefetch(query=query["sparse"], using="sparse", limit=60)])
            while len(self.cache) > 128:
                self.cache.popitem(last=False)
            result = self.client.query_points_groups(
                collection_name=self.config["collection_alias"], group_by="entry_id", group_size=1,
                prefetch=prefetch,
                query=models.FusionQuery(fusion=models.Fusion.RRF), limit=24, with_payload=True,
            )
            hits = [{**group.hits[0].payload, "score": group.hits[0].score} for group in result.groups]
            rerank_active = False
            warning = plan["warning"]
            if hits and self.config.get("rerank_model"):
                try:
                    ranked = TextReRank.call(
                        model=self.config["rerank_model"], query=plan["query"],
                        documents=[self.chunks[hit["chunk_id"]] for hit in hits], top_n=24,
                        return_documents=False, api_key=os.environ["DASHSCOPE_API_KEY"],
                        base_address=self.config["base_address"], timeout=4,
                    )
                    if ranked.status_code != 200:
                        raise RuntimeError("Rerank API unavailable")
                    hits = [{**hits[item["index"]], "rerank_score": item["relevance_score"]}
                            for item in ranked.output["results"]
                            if item["relevance_score"] >= self.config.get("minimum_rerank_score", 0.25)]
                    rerank_active = True
                except Exception:
                    warning = "；".join(filter(None, [warning, "Qwen 重排暂不可用，使用 Qdrant 混合检索排序"]))
            response = {"snapshot_sha256": self.snapshot["snapshot_sha256"], "model": self.config["model"],
                        "rerank_active": rerank_active, "query_plan": plan, "warning": warning, "hits": hits[:20]}
            if not warning:
                self.result_cache[cache_key] = response
            if len(self.result_cache) > 128:
                self.result_cache.popitem(last=False)
        return {**response, "hits": response["hits"][:limit], "milliseconds": round(1000 * (time.perf_counter() - started), 1)}


class SearchRequest(BaseModel):
    question: str = Field(min_length=1, max_length=6000)
    context_question: str = Field(default="", max_length=8000)
    previous_assistant_draft: str = Field(default="", max_length=1400)
    limit: int = Field(default=8, ge=1, le=20)


def create_app(index):
    @asynccontextmanager
    async def lifespan(app):
        yield
        index.client.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.get("/health")
    def health():
        return {"snapshot_sha256": index.snapshot["snapshot_sha256"], **index.stats}

    @app.post("/search")
    def search(request: SearchRequest):
        try:
            return index.search(request.question, request.limit, request.context_question, request.previous_assistant_draft)
        except Exception as error:
            # Log only the exception class. Provider bodies may include request text.
            print("Search failed: " + type(error).__name__, flush=True)
            raise HTTPException(503, "Embedding or vector search unavailable") from None

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--sync-only", action="store_true")
    parser.add_argument("--parent-pid", type=int)
    args = parser.parse_args()
    config = read_json(args.config)
    index = VectorIndex(config)
    try:
        index.sync()
        if not args.sync_only:
            server = uvicorn.Server(uvicorn.Config(create_app(index), host="127.0.0.1", port=config["port"],
                                                   log_level="warning", access_log=False))
            if args.parent_pid:
                def parent_exit():
                    try:
                        psutil.Process(args.parent_pid).wait()
                    except psutil.NoSuchProcess:
                        pass
                    server.should_exit = True
                threading.Thread(target=parent_exit, daemon=True).start()
            server.run()
    finally:
        index.client.close()


if __name__ == "__main__":
    main()

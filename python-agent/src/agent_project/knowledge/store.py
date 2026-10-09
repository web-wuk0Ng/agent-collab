"""知识库与题库：加载 + BM25 检索（RAG）。

**与 Node 面试系统共用同一份语料**（``data/questions/*.json`` 与
``data/knowledge/*.md``），所以「同一个岗位、同一批考点」在两端结果一致。
数据目录可用环境变量 ``MM_DATA_DIR`` 覆盖（默认指向仓库根的 ``data/``）。
"""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# 仓库根目录：<repo>/python-agent/src/agent_project/knowledge/store.py
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[4] / "data"


def data_dir() -> Path:
    """解析数据目录（环境变量优先）。"""
    override = os.getenv("MM_DATA_DIR")
    return Path(override).expanduser().resolve() if override else DEFAULT_DATA_DIR


def tokenize(text: str) -> list[str]:
    """分词：英文单词 + 中文 2-gram，与 Node 端 ``lib/rag.js`` 保持一致。"""
    text = text.lower()
    tokens = re.findall(r"[a-z][a-z0-9+.#/-]+", text)
    zh = re.sub(r"[^\u4e00-\u9fa5]", " ", text)
    for segment in zh.split():
        if len(segment) < 2:
            continue
        tokens.extend(segment[i : i + 2] for i in range(len(segment) - 1))
    return tokens


@dataclass
class Chunk:
    """知识库切片。"""

    title: str
    text: str
    tf: dict[str, int] = field(default_factory=dict)
    length: int = 0


@dataclass
class Bank:
    """岗位题库。"""

    position: str
    name: str = ""
    intro: str = ""
    skills: list[str] = field(default_factory=list)
    questions: list[dict] = field(default_factory=list)

    def question(self, question_id: str) -> dict | None:
        for item in self.questions:
            if item.get("id") == question_id:
                return item
        return None

    def pick(self, question_type: str) -> dict | None:
        for item in self.questions:
            if item.get("type") == question_type:
                return item
        return None


def split_markdown(md: str) -> list[tuple[str, str]]:
    """按二级标题把知识库 Markdown 切片。"""
    chunks: list[tuple[str, str]] = []
    for part in re.split(r"\n(?=## )", md):
        match = re.search(r"^## (.+)$", part, re.MULTILINE)
        title = match.group(1).strip() if match else "概述"
        text = re.sub(r"^## .+$", "", part, count=1, flags=re.MULTILINE).strip()
        if len(text) < 30:
            continue
        chunks.append((title, text))
    return chunks


class KnowledgeStore:
    """岗位题库 + 知识库检索。"""

    def __init__(self, directory: Path | str | None = None) -> None:
        self.dir = Path(directory).resolve() if directory else data_dir()
        self.banks: dict[str, Bank] = {}
        self.corpus: dict[str, list[Chunk]] = {}
        self.load()

    # ---------- 加载 ----------

    def load(self) -> None:
        self.banks.clear()
        self.corpus.clear()
        self._load_banks()
        self._load_knowledge()

    def _load_banks(self) -> None:
        qdir = self.dir / "questions"
        if not qdir.is_dir():
            return
        for file in sorted(qdir.glob("*.json")):
            try:
                raw = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            position = str(raw.get("position") or file.stem)
            self.banks[position] = Bank(
                position=position,
                name=str(raw.get("name") or position),
                intro=str(raw.get("intro") or ""),
                skills=[str(s) for s in raw.get("skills") or []],
                questions=[q for q in (raw.get("questions") or []) if isinstance(q, dict)],
            )

    def _load_knowledge(self) -> None:
        kdir = self.dir / "knowledge"
        if not kdir.is_dir():
            return
        for file in sorted(kdir.glob("*.md")):
            try:
                md = file.read_text(encoding="utf-8")
            except OSError:
                continue
            chunks: list[Chunk] = []
            for title, text in split_markdown(md):
                tokens = tokenize(f"{title} {text}")
                tf: dict[str, int] = {}
                for token in tokens:
                    tf[token] = tf.get(token, 0) + 1
                chunks.append(Chunk(title=title, text=text, tf=tf, length=len(tokens)))
            self.corpus[file.stem] = chunks

    # ---------- 查询 ----------

    def positions(self) -> list[dict]:
        return [
            {
                "id": bank.position,
                "name": bank.name,
                "intro": bank.intro,
                "skills": bank.skills,
                "questionCount": len(bank.questions),
            }
            for bank in self.banks.values()
        ]

    def bank(self, position: str) -> Bank | None:
        return self.banks.get(position)

    def question(self, position: str, question_id: str) -> dict | None:
        bank = self.banks.get(position)
        return bank.question(question_id) if bank else None

    def search(self, position: str, query: str, k: int = 4) -> list[dict]:
        """BM25 检索（k1=1.5, b=0.75，与 Node 端实现一致）。"""
        chunks = self.corpus.get(position) or []
        if not chunks or not query:
            return []

        query_tf: dict[str, int] = {}
        for token in tokenize(query):
            query_tf[token] = query_tf.get(token, 0) + 1

        total = len(chunks)
        avg_len = sum(c.length for c in chunks) / total or 1.0
        k1, b = 1.5, 0.75

        scored: list[dict] = []
        for chunk in chunks:
            score = 0.0
            for token, qtf in query_tf.items():
                if token not in chunk.tf:
                    continue
                df = sum(1 for c in chunks if token in c.tf)
                idf = math.log(1 + (total - df + 0.5) / (df + 0.5))
                numerator = chunk.tf[token] * (k1 + 1)
                denominator = chunk.tf[token] + k1 * (1 - b + b * chunk.length / avg_len)
                score += idf * numerator / denominator * qtf
            if score > 0:
                scored.append({"title": chunk.title, "text": chunk.text, "score": round(score, 3)})

        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[:k]

    def context(self, position: str, query: str, k: int = 4) -> str:
        """检索并拼接为 Prompt 可用的参考资料文本。"""
        hits = self.search(position, query, k)
        if not hits:
            return ""
        return "\n\n".join(
            f"【参考资料{i + 1}·{hit['title']}】\n{hit['text']}" for i, hit in enumerate(hits)
        )

    def stats(self) -> dict:
        return {
            "positions": len(self.banks),
            "questions": sum(len(b.questions) for b in self.banks.values()),
            "knowledgeFiles": len(self.corpus),
            "knowledgeChunks": sum(len(c) for c in self.corpus.values()),
            "dataDir": str(self.dir),
        }


@lru_cache(maxsize=1)
def get_store() -> KnowledgeStore:
    """进程级单例（首次调用时加载语料）。"""
    return KnowledgeStore()


def reload_store() -> KnowledgeStore:
    """热加载语料（导入新题库后调用）。"""
    get_store.cache_clear()
    return get_store()

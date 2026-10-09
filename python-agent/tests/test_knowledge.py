"""知识库检索测试。"""

from pathlib import Path

import pytest

from agent_project.knowledge.store import KnowledgeStore, split_markdown, tokenize

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@pytest.fixture(scope="module")
def store() -> KnowledgeStore:
    return KnowledgeStore(DATA_DIR)


def test_store_loads_banks_and_corpus(store: KnowledgeStore):
    positions = store.positions()
    assert len(positions) >= 3
    assert all(item["questionCount"] > 0 for item in positions)
    stats = store.stats()
    assert stats["knowledgeChunks"] > 0


def test_tokenize_mixes_chinese_and_english():
    tokens = tokenize("HashMap 的扩容机制")
    assert "hashmap" in tokens
    assert "扩容" in tokens


def test_split_markdown_by_heading():
    chunks = split_markdown(
        "# 标题\n\n## 考点：缓存\n" + "内容" * 20 + "\n\n## 考点：锁\n" + "内容" * 20
    )
    titles = [title for title, _ in chunks]
    assert "考点：缓存" in titles
    assert "考点：锁" in titles


def test_search_returns_relevant_hits(store: KnowledgeStore):
    hits = store.search("java-backend", "HashMap 红黑树 扩容", 3)
    assert hits, "应该能检索到与 HashMap 相关的考点"
    assert hits[0]["score"] >= hits[-1]["score"]
    assert "HashMap" in hits[0]["text"] or "HashMap" in hits[0]["title"]


def test_context_contains_reference_headers(store: KnowledgeStore):
    context = store.context("java-backend", "线程池 拒绝策略", 2)
    assert "【参考资料1" in context


def test_search_unknown_position_returns_empty(store: KnowledgeStore):
    assert store.search("not-exist", "任意查询") == []

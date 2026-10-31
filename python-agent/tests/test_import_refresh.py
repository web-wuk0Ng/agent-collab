import json

from agent_project.knowledge.store import KnowledgeStore


def test_question_reference_is_searchable(tmp_path):
    (tmp_path / "questions").mkdir()
    (tmp_path / "knowledge").mkdir()
    bank = {"position": "java-backend", "name": "后端", "questions": [{
        "id": "custom_1", "text": "如何验证星河观测协议？", "keywords": ["星河观测"],
        "points": ["请求版本校验"],
        "reference": "星河观测协议通过请求版本识别过期响应，取消后旧版本不再更新界面，应验证监听和资源都已释放。",
        "sources": []
    }]}
    (tmp_path / "questions" / "java-backend.json").write_text(json.dumps(bank), encoding="utf-8")
    store = KnowledgeStore(tmp_path)
    assert store.search("java-backend", "星河观测协议")[0]["text"].startswith("星河观测")


def test_live_import_refreshes_cached_store(tmp_path):
    (tmp_path / "questions").mkdir()
    (tmp_path / "knowledge").mkdir()
    file = tmp_path / "questions" / "java-backend.json"
    bank = {"position": "java-backend", "questions": []}
    file.write_text(json.dumps(bank), encoding="utf-8")
    store = KnowledgeStore(tmp_path)
    assert store.search("java-backend", "星河观测") == []
    bank["questions"].append({"id": "new_1", "text": "星河观测如何恢复？", "points": [],
                              "reference": "星河观测使用检查点和当前请求版本恢复，回填前检查状态，旧的回调失效后不能继续触发资源访问。"})
    file.write_text(json.dumps(bank), encoding="utf-8")
    assert store.question("java-backend", "new_1")
    assert store.search("java-backend", "星河观测")[0]["title"] == "星河观测如何恢复？"

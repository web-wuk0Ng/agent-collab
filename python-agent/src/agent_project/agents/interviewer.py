"""InterviewerAgent —— 用仓库的 ``BaseAgent`` 骨架实现的 AI 面试官。

它的「思考」链路（对应 ``think()`` 与三个业务方法）：

1. **检索**：从岗位知识库 BM25 检索与当前题目相关的考点片段（RAG）；
2. **决策**：结合题目、候选人回答、语音指标，决定下一句话是**追问**、
   **过渡到下一题**、**开场**还是**收尾**；
3. **评估**：汇总全部问答记录，产出结构化评估报告（多维度评分 + 提升计划）；
4. **兜底**：大模型不可用时自动降级为规则引擎，保证面试服务始终可用。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from agent_project.core.agent import BaseAgent
from agent_project.core.llm import LLMClient, parse_json_loose
from agent_project.knowledge.store import KnowledgeStore, get_store

DIMENSION_NAMES = {
    "content": "技术正确性",
    "depth": "知识深度",
    "logic": "逻辑严谨性",
    "match": "岗位匹配度",
    "expression": "语言表达",
}

STAGE_OPENERS = {
    "warm": "好的，我们进入下一部分。",
    "core": "好的，接下来是技术环节。",
    "deep": "很好，那我们聊深入一点。",
}


def clamp_score(value: Any) -> int:
    """把任意输入夹到 0~100 的整数分。"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number != number:  # NaN
        return 0
    return max(0, min(100, round(number)))


def mean(values: list[float]) -> int:
    return round(sum(values) / len(values)) if values else 60


@dataclass
class AgentReply:
    """面试官的一次发言。"""

    text: str
    engine: str = "offline"
    references: list[str] = field(default_factory=list)


class InterviewerAgent(BaseAgent):
    """AI 面试官 Agent。"""

    name = "interviewer"
    position: str = ""  # 当前会话岗位（think() 自由问答时使用）

    def __init__(
        self,
        store: KnowledgeStore | None = None,
        client: LLMClient | None = None,
    ) -> None:
        super().__init__(name="interviewer")
        self.store = store or get_store()
        self.client = client or LLMClient()

    # ------------------------------------------------------------------
    # BaseAgent 协议：think() —— 自由问答（供 /chat 与联调使用）
    # ------------------------------------------------------------------

    def think(self, user_input: str) -> str:
        position = self._position_name(self.position or "")
        if self.client.configured:
            try:
                return self.client.chat(
                    [
                        {"role": "system", "content": self._system_prompt(position)},
                        {"role": "user", "content": user_input},
                    ],
                    temperature=0.6,
                    max_tokens=400,
                )
            except Exception:  # noqa: BLE001 - 降级为规则回复
                pass
        return (
            f"（离线模式）我是「{position}」方向的 AI 面试官。"
            "请在网页上选择岗位并开始一场完整的模拟面试，我会结合岗位知识库提问、追问并给出评估报告。"
        )

    # 会话中的岗位（think() 自由问答时使用）
    # ------------------------------------------------------------------
    # 业务能力：开场 / 追问 / 过渡 / 评估
    # ------------------------------------------------------------------

    def greeting(self, position: str, question: dict, rounds: int = 6) -> AgentReply:
        """生成开场白（并把第一道题自然地抛出来）。"""
        self.position = position
        text = ""
        if self.client.configured:
            try:
                text = self.client.chat(
                    [
                        {"role": "system", "content": self._system_prompt(position)},
                        {
                            "role": "user",
                            "content": (
                                f"面试开始。第一道题目是：「{question.get('text', '')}」。"
                                "请输出开场欢迎语并自然地抛出这道题。"
                            ),
                        },
                    ],
                    temperature=0.7,
                    max_tokens=300,
                )
            except Exception:  # noqa: BLE001
                text = ""
        if not text:
            text = (
                f"你好，欢迎参加本次模拟面试。我是你的 AI 面试官，今天面试的岗位方向是"
                f"「{self._position_name(position)}」，大约 {rounds} 个问题。请放轻松，"
                "尽量把你的思考过程讲清楚。那我们开始第一个问题："
            )
        return AgentReply(text=text, engine=self.engine, references=[])

    def follow_up(
        self,
        position: str,
        question: dict,
        answer: str,
        metrics: dict | None = None,
    ) -> AgentReply:
        """针对一次不充分的回答提出追问。"""
        self.position = position
        context = self.store.context(position, question.get("text", ""), 2)
        references = [
            hit["title"] for hit in self.store.search(position, question.get("text", ""), 2)
        ]

        if self.client.configured:
            try:
                reference_block = self._reference_block(context)
                prompt = (
                    f"当前题目（类型：{question.get('type', 'tech')}）："
                    f"{question.get('text', '')}\n"
                    f"候选人首答：{answer}\n"
                    f"{self._metrics_line(metrics)}"
                    f"{reference_block}"
                    "请针对这个回答提出一个追问：聚焦其含糊、错误或只答表面的部分，"
                    "一次只问一个问题，不要给标准答案，也不要过渡到下一题。输出 1~2 句话。"
                )
                text = self.client.chat(
                    [
                        {"role": "system", "content": self._system_prompt(position)},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.7,
                    max_tokens=300,
                )
                if text:
                    return AgentReply(text=text, engine=self.engine, references=references)
            except Exception:  # noqa: BLE001
                pass

        return AgentReply(
            text=self._offline_follow_up(question, answer),
            engine="offline",
            references=references,
        )

    def next_line(
        self,
        position: str,
        question: dict,
        answer: str,
        metrics: dict | None = None,
        follow_count: int = 0,
        next_question: dict | None = None,
    ) -> AgentReply:
        """点评当前回答并自然过渡到下一题（最后一题则收尾）。"""
        self.position = position
        if next_question is None:
            text = (
                "好的，今天的面试就到这里。你的整体表现不错，"
                "稍后会为你生成一份详细的评估报告，感谢你的时间。"
            )
            if self.client.configured:
                try:
                    generated = self.client.chat(
                        [
                            {"role": "system", "content": self._system_prompt(position)},
                            {
                                "role": "user",
                                "content": (
                                    f"这是最后一道题：{question.get('text', '')}\n"
                                    f"候选人回答：{answer or '（未作答）'}\n"
                                    "请用一两句自然的话收尾，感谢候选人，不要再问新问题。"
                                ),
                            },
                        ],
                        temperature=0.7,
                        max_tokens=200,
                    )
                    text = generated or text
                except Exception:  # noqa: BLE001
                    pass
            return AgentReply(text=text, engine=self.engine)

        query = question.get("text", "")
        context = self.store.context(position, query, 2)
        references = [hit["title"] for hit in self.store.search(position, query, 2)]

        if self.client.configured:
            try:
                follow_note = "（本题已经追问过一次，请过渡到下一题）" if follow_count > 0 else ""
                prompt = (
                    f"当前题目（类型：{question.get('type', 'tech')}）："
                    f"{question.get('text', '')}\n"
                    f"候选人回答：{answer or '（未作答）'}\n"
                    f"{self._metrics_line(metrics)}"
                    f"{follow_note}\n"
                    f"{self._reference_block(context)}"
                    f"下一道题目：「{next_question.get('text', '')}」\n"
                    "请用一句简短点评过渡，并自然地抛出下一道题目。输出 1~3 句话。"
                )
                text = self.client.chat(
                    [
                        {"role": "system", "content": self._system_prompt(position)},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.7,
                    max_tokens=400,
                )
                if text:
                    return AgentReply(text=text, engine=self.engine, references=references)
            except Exception:  # noqa: BLE001
                pass

        opener = STAGE_OPENERS.get(str(next_question.get("stage") or ""), "OK，这题先聊到这。")
        return AgentReply(
            text=f"{opener}下一个问题：{next_question.get('text', '')}",
            engine="offline",
            references=references,
        )

    # ------------------------------------------------------------------
    # 评估报告
    # ------------------------------------------------------------------

    def report(
        self,
        position: str,
        rounds: list[dict],
        video_metrics: dict | None = None,
    ) -> dict:
        """产出结构化评估报告（与 Node 端报告 Schema 完全一致）。"""
        if self.client.configured:
            try:
                data = self._llm_report(position, rounds, video_metrics)
                if data:
                    return data
            except Exception:  # noqa: BLE001
                pass
        return self._offline_report(rounds, video_metrics)

    def _llm_report(
        self,
        position: str,
        rounds: list[dict],
        video_metrics: dict | None,
    ) -> dict | None:
        description = "\n\n".join(
            self._round_description(round_, index) for index, round_ in enumerate(rounds)
        )
        kb_context = self.store.context(
            position, " ".join(str(r.get("question", {}).get("text", "")) for r in rounds), 3
        )
        video_note = ""
        if video_metrics and video_metrics.get("samples"):
            video_note = (
                "注：本次为视频面试，系统已通过本地视觉分析测得仪态指标——"
                f"出镜率 {video_metrics.get('presencePct', 0)}%、"
                f"视线专注 {video_metrics.get('gazePct', 0)}%、"
                f"头部稳定 {video_metrics.get('steadyPct', 0)}%、"
                f"自然微笑 {video_metrics.get('smilePct', 0)}%"
                "（该维度由系统单独计分，你无需评分，但可在建议中结合临场表现给出提升建议）。\n"
            )
        prompt = (
            f"你是资深技术面试评估专家。请基于岗位知识库参考资料，对以下「{position}」岗位"
            "模拟面试的问答记录做深度评估。\n\n"
            f"{video_note}"
            f"{self._reference_block(kb_context, trailing=True)}"
            f"问答记录：\n{description}\n\n"
            "请严格输出如下 JSON（不要输出其它内容）：\n"
            "{\n"
            '  "overall": 0-100 的综合分,\n'
            '  "dimensions": [\n'
            '    {"key":"content","name":"技术正确性","score":0-100,"comment":"一句话点评"},\n'
            '    {"key":"depth","name":"知识深度","score":0-100,"comment":"一句话点评"},\n'
            '    {"key":"logic","name":"逻辑严谨性","score":0-100,"comment":"一句话点评"},\n'
            '    {"key":"match","name":"岗位匹配度","score":0-100,"comment":"一句话点评"},\n'
            '    {"key":"expression","name":"语言表达","score":0-100,'
            '"comment":"结合语速/口头禅/时长等语音指标点评"}\n'
            "  ],\n"
            '  "perRound": [{"question":"题干摘要","score":0-100,"good":"亮点一句话",'
            '"bad":"不足一句话","keyPoint":"本题考察的核心要点与标准方向"}],\n'
            '  "strengths": ["亮点1","亮点2","亮点3"],\n'
            '  "weaknesses": ["不足1","不足2","不足3"],\n'
            '  "advice": ["具体改进建议1（要可执行）","建议2","建议3"],\n'
            '  "plan": [{"week":"第1周","task":"练习任务"},{"week":"第2周","task":"练习任务"},'
            '{"week":"第3周","task":"练习任务"}],\n'
            '  "resources": ["推荐学习资源1（知识点/文章/题目）","资源2","资源3"]\n'
            "}"
        )
        raw = self.client.chat(
            [
                {"role": "system", "content": "你是严谨的面试评估引擎，只输出合法 JSON。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=2500,
            json_mode=True,
        )
        data = parse_json_loose(raw)
        if not data or not isinstance(data.get("dimensions"), list):
            return None

        dimensions = [
            {
                "key": str(item.get("key") or ""),
                "name": str(item.get("name") or DIMENSION_NAMES.get(str(item.get("key")), "")),
                "score": clamp_score(item.get("score")),
                "comment": str(item.get("comment") or ""),
            }
            for item in data["dimensions"]
            if isinstance(item, dict)
        ]
        video_dimension = self._video_dimension(video_metrics)
        if video_dimension:
            dimensions.append(video_dimension)

        return {
            "generatedAt": self._now_ms(),
            "engine": "llm",
            "overall": clamp_score(data.get("overall")) or mean([d["score"] for d in dimensions]),
            "dimensions": dimensions,
            "perRound": [
                {
                    "question": str(item.get("question") or ""),
                    "score": clamp_score(item.get("score")),
                    "good": str(item.get("good") or ""),
                    "bad": str(item.get("bad") or ""),
                    "keyPoint": str(item.get("keyPoint") or ""),
                }
                for item in (data.get("perRound") or [])[: len(rounds)]
                if isinstance(item, dict)
            ],
            "strengths": [str(x) for x in (data.get("strengths") or [])][:5],
            "weaknesses": [str(x) for x in (data.get("weaknesses") or [])][:5],
            "advice": [str(x) for x in (data.get("advice") or [])][:6],
            "plan": [
                {"week": str(item.get("week") or ""), "task": str(item.get("task") or "")}
                for item in (data.get("plan") or [])[:6]
                if isinstance(item, dict)
            ],
            "resources": [str(x) for x in (data.get("resources") or [])][:6],
        }

    def _offline_report(self, rounds: list[dict], video_metrics: dict | None) -> dict:
        """规则引擎评估（无大模型时兜底）。"""
        buckets: dict[str, list[float]] = {
            "content": [],
            "depth": [],
            "logic": [],
            "match": [],
            "expression": [],
        }
        per_round: list[dict] = []

        for round_ in rounds:
            question = round_.get("question") or {}
            answer = str(round_.get("answer") or "")
            keywords = [str(k) for k in (question.get("keywords") or [])]
            hits = [k for k in keywords if k in answer]
            keyword_ratio = len(hits) / len(keywords) if keywords else 0.5
            length = len(answer)

            content = 40 + keyword_ratio * 45 + min(length / 10, 15)
            depth_signals = self._count_signals(
                answer, ["例如", "比如", "项目", "实际", "场景", "因为", "所以", "对比", "原因"]
            )
            depth = 35 + min(length / 12, 30) + min(depth_signals * 5, 25)
            logic_signals = self._count_signals(
                answer,
                [
                    "首先",
                    "其次",
                    "然后",
                    "最后",
                    "第一",
                    "第二",
                    "第三",
                    "综上",
                    "一方面",
                    "另一方面",
                ],
            )
            logic = 40 + min(logic_signals * 10, 35) + min(length / 15, 25)

            expression = 75.0
            metrics = round_.get("metrics") or {}
            if metrics:
                wpm = float(metrics.get("wpm") or 0)
                if 140 <= wpm <= 230:
                    expression = 85
                elif wpm < 100 or wpm > 280:
                    expression = 62
                expression -= min(float(metrics.get("fillers") or 0) * 3, 15)

            if question.get("type") == "behavior":
                content = max(content, 55)
                depth = max(depth, 55)

            buckets["content"].append(content)
            buckets["depth"].append(depth)
            buckets["logic"].append(logic)
            buckets["match"].append(content * 0.7 + depth * 0.3)
            buckets["expression"].append(expression)

            text = str(question.get("text") or "")
            per_round.append(
                {
                    "question": text[:40] + ("…" if len(text) > 40 else ""),
                    "score": round(content * 0.5 + depth * 0.3 + logic * 0.2),
                    "good": (
                        "提到了 " + "、".join(hits[:3]) + " 等关键点"
                        if hits
                        else "回答态度端正，有一定展开"
                    ),
                    "bad": (
                        "对核心考点的覆盖不足，有遗漏关键概念"
                        if keyword_ratio < 0.4
                        else "部分表述可以更精炼、更有结构"
                    ),
                    "keyPoint": "本题考察："
                    + ("、".join(keywords[:4]) if keywords else "综合表达")
                    + "（可参考知识库对应章节）",
                }
            )

        dimensions = [
            {
                "key": key,
                "name": DIMENSION_NAMES[key],
                "score": mean(buckets[key]),
                "comment": "",
            }
            for key in ["content", "depth", "logic", "match", "expression"]
        ]
        dimensions = [
            {
                **dim,
                "comment": (
                    "表现较好，保持节奏"
                    if dim["score"] >= 80
                    else "基本达标，仍有提升空间"
                    if dim["score"] >= 60
                    else "需要重点加强"
                ),
            }
            for dim in dimensions
        ]
        video_dimension = self._video_dimension(video_metrics)
        if video_dimension:
            dimensions.append(video_dimension)

        overall = mean([d["score"] for d in dimensions])
        weakest = min(dimensions, key=lambda d: d["score"])

        return {
            "generatedAt": self._now_ms(),
            "engine": "offline",
            "overall": overall,
            "dimensions": dimensions,
            "perRound": per_round,
            "strengths": [
                (
                    "多数问题能够展开作答，思路完整"
                    if any(r["score"] >= 60 for r in per_round)
                    else "面对提问能够保持表达，具备练习基础"
                ),
                "回答中能结合关键词展开，具备一定的知识储备",
                "面试过程完整，抗压表现稳定",
            ],
            "weaknesses": [
                f"「{weakest['name']}」相对薄弱，是当前主要短板",
                "部分回答缺少结构化组织（可尝试“结论先行+分点展开”）",
                "对核心概念的底层原理阐述不够深入",
            ],
            "advice": [
                "每道题练习时先给结论，再用“第一/第二/第三”分点论证",
                "对照知识库中的「考点」章节，逐条自查知识盲区",
                "用手机录音自测语速，控制在每分钟 160~220 字，减少“嗯/然后”等口头禅",
                "针对薄弱维度，本周内再做 2 次同岗位模拟并对比分数变化",
            ],
            "plan": [
                {
                    "week": "第1周",
                    "task": f"补齐「{weakest['name']}」相关知识点：精读知识库对应章节并整理笔记",
                },
                {"week": "第2周", "task": "完成 2 次同岗位模拟面试，重点练习结构化表达"},
                {"week": "第3周", "task": "复盘历次报告，把不足项逐条改写为自己的标准答法并背熟"},
            ],
            "resources": [
                "本平台「知识库」模块中该岗位的全部考点章节",
                "岗位技能清单中标注的 2~3 个薄弱技术栈的官方文档",
                "常见面试题合集：每日精练 3 题并录音复盘",
            ],
        }

    # ------------------------------------------------------------------
    # 企业定制：按岗位 JD 出题
    # ------------------------------------------------------------------

    def generate_jd_questions(self, jd: str, position: str) -> list[dict] | None:
        """根据企业招聘描述（JD）定制面试题；不可用/失败时返回 ``None``。"""
        if not self.client.configured or len(jd.strip()) < 30:
            return None
        try:
            raw = self.client.chat(
                [
                    {
                        "role": "system",
                        "content": "你是资深技术面试官与出题专家，只输出合法 JSON。",
                    },
                    {
                        "role": "user",
                        "content": (
                            "以下是某企业发布的一个技术岗位的招聘描述（JD），"
                            f"岗位大类是「{position}」。请针对该 JD 定制 6 道模拟面试题，要求："
                            "2 道技术知识题（紧扣 JD 中的技术栈要求）、"
                            "2 道项目/场景题（模拟该岗位真实工作场景）、"
                            "1 道项目经历深挖题、1 道行为题。每题给出考察关键词（3~6 个）。\n\n"
                            f"岗位JD：\n{jd[:2000]}\n\n"
                            '严格输出 JSON：{"questions":[{"type":"tech|project|scenario|behavior",'
                            '"text":"题目","keywords":["关键词"]}]}'
                        ),
                    },
                ],
                temperature=0.5,
                max_tokens=1800,
                json_mode=True,
            )
        except Exception:  # noqa: BLE001
            return None

        data = parse_json_loose(raw)
        questions = data.get("questions") if data else None
        if not isinstance(questions, list):
            return None
        cleaned = [q for q in questions if isinstance(q, dict) and q.get("text")]
        return cleaned if len(cleaned) >= 3 else None

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    @property
    def engine(self) -> str:
        return "llm" if self.client.configured else "offline"

    def _position_name(self, position: str) -> str:
        bank = self.store.bank(position)
        return bank.name if bank and bank.name else (position or "通用技术岗")

    def _system_prompt(self, position: str) -> str:
        return (
            f"你是一位严谨、专业但友善的技术面试官，正在对一名计算机专业学生进行"
            f"「{self._position_name(position)}」岗位的模拟面试。\n"
            "规则：\n"
            "1. 你会收到面试题目、候选人回答、以及从岗位知识库检索到的参考资料。\n"
            "2. 你要决定下一句话：如果回答明显有可深挖的点（含糊、错误、只答表面），"
            "就提出一个追问（围绕本题，一次只问一个问题）；如果回答已充分或已追问过一次，"
            "就用一句简短点评过渡并抛出指定的下一道题。\n"
            "3. 语言自然口语化，像真人面试官，每次输出 1~3 句话，不要输出任何多余格式。"
            "不要直接给出标准答案。"
        )

    @staticmethod
    def _metrics_line(metrics: dict | None) -> str:
        if not metrics:
            return ""
        return (
            f"语音表达指标：语速 {metrics.get('wpm', 0)} 字/分钟，"
            f"时长 {metrics.get('seconds', 0)} 秒，口头禅 {metrics.get('fillers', 0)} 次。\n"
        )

    @staticmethod
    def _reference_block(context: str, trailing: bool = False) -> str:
        """把 RAG 检索结果包装成 Prompt 段落（无命中则返回空串）。"""
        if not context:
            return ""
        block = f"岗位知识库参考资料：\n{context}\n"
        return block + "\n" if trailing else block

    @staticmethod
    def _round_description(round_: dict, index: int) -> str:
        question = round_.get("question") or {}
        metrics = round_.get("metrics")
        metrics_line = (
            f"\n[语音指标] 语速 {metrics.get('wpm', 0)} 字/分、时长 {metrics.get('seconds', 0)}s、"
            f"口头禅 {metrics.get('fillers', 0)} 次、识别置信参考 {metrics.get('confidence', 0)}"
            if metrics
            else ""
        )
        follow_ups = round_.get("followUps") or []
        follow_desc = (
            "；".join(f"问：{f.get('q', '')} 答：{f.get('a') or '（未答）'}" for f in follow_ups)
            or "无"
        )
        return (
            f"### 第{index + 1}题（类型：{question.get('type', 'tech')}）\n"
            f"题目：{question.get('text', '')}\n"
            f"回答：{round_.get('answer') or '（未作答）'}{metrics_line}\n"
            f"追问及回答：{follow_desc}"
        )

    @staticmethod
    def _offline_follow_up(question: dict, answer: str) -> str:
        answer = str(answer or "")
        keywords = [str(k) for k in (question.get("keywords") or [])]
        if len(answer) < 30:
            return "这个回答有点简短，能再展开讲讲吗？比如它的工作机制或者你实际用过的场景。"
        missing = next((k for k in keywords if k not in answer), None)
        if missing:
            return f"你刚才的回答里，我想再确认一个点：「{missing}」你能具体讲讲吗？"
        return "这个思路不错，能结合你自己的实际项目再深入讲一层吗？"

    @staticmethod
    def _video_dimension(metrics: dict | None) -> dict | None:
        """仪态表现维度（视频面试，由前端本地视觉分析结果计算）。"""
        if not metrics or not metrics.get("samples"):
            return None
        score = round(
            max(
                0,
                min(
                    100,
                    0.40 * float(metrics.get("gazePct") or 0)
                    + 0.25 * float(metrics.get("steadyPct") or 0)
                    + 0.25 * float(metrics.get("presencePct") or 0)
                    + 0.10 * min(float(metrics.get("smilePct") or 0) * 1.6, 100),
                ),
            )
        )
        parts = [
            "全程保持出镜"
            if float(metrics.get("presencePct") or 0) >= 90
            else "偶尔离开画面"
            if float(metrics.get("presencePct") or 0) >= 70
            else "较多时间不在镜头内",
            "视线专注度高，基本直视镜头"
            if float(metrics.get("gazePct") or 0) >= 70
            else "视线偶有偏移"
            if float(metrics.get("gazePct") or 0) >= 45
            else "频繁看向别处，目光接触不足",
            "头部姿态稳定" if float(metrics.get("steadyPct") or 0) >= 70 else "头部晃动较多",
            "表情自然，有适度微笑"
            if float(metrics.get("smilePct") or 0) >= 15
            else "表情偏严肃紧张",
        ]
        return {
            "key": "video",
            "name": "仪态表现",
            "score": score,
            "comment": "；".join(parts) + f"（采样 {metrics.get('samples')} 次）",
        }

    @staticmethod
    def _count_signals(answer: str, words: list[str]) -> int:
        return sum(answer.count(word) for word in words)

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

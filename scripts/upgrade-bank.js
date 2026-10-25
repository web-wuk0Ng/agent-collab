/* 一次性题库升级脚本：
 * 1) 给全部既有题目补 hint（回答思路）
 * 2) 每个岗位新增 10 道高频题（含 keywords/points/hint）
 * 运行：node scripts/upgrade-bank.js
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'data', 'questions');

/* ---------------- 回答思路（既有题目） ---------------- */
const HINTS = {
  // Java
  'jb-t1': '先讲数组+链表结构，再讲 JDK8 的三次升级：链表长度≥8 且数组长度≥64 转红黑树、扩容优化（高低位拆分）、扰动函数，可顺带提并发下的问题与 ConcurrentHashMap。',
  'jb-t2': '结构：主内存/工作内存 → 三大特性 → volatile 保证可见性+有序性但不保证原子性（举 i++ 例子）→ happens-before 与内存屏障，体现深度。',
  'jb-t3': '先背出 7 个核心参数（corePoolSize、maximumPoolSize、keepAliveTime、workQueue、threadFactory、handler、unit），再给 IO 密集公式（2N 或 N/(1-阻塞系数)），说明队列与拒绝策略的选择。',
  'jb-t4': '按 实例化→属性注入→Aware→BeanPostProcessor 前置→初始化→后置→使用→销毁 的顺序讲；@Autowired 按类型、@Resource 按名称，顺带提 @Primary 与构造器注入的推荐理由。',
  'jb-t5': '索引失效场景列举（最左前缀、函数/运算、隐式转换、like %x、or、数据量小全表更快）→ explain 关键列（type、key、rows、Extra）→ 慢日志 → 改写 SQL 或建索引。',
  'jb-t6': '结论先行：推荐先更新数据库再删缓存（Cache Aside），配合延迟双删/过期时间兜底；分析各自的不一致窗口，提及 binlog 订阅（Canal）方案是加分项。',
  'jb-p1': '用 STAR：背景与规模（QPS/数据量）→ 架构图式描述分层与选型 → 明确"我负责"的模块 → 遇到的坑与结果数据，控制在两分钟内。',
  'jb-p2': '选一个真实深入的问题：现象→排查过程（日志/监控/压测/arthas 等工具）→根因→解决方案→量化结果，突出方法论而不是运气。',
  'jb-s1': '先止血后查因：看监控定位是全服务还是单接口→是否发布/流量变化→降级限流保住大盘→定位根因（慢SQL/GC/下游）→修复复盘。体现应急 SOP 意识。',
  'jb-s2': '从 发号（哈希/自增+62进制/布隆去重）→存储（KV 映射）→跳转（302 而非 301 便于统计）→高并发读（多级缓存）→防滥用 依次展开，给出量级估算。',
  'jb-b1': '身份定位（学校/方向）→ 2~3 个与后端强相关的经历（项目+技能）→ 一句话说明匹配岗位的原因，节奏紧凑不背简历。',
  'jb-b2': '先讲处理原则（对事不对人、用数据和实验说话），再讲一个真实分歧案例：双方依据→验证方式→结果→关系维护，最后反思收获。',
  // Python
  'pa-t1': '区别：语法层面 tuple 不可变；可变性影响哈希与作为 dict 键；默认参数踩坑根源是"默认值在函数定义时求值一次"，用 None 哨兵规避。',
  'pa-t2': '过拟合=训练好测试差（方差大），欠拟合=两者都差（偏差大）→缓解：更多数据、正则化、Dropout、早停、数据增强；L1 产生稀疏解可做特征选择，L2 平滑权重更常用。',
  'pa-t3': 'QKV 三矩阵 → 注意力分数 softmax(QK^T/√d)V → 多头并行捕捉不同子空间 → 位置编码补序；对比 RNN：并行计算、长距离依赖直接连接。',
  'pa-t4': '动机：知识时效性/私域知识/幻觉 → 环节：文档切分→向量化→检索（TopK+重排）→拼 Prompt 生成→评估；可提混合检索与引用溯源是加分项。',
  'pa-t5': '方案一：小顶堆维护 k 个，O(n log k)；方案二：快排 partition 随机 pivot，平均 O(n)；可提计数排序（值域小）与外部数据分片的延伸。',
  'pa-t6': '定义：一本正经胡说八道 → 成因：生成机制与知识边界 → 缓解：RAG 挂知识库、约束解码、引用溯源、自我一致性校验、评测集回归，体现工程闭环意识。',
  'pa-p1': '业务问题→为什么用这个模型→数据量与特征→离线/在线指标（准确率、AUC、业务指标）→上线方式与收益，突出"效果如何衡量"。',
  'pa-p2': '诊断流程：看 badcase 分布→区分数据/特征/模型问题→消融实验验证假设→按"数据>特征>模型"优先级投入，体现实验设计与成本意识。',
  'pa-s1': '降本提速组合拳：小模型或量化+短上下文、缓存高频问答、RAG 替代全量知识、流式输出改善体感；给出成本与延迟的量化估算框架。',
  'pa-s2': '分层防护：系统提示词与用户输入隔离→输入检测（规则+分类器）→输出过滤（敏感词与越权内容）→权限最小化（不给出系统提示词的能力）→红队测试与日志审计。',
  'pa-b1': '算法基础（数学/课程）→ AI 项目与效果 → 学习路径体现自驱力，与岗位方向（CV/NLP/LLM）对齐。',
  'pa-b2': '接受不确定性是算法工作常态 → 讲自己的应对：小步实验、记录假设与结论、失败也沉淀认知 → 举一次"失败实验带来转折"的例子。',
  // Web
  'wf-t1': '核心概念：主轴/交叉轴、flex-direction、justify-content/align-items；居中方案：flex 两行、grid place-items、绝对定位+transform，说出原理更佳。',
  'wf-t2': '执行栈清空 → 微任务（Promise.then、queueMicrotask）→ 宏任务（setTimeout）→ 浏览器渲染时机；结合题目代码逐行分析输出顺序。',
  'wf-t3': 'Vue2 defineProperty 逐属性劫持的缺陷（新增/删除、数组下标）→ Vue3 Proxy 代理整个对象：懒代理、支持 Map/Set、性能更好；顺带提 ref/reactive 与依赖收集。',
  'wf-t4': '按 渲染流程讲优化点：DNS/缓存→请求（CDN、压缩、HTTP2）→解析（防阻塞、懒加载）→渲染（重排重绘、骨架屏）；指标化（FCP/LCP）是加分项。',
  'wf-t5': '虚拟 DOM 把 DOM 操作转移到 JS 计算；Diff 同层比较+key 标识复用；下标 key 在插入/删除时导致状态错位与多余重渲染，用稳定唯一 id。',
  'wf-t6': '同源策略限制 Cookie/DOM/Ajax；方案：CORS（简单/预检请求）、Nginx 反向代理、JSONP（历史）、websocket 不受限；重点讲 CORS 响应头与预检触发条件。',
  'wf-p1': '技术栈与角色 → 一个具体交互/性能难题（如长列表、复杂表单、动画掉帧）→ 解决方案与取舍 → 量化结果（FPS、包体积、加载时间）。',
  'wf-p2': '分工程化维度讲：构建（Vite/Webpack 优化）、规范（ESLint+Hooks）、组件封装（复用率）、CI/CD，每个点带一个数据或案例。',
  'wf-s1': '定位思路：影响面（版本/渠道/机型）→ 接入错误监控与 sourcemap 还原 → 灰度回滚止血 → 复现环境（User-Agent、代理）→ 根因与防回归（监控告警）。',
  'wf-s2': '分页/虚拟滚动（react-window 类原理）+ 懒渲染；交互层防抖、时间分片；数据层只渲染可视区 DOM 数量恒定，给出 DOM 节点数量级对比。',
  'wf-b1': '技能地图（框架/工程化/基础）→ 1~2 个代表作品与亮点 → 与岗位匹配点，可现场展示作品是加分项。',
  'wf-b2': '先理解需求背后目标 → 用数据/竞品/用户路径表达专业意见 → 提出低成本替代方案 → 决策权交还但执行不打折扣，举真实例子。',
};

/* ---------------- 新增题目 ---------------- */
const NEW = {
  'java-backend': [
    { id: 'jb-t7', type: 'tech', stage: 'core', text: 'MySQL 的四个事务隔离级别分别解决什么问题？InnoDB 的 MVCC 是怎么实现的？',
      keywords: ['读未提交', '读已提交', '可重复读', '串行化', 'MVCC', 'undo log', 'ReadView'],
      points: ['脏读/不可重复读/幻读', 'RR 是默认级别', '版本链与 ReadView', '快照读与当前读'],
      hint: '先列四个级别与对应解决的并发问题，再讲 MVCC 三件套（隐藏列、undo log 版本链、ReadView），点出 RC 与 RR 生成 ReadView 时机的差异。' },
    { id: 'jb-t8', type: 'tech', stage: 'core', text: 'Spring Boot 的自动装配（Auto Configuration）是怎么工作的？讲讲 @SpringBootApplication 背后的机制。',
      keywords: ['@EnableAutoConfiguration', 'spring.factories', 'AutoConfiguration.imports', '条件注解', 'SPI'],
      points: ['三个注解的组合', '配置文件加载与筛选', '@ConditionalOnX 条件装配', '自定义 starter 思路'],
      hint: '拆解 @SpringBootApplication 三层结构 → 自动配置从 AutoConfiguration.imports 读取候选 → @ConditionalOnClass 等条件筛选 → 举自定义 starter 的例子收尾。' },
    { id: 'jb-t9', type: 'tech', stage: 'deep', text: 'JVM 常见的垃圾回收器你了解哪些？如果线上频繁 Full GC，你会怎么排查和调优？',
      keywords: ['CMS', 'G1', '分代收集', 'jstat', 'jmap', '内存泄漏'],
      points: ['分代与回收流程', 'G1 的 Region 思想', '排查工具链', '常见泄漏来源'],
      hint: '先讲分代模型与 CMS/G1 的取舍，再给排查链路：jstat 看 GC 频率 → jmap/mat 分析堆快照找大对象与泄漏点 → 调整堆大小或修复代码。' },
    { id: 'jb-t10', type: 'tech', stage: 'deep', text: '使用消息队列（如 RocketMQ/Kafka）时，如何保证消息不丢失？消息重复消费又怎么处理？',
      keywords: ['确认机制', '持久化', '刷盘', '幂等', '偏移量'],
      points: ['生产端确认重试', 'Broker 持久化与副本', '消费端手动 ACK', '幂等设计'],
      hint: '按 生产→存储→消费 三段分别讲不丢的手段（confirm/ACK/刷盘副本），重复消费用唯一键+数据库/Redis 幂等表解决，说明"至少一次+幂等"是通用范式。' },
    { id: 'jb-p3', type: 'project', stage: 'core', text: '如果你做过或了解秒杀、抢票这类高并发场景的项目，说说它的架构要点：怎么扛住瞬时流量并防止超卖？',
      keywords: ['削峰', '库存预扣', 'Lua', '限流', '超卖'],
      points: ['流量漏斗分层', 'Redis 原子扣减', 'MQ 异步落库', '防超卖与防刷'],
      hint: '按漏斗讲：前端静态化与按钮防重 → 网关限流 → Redis+Lua 原子扣库存 → MQ 削峰异步建单 → DB 兜底；没做过就讲方案设计，强调层次感。' },
    { id: 'jb-p4', type: 'project', stage: 'deep', text: '讲一个你做过的接口性能优化：优化前后的指标分别是多少？你做了哪些改动？',
      keywords: ['压测', '慢SQL', '缓存', '批处理', 'RT'],
      points: ['基线指标与目标', '定位瓶颈手段', '具体优化项', '优化后收益'],
      hint: '用数字讲故事：优化前 QPS/RT → 火焰图或慢查询定位瓶颈（N+1 查询、串行 RPC）→ 加缓存/批量/并行改造 → 优化后数据，对比越具体越有说服力。' },
    { id: 'jb-s3', type: 'scenario', stage: 'core', text: '你的服务强依赖的下级服务突然大量超时，请求开始堆积，线程池快满了。这时你怎么办？',
      keywords: ['熔断', '降级', '超时', '舱壁', '限流'],
      points: ['先保自己不死', '熔断与快速失败', '降级预案（兜底数据/默认值）', '恢复后自动半开'],
      hint: '核心是"失败要快"：设超时与熔断（Sentinel/Resilience4j）阻断堆积 → 走降级兜底逻辑 → 关键接口限流保核心 → 复盘依赖方为什么挂。' },
    { id: 'jb-s4', type: 'scenario', stage: 'deep', text: '设计一个全站排行榜系统：要求实时展示点赞/积分 Top 100，用户量千万级，说说你的存储与计算方案。',
      keywords: ['Redis ZSet', '分片', '定时聚合', '热点'],
      points: ['ZSet 结构与命令', '大 key 与分桶', '持久化与一致性', '冷热分层'],
      hint: '主方案 Redis ZSet（ZINCRBY+ZREVRANGE）→ 讨论千万级大 key 的分桶聚合 → 定时任务落库持久化 → 防刷票的频控，体现方案演进思维。' },
    { id: 'jb-b3', type: 'behavior', stage: 'warm', text: '你为什么选择后端开发这个方向？未来 3 年的职业规划是什么？',
      keywords: ['兴趣起源', '能力匹配', '成长路径'],
      points: ['真实的动机故事', '与岗位能力匹配', '短期具体+中期方向'],
      hint: '动机要具体（某个项目/课程点燃的兴趣），规划分两段：前 1-2 年夯实工程与业务，2-3 年深入某个领域（高并发/中间件/架构），避免空喊口号。' },
    { id: 'jb-b4', type: 'behavior', stage: 'deep', text: '讲一次你在时间紧、任务重的情况下（比如项目临近截止还有大块功能没完成）是怎么应对的？',
      keywords: ['优先级', '拆解', '沟通', '结果'],
      points: ['任务拆解与排序', '及时同步风险', '砍范围保核心', '复盘沉淀'],
      hint: '结构：盘点任务与剩余时间 → 与导师/团队对齐优先级、砍出 MVP → 加班与提效手段 → 按时交付的结果与复盘，突出沟通而不是硬扛。' },
  ],
  'python-algo': [
    { id: 'pa-t7', type: 'tech', stage: 'core', text: '模型评估时，精确率、召回率、F1、AUC 各自衡量什么？什么场景该优先看召回率，什么场景该优先看精确率？',
      keywords: ['混淆矩阵', '精确率', '召回率', 'F1', 'AUC', '阈值'],
      points: ['四类指标定义', '指标间的取舍', '场景化选择', '类别不平衡影响'],
      hint: '用混淆矩阵推导四个指标 → 场景举例：欺诈/疾病检测重召回，推荐/广告重精确 → 提一句阈值移动与 PR 曲线，显示能落地。' },
    { id: 'pa-t8', type: 'tech', stage: 'core', text: '对比决策树、随机森林与 XGBoost 的原理和适用场景。为什么集成树模型在表格数据上常常表现最好？',
      keywords: ['决策树', 'Bagging', 'Boosting', 'XGBoost', '表格数据'],
      points: ['三种模型原理', '方差/偏差视角', '特征处理优势', '适用边界'],
      hint: '决策树易过拟合 → 随机森林 Bagging 降方差 → XGBoost Boosting 降偏差+二阶优化正则；表格数据无空间结构、特征异质，树模型天然适配。' },
    { id: 'pa-t9', type: 'tech', stage: 'deep', text: '什么是大模型的高效微调（如 LoRA）？它和全参数微调相比的取舍是什么？什么时候你会选择哪种？',
      keywords: ['LoRA', '低秩分解', '全参微调', '显存', '灾难性遗忘'],
      points: ['LoRA 原理与秩的选择', '显存/成本对比', '效果差异', '适用场景判断'],
      hint: '讲低秩分解只训增量矩阵、可插拔 → 对比参数量/显存/效果/遗忘风险 → 决策：数据多任务重选全参或继续预训练，快速适配多任务选 LoRA。' },
    { id: 'pa-t10', type: 'tech', stage: 'deep', text: 'RAG 系统里向量检索这一环是怎么工作的？数据量到亿级时，如何保证检索又快又准？',
      keywords: ['Embedding', 'ANN', 'Faiss', 'HNSW', 'IVF', '召回率'],
      points: ['向量相似度度量', 'ANN 常见索引', '速度与精度取舍', '重排优化'],
      hint: '文本→Embedding→高维空间近邻 → 暴力检索不可行，引出 IVF/HNSW 等近似索引 → 用召回率与 QPS 权衡 → 提混合检索+重排提升精度。' },
    { id: 'pa-p3', type: 'project', stage: 'core', text: '讲一次你负责数据处理或特征工程的经历：原始数据有什么问题？你做了哪些清洗与特征构造？对效果提升多少？',
      keywords: ['数据清洗', '缺失值', '特征构造', '消融', '提升'],
      points: ['数据问题盘点', '清洗策略', '特征构造思路', '量化收益'],
      hint: '按流程讲：数据问题（缺失/异常/泄漏）→ 清洗与校验规则 → 特征构造的业务依据 → 用消融实验证明每个特征/清洗步骤的贡献。' },
    { id: 'pa-p4', type: 'project', stage: 'deep', text: '如果你的模型要部署上线（如做成 API 服务），你会考虑哪些工程问题？做过推理加速或成本优化吗？',
      keywords: ['推理延迟', '量化', '批处理', 'GPU 利用率', '服务化'],
      points: ['延迟与吞吐指标', '量化/蒸馏/缓存', '批处理与并发', '监控回滚'],
      hint: '从指标出发（P99 延迟、QPS、单次成本）→ 手段：模型量化蒸馏、KV 缓存、动态批处理、扩缩容 → 强调上线后的监控与坏例回流闭环。' },
    { id: 'pa-s3', type: 'scenario', stage: 'core', text: '你要训练一个二分类模型，但正负样本比例是 1:1000，直接训练效果很差。你会怎么处理？',
      keywords: ['类别不平衡', '重采样', '代价敏感', 'Focal Loss', '阈值'],
      points: ['先换指标（PR/AUC）', '欠采样与过采样', '代价敏感与 focal loss', '阈值调整'],
      hint: '第一步先换评估口径（准确率失效）→ 数据层：欠采样/过采样/SMOTE → 算法层：类别权重、Focal Loss → 决策层：按业务代价调阈值。' },
    { id: 'pa-s4', type: 'scenario', stage: 'deep', text: '实验室只有一张共享 GPU，同时有多个实验和同学习要跑。你会怎么安排实验、管理资源，保证自己的迭代效率？',
      keywords: ['优先级', '显存', '断点续训', '实验管理', '云资源'],
      points: ['实验优先级排序', '显存与批大小优化', '混合精度与梯度累积', '实验记录可复现'],
      hint: '讲资源规划：小实验用 CPU/小模型验证思路，大实验错峰跑+断点续训 → 混合精度/梯度累积省显存 → wandb 记录保证可复现，体现工程素养。' },
    { id: 'pa-b3', type: 'behavior', stage: 'warm', text: '你是怎么走上算法/AI 这条路的？中间哪件事让你确定了这个方向？',
      keywords: ['起点', '关键事件', '持续投入'],
      points: ['真实起点', '关键转折事件', '为此做的积累'],
      hint: '用一个具体事件切入（某次比赛/项目/课程），讲清"为什么是它打动你"→ 后续为方向做的系统积累 → 落到与岗位方向的契合。' },
    { id: 'pa-b4', type: 'behavior', stage: 'deep', text: '如果产品经理给的需求和模型能达到的效果有差距（比如要求 95% 准确率但只能做到 80%），你会怎么沟通和处理？',
      keywords: ['预期管理', '数据说话', '拆分场景', '迭代'],
      points: ['用数据解释差距', '拆分高价值场景', '给替代方案', '约定迭代节奏'],
      hint: '不硬顶也不硬扛：用评测数据和 badcase 说明 80% 的分布 → 拆场景，把模型用在最擅长的高价值区间 → 给出分阶段目标与迭代计划，让产品做知情的决策。' },
  ],
  'web-frontend': [
    { id: 'wf-t7', type: 'tech', stage: 'core', text: '什么是闭包？它有什么用途，什么情况下会造成内存泄漏？如何避免？',
      keywords: ['作用域链', '词法作用域', '内存泄漏', '引用'],
      points: ['闭包的定义与原理', '常见用途（防抖/柯里化/私有变量）', '泄漏场景', '避免手段'],
      hint: '定义（函数+其词法作用域的引用）→ 用途举例防抖、模块私有变量 → 泄漏根源是被捕获的大对象一直可达 → 及时置 null、避免意外全局。' },
    { id: 'wf-t8', type: 'tech', stage: 'core', text: '浏览器的 HTTP 缓存机制是怎样的？强缓存和协商缓存的区别，以及 Cache-Control 常用配置怎么定？',
      keywords: ['强缓存', '协商缓存', 'ETag', 'Cache-Control', 'max-age'],
      points: ['强缓存不请求服务器', '协商缓存 304', 'ETag/Last-Modified', 'HTML 与静态资源策略'],
      hint: '先讲流程：强缓存命中不发请求 → 过期后 ETag/Last-Modified 协商 → 配置策略：HTML no-cache、带 hash 静态资源 max-age 一年。' },
    { id: 'wf-t9', type: 'tech', stage: 'deep', text: '实现一个并发控制器：同时最多 3 个请求在飞，某个完成后自动补位，最终全部完成。说说思路并分析边界情况。',
      keywords: ['Promise', '并发控制', '队列', '递归'],
      points: ['任务队列设计', '补位机制', '错误处理', '全部完成的时机'],
      hint: '核心是"启动固定数量+每完成一个取下一个"：一个指针+递归执行函数，Promise.allSettled 等全部结束；注意错误不能中断调度与空数组边界。' },
    { id: 'wf-t10', type: 'tech', stage: 'deep', text: '你会怎么设计一个可复用的业务组件（比如带搜索联想的输入框）？从 API 设计、状态管理到可访问性说说你的考量。',
      keywords: ['组件设计', 'Props', '受控/非受控', '可访问性', '复用'],
      points: ['API 最小完备', '受控与非受控', '插槽/扩展点', '键盘与 ARIA'],
      hint: 'API：value+onChange 受控、防抖与加载态内置可覆写 → 扩展：插槽自定义选项渲染 → 可访问性：ARIA combobox 模式与键盘导航 → 用一个真实封装案例佐证。' },
    { id: 'wf-p3', type: 'project', stage: 'core', text: '你做过移动端或需要多端适配的项目吗？讲讲适配方案（rem/vw/响应式）的选择与踩过的坑。',
      keywords: ['rem', 'vw', '媒体查询', 'safe-area', '1px 问题'],
      points: ['方案对比与选型理由', '视口与缩放', '兼容坑（1px/软键盘）', '真机验证'],
      hint: '先说选型依据（面板型用 rem/flexiable，展示型用 vw+媒体查询）→ 踩坑案例：iOS 1px 边框、软键盘顶起、safe-area，体现真机调试经验。' },
    { id: 'wf-p4', type: 'project', stage: 'deep', text: '讲一次你有量化数据的前端性能优化：优化前后的 LCP/包体积/帧率分别是多少？具体做了什么？',
      keywords: ['LCP', '代码分割', '懒加载', '包体积', '性能预算'],
      points: ['性能基线测量', '优化清单与优先级', '量化收益', '防退化机制'],
      hint: '按"测量→优化→验证"讲：Lighthouse/Performance 定位 → 代码分割、资源压缩、懒加载、图片优化逐项落地 → 前后数据对比 → CI 加体积预算防退化。' },
    { id: 'wf-s3', type: 'scenario', stage: 'core', text: '测试同学报了一个只在 Safari/某些国产浏览器上出现的样式或脚本报错，Chrome 上一切正常。你怎么定位和解决？',
      keywords: ['兼容性', 'Can I Use', 'polyfill', 'iOS', '降级'],
      points: ['收集环境信息', '最小化复现', '按兼容表定位 API/样式', 'polyfill 与降级'],
      hint: '先收集版本/系统/UA → 用真机或模拟器最小化复现 → 对 Can I Use 定位不支持的 API 或 CSS 特性 → Babel/polyfill/-webkit- 前缀或功能降级，沉淀兼容清单。' },
    { id: 'wf-s4', type: 'scenario', stage: 'deep', text: '领导要求给线上前端加上"监控告警"能力：JS 报错、白屏、接口失败都要能发现。说说你的方案设计。',
      keywords: ['错误监控', 'window.onerror', 'sourcemap', '上报', '白屏检测'],
      points: ['采集层（全局捕获+资源监听）', '上报策略与采样', '还原定位（sourcemap）', '告警与看板'],
      hint: '分三层讲：采集（onerror/unhandledrejection/resource error/白屏采样点检测）→ 上报（批量+采样+会话信息）→ 消费（sourcemap 还原、聚合去重、阈值告警）。' },
    { id: 'wf-b3', type: 'behavior', stage: 'warm', text: '前端技术更新很快，你平时是怎么学习新技术的？最近在学什么，学到什么程度了？',
      keywords: ['学习方法', '官方文档', '实践', '输出'],
      points: ['具体的学习渠道', '以项目驱动学习', '有输出物', '真实进度'],
      hint: '给一套具体方法论（官方文档+小 demo+项目里真实使用+写笔记），再用"最近在学 X"举例：学到什么、做了什么、下一步计划，切忌说"什么都略懂"。' },
    { id: 'wf-b4', type: 'behavior', stage: 'deep', text: '在赶进度的时候很容易堆出"屎山"代码。你在实际项目里是怎么平衡交付速度和代码质量的？',
      keywords: ['代码质量', '技术债', 'Code Review', '重构'],
      points: ['质量底线（规范/测试）', '技术债显式记录', '小步重构', 'CR 与协作'],
      hint: '态度先行：先能跑再优雅，但守住底线（命名、规范、核心逻辑测试）→ 技术债记 TODO/文档、排期偿还 → 举例一次小步重构让后续需求提速。' },
  ],
};

/* ---------------- 执行合并 ---------------- */
for (const [file, add] of Object.entries(NEW)) {
  const fp = path.join(DIR, file + '.json');
  const bank = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const ids = new Set(bank.questions.map(q => q.id));
  for (const q of bank.questions) {
    if (HINTS[q.id]) q.hint = HINTS[q.id];
  }
  let added = 0;
  for (const q of add) {
    if (ids.has(q.id)) { console.log('跳过重复 id:', q.id); continue; }
    if (!q.hint) { console.log('!! 新题缺少 hint:', q.id); process.exit(1); }
    bank.questions.push(q);
    added++;
  }
  fs.writeFileSync(fp, JSON.stringify(bank, null, 2) + '\n', 'utf-8');
  console.log(`${file}: 补 hint ${Object.keys(HINTS).filter(k => k.startsWith(file.slice(0, 2))).length} 处，新增 ${added} 题，现有 ${bank.questions.length} 题`);
}
console.log('✅ 题库升级完成');

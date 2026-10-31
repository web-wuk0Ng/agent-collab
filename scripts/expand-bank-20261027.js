/* 基于官方文档整理的练习题，非特定公司的面经摘抄；幂等执行，不改旧题。 */
const fs = require('fs');
const path = require('path');
const S = {
  virtual: 'https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html',
  future: 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html',
  tx: 'https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html',
  sql: 'https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html',
  lock: 'https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html',
  money: 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html',
  eviction: 'https://redis.io/docs/latest/develop/reference/eviction/',
  pubsub: 'https://redis.io/docs/latest/develop/pubsub/',
  kafka: 'https://kafka.apache.org/41/design/design/',
  async: 'https://docs.python.org/3.13/library/asyncio-task.html',
  leakage: 'https://scikit-learn.org/stable/common_pitfalls.html',
  cv: 'https://scikit-learn.org/stable/modules/cross_validation.html',
  random: 'https://docs.pytorch.org/docs/stable/notes/randomness.html',
  amp: 'https://docs.pytorch.org/docs/stable/notes/amp_examples.html',
  faiss: 'https://github.com/facebookresearch/faiss/wiki/MetricType-and-distances',
  rrf: 'https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion',
  snapshot: 'https://react.dev/learn/state-as-a-snapshot',
  effects: 'https://react.dev/learn/synchronizing-with-effects',
  computed: 'https://vuejs.org/guide/essentials/computed',
  watchers: 'https://vuejs.org/guide/essentials/watchers.html',
  performance: 'https://vuejs.org/guide/best-practices/performance',
  abort: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
  sse: 'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events',
  idb: 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API',
  worker: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers',
  csp: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP',
  vitals: 'https://web.dev/articles/vitals',
  ts: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
  settled: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled'
};
// type, stage, 题干, 关键词, 考察点（分号分隔）, 自编参考材料, 来源键
const batches = {
  'java-backend': [
    ['tech','core','Java 21 的虚拟线程适合哪些任务？为什么它不能直接加速 CPU 密集计算？','虚拟线程 I/O CPU','区分并发与并行；解释等待期间让出承载线程；限制下游连接数','虚拟线程降低大量阻塞式 I/O 任务的线程开销，通常改善吞吐量。CPU 密集任务仍受可用核心数限制；即使线程廉价，也需要控制数据库连接和远端请求的并发。','virtual'],
    ['scenario','deep','把传统线程池服务迁移为虚拟线程时，你会如何做容量压测并保护下游？','虚拟线程 限流 压测','对比吞吐与延迟分位；观察连接池和内存；保留回滚措施','迁移先用代表性负载比较吞吐、尾延迟和资源占用，再逐步放量。线程数量不再是可靠的限流边界，应在连接池或业务入口设置显式并发额度，防止放大下游压力。','virtual'],
    ['tech','core','CompletableFuture 的 thenApply 和 thenCompose 有什么区别？什么时候需要显式指定 Executor？','thenApply thenCompose Executor','区分映射与异步扁平化；解释默认执行器；避免阻塞公共线程池','thenApply 将完成值映射为另一个值；thenCompose 把返回的异步阶段串成一条链。阻塞 I/O 不宜随意占用公共执行器，应按业务隔离执行器并设置任务和资源上限。','future'],
    ['scenario','deep','并行调用三个下游，其中一个超时，你会怎样处理部分结果、异常传播与整体请求期限？','CompletableFuture 超时 部分失败','区分局部和整体超时；明确降级合同；解释取消的实际边界','并行聚合需要事先定义必需结果和可选结果。每个调用设期限，整体请求也设预算；返回降级结果时保留可观测错误。阶段被取消不代表底层网络调用必然停止，需要底层客户端配合。','future'],
    ['tech','core','同一个 Spring Bean 内部调用带 @Transactional 的方法，为什么事务可能没有按预期生效？','Transactional 自调用 代理','说明代理边界；区分调用路径；给出拆分服务或编程式事务方案','常见代理模式下，同一对象的内部调用不会重新经过事务代理。应检查实际调用对象、事务配置和异常传播；可把边界移到另一个服务，或使用明确的编程式事务，而不是仅增加注解。','tx'],
    ['tech','core','事务方法捕获异常后正常返回，数据库会自动回滚吗？受检异常与回滚规则如何设置？','事务 回滚 受检异常','检查异常是否传播；区分默认规则与显式配置；验证真实数据库状态','事务结果取决于事务管理器和配置的回滚规则。捕获异常后正常返回可能导致提交；受检异常不应凭直觉判断回滚，需要显式配置并用数据库集成测试验证。','tx'],
    ['scenario','deep','多个工作线程抢同一批待处理订单，SELECT FOR UPDATE 和 SKIP LOCKED 可以怎样使用？','FOR UPDATE SKIP LOCKED 订单','说明行锁和事务边界；解释跳过锁定记录；保留幂等处理','锁定读取可在事务内领取任务，SKIP LOCKED 可跳过被其他事务锁住的记录以减少等待。它给出的是不一致视图，更适合队列式领取，不能替代一般业务的一致性要求；任务处理还要可重试。','lock'],
    ['tech','deep','InnoDB 的一致性读和锁定读有什么区别？在可重复读事务中两次查询一定看到同一份数据吗？','一致性读 锁定读 ReadView','区分快照和当前数据；说明隔离级别；避免笼统承诺','普通一致性读通常依赖多版本快照，锁定读取则读取并锁定相关记录。事务内混用不同读取方式时不能概括为所有查询总看到同一状态；需要结合隔离级别、SQL 和事务时序分析。','sql'],
    ['tech','core','金额计算为什么不直接使用 double？BigDecimal 的 equals 与 compareTo 有什么区别？','BigDecimal 精度 scale','避免二进制浮点误差；解释刻度影响；明确舍入规则','BigDecimal 表达十进制数时仍需要约定精度和舍入规则。构造金额优先使用明确的十进制字符串；equals 同时考虑数值和刻度，compareTo 侧重数值顺序，集合去重时尤其要注意。','money'],
    ['scenario','deep','多币种订单分摊优惠后总金额对不上，你会怎样设计精度、舍入和尾差处理？','BigDecimal 舍入 分摊','统一币种精度；说明中间计算策略；用总额守恒验证','分摊应先明确币种小数位、计算精度和统一舍入策略，再按可解释的规则分配尾差。避免各步骤随意四舍五入；用分摊总额等于订单优惠的性质及边界样例验证。','money'],
    ['tech','core','Redis 的键过期和内存淘汰是同一件事吗？allkeys-lru 与 volatile-lru 如何选择？','TTL maxmemory LRU','区分时间到期和容量压力；说明候选键范围；考虑拒绝写入','TTL 控制键何时过期，内存淘汰则在内存压力下按策略选择键。allkeys 与 volatile 的主要区别是可淘汰的键集合；如果没有合适候选，写入仍可能失败，不能只配置过期时间就忽略容量。','eviction'],
    ['scenario','deep','缓存的命中率下降并出现写入失败，你会先看哪些 Redis 容量与淘汰指标？','Redis 命中率 淘汰 内存','关联命中与淘汰变化；识别大键和热点；验证策略适配','排查应把访问量、命中率、淘汰数量、内存使用和写入错误放在同一时间线。根据业务区分热点变化与容量不足；调整策略后观察尾延迟和回源负载，避免只追求单一命中率。','eviction'],
    ['tech','core','Redis Pub/Sub 适合可靠的订单通知吗？订阅者断线时消息会怎样？','Pub/Sub 至多一次 断线','说明投递语义；区分广播与持久消费；考虑补偿机制','Redis Pub/Sub 的消息投递是至多一次；订阅方离线或处理失败时，消息不会自动补发。适合允许丢失的即时广播；可靠业务需选择带持久消费能力的方案，并设计确认、重试和幂等。','pubsub'],
    ['tech','core','Kafka 的消息顺序保证范围是什么？为什么同一个订单的事件通常使用相同 key？','Kafka 分区 key 顺序','说明分区内顺序；解释路由；考虑消费端并发','Kafka 的顺序语义主要在分区内成立，相同业务 key 的事件通常路由到同一分区。即使读取有序，消费端把任务并发交给其他线程也可能打乱业务完成顺序，需要限制同一实体的处理顺序。','kafka'],
    ['scenario','deep','消费消息更新数据库后进程崩溃，重启时又收到同一消息，如何避免重复扣款？','Kafka offset 幂等 唯一键','分析提交时序；使用业务幂等键；区分消息与数据库事务','数据库写入与消费位点提交之间存在故障窗口。可以用业务事件 ID 和唯一约束识别已处理事件，将幂等记录与业务变更放在同一数据库事务；不能把消息系统的保证直接当成外部数据库的一次执行保证。','kafka'],
    ['project','deep','你会怎样为一个异步批处理项目设计检查点，保证失败重跑时既不漏数据也不重复处理？','检查点 幂等 重跑','定义业务完成条件；设计原子检查点；验证故障窗口','检查点应对应已可靠完成的业务状态。先定义重复和遗漏的判据，再分析处理、持久化和推进检查点之间的故障窗口；通过强制终止和恢复实验检验重跑，而不只测正常路径。','kafka'],
    ['project','core','如果为项目引入 BigDecimal，你会怎样检查接口、数据库与前端的金额格式是否一致？','金额 序列化 scale','约定精度和单位；统一接口合同；覆盖边界输入','金额类型变更要同时检查接口字符串或数值表示、数据库精度与前端格式化。约定最小货币单位或十进制精度，测试极值、零值和多次分摊，避免某一层再次转为不合适的浮点表示。','money'],
    ['scenario','core','事务压测里出现大量等待锁，你会怎样缩短临界区并证明改动有效？','锁等待 事务 临界区','定位持锁事务；移出慢调用；对比等待时间和一致性','先查清谁持锁以及事务边界，再评估把远端请求、大批量计算等移出事务。改变边界时要重新检查一致性假设；用锁等待、失败率和业务结果共同验证，不能仅看吞吐量增加。','lock']
  ],
  'python-algo': [
    ['tech','core','asyncio 的 TaskGroup 和 gather 在子任务失败时有什么不同？什么时候希望快速取消同组任务？','TaskGroup gather 异常','比较失败处理；说明结构化生命周期；清理资源','TaskGroup 用作用域管理子任务，一项失败时会协调同组任务取消并汇总异常。gather 的默认异常传播与同组取消行为不同；应根据任务是否彼此依赖选择，并确保清理逻辑可在取消时执行。','async'],
    ['tech','core','协程被取消后，finally 一定可以省略吗？吞掉 CancelledError 会造成什么问题？','CancelledError finally 取消','释放资源；传播取消信号；区分超时与业务错误','取消是协作式的，会在适当的等待点传递。资源释放应放入可靠的清理路径，通常不应无条件吞掉取消信号，否则上层任务组或超时逻辑可能无法按约定结束。','async'],
    ['scenario','core','异步接口中混入同步文件处理或阻塞 SDK 调用，为什么整个服务会卡顿？怎样验证和修复？','asyncio to_thread 阻塞','识别事件循环阻塞；区别 I/O 与 CPU；观察调度延迟','async 函数里直接调用阻塞操作仍会阻塞事件循环。阻塞 I/O 可考虑转入线程；纯 Python 的 CPU 密集计算还应评估进程等方案。修复后观察并发请求的尾延迟和事件循环延迟。','async'],
    ['tech','core','为什么先在全量数据上做标准化或特征选择，再划分训练集，会导致评估失真？','数据泄漏 Pipeline 标准化','先划分数据；只在训练数据拟合；每折独立预处理','预处理的统计量也是从数据学习得到的。若提前使用测试集信息，评估会过于乐观；应在训练子集拟合变换，并让 Pipeline 把每折预处理与模型训练放在同一验证流程中。','leakage'],
    ['scenario','deep','做用户行为预测时，同一用户的记录进入训练集和测试集，可能出现什么偏差？','GroupKFold 用户泄漏 分组','匹配部署目标；按实体分组；比较分组与随机评估','如果部署目标是泛化到新用户，随机按记录切分会使同一用户特征泄漏到两侧。应按用户分组划分，并根据真实上线目标选择验证单位，不能把随机划分的高分直接视为泛化能力。','cv'],
    ['tech','core','时间序列预测为什么不宜直接使用随机 K 折？怎样设计滚动验证？','时间序列 滚动验证 未来信息','保持时间顺序；设置训练窗口；避免未来特征泄漏','时间数据应按实际可获得的信息顺序评估。滚动验证使用过去训练、未来验证，并按任务考虑间隔和窗口；特征构造也只能使用预测时已知的信息，防止隐含未来信息。','cv'],
    ['scenario','deep','一次调参比较了上百个模型，为什么不能根据测试集分数反复决定最终方案？','测试集 调参 过拟合','区分验证与最终测试；限制反复窥探；保留独立评估','反复利用测试结果选模型，相当于把测试集当成了验证集。应在训练和验证流程内进行调参，把最终测试集留作一次相对独立的泛化估计，并记录选择流程。','leakage'],
    ['tech','core','设定随机种子后，PyTorch 训练就能在不同设备和版本上完全复现吗？','随机种子 确定性 复现','控制多个随机源；记录环境；说明确定性代价','复现实验需要控制 Python、NumPy 和框架等随机源，并记录数据顺序、版本与设备。随机种子不保证跨版本和设备完全一致；某些确定性配置还可能牺牲性能，需要如实说明复现边界。','random'],
    ['project','core','团队两个人训练同一模型却得到不同结果，你会怎样建立可追溯的实验记录？','实验记录 数据版本 随机种子','记录配置与环境；固定数据切分；保存指标和产物','实验记录应能够重建数据版本、切分方式、预处理、超参数、随机源、运行环境和模型产物。先核对这些条件，再判断差异来自随机波动还是实现问题，避免仅比较一个最终准确率。','random'],
    ['tech','core','自动混合精度训练中 autocast 和 GradScaler 分别解决什么问题？','AMP autocast GradScaler','区分计算精度选择与梯度缩放；识别溢出；验证收敛','autocast 根据算子选择合适精度，梯度缩放可缓解低精度梯度下溢。是否使用缩放取决于精度格式与训练配置；必须比较数值稳定性和验证指标，不能只用显存下降判断训练正确。','amp'],
    ['tech','deep','显存不足时使用梯度累积，loss、清梯度和 optimizer.step 的时机如何安排？','梯度累积 有效批量 optimizer','明确累积窗口；按目标缩放损失；正确清理梯度','梯度累积把多个微批次的梯度合并后再更新参数。应保持损失缩放与有效批量一致，在累积边界执行更新并清梯度；结合混合精度时，还需协调缩放、反缩放和梯度裁剪的时机。','amp'],
    ['tech','core','用向量内积检索近邻，为什么不一定等价于余弦相似度？什么时候需要归一化？','余弦 内积 归一化','区分向量模长与方向；统一入库和查询处理；匹配模型度量','内积同时受到向量方向和长度影响。对数据库向量与查询向量都做单位化后，内积可对应余弦相似度；检索度量与训练目标和索引配置必须匹配，不能只在查询端临时归一化。','faiss'],
    ['scenario','deep','更换 Embedding 模型后，为什么不能直接拿新查询向量去搜索旧索引？','Embedding 版本 重建索引','检查维度和向量空间；设计双索引切换；回归检索质量','不同模型生成的向量通常不处在可直接比较的语义空间，即使维度相同也不能默认兼容。应记录模型与预处理版本，重新编码语料并验证检索，再按版本切换查询和索引。','faiss'],
    ['tech','core','关键词检索和向量检索结果分数尺度不同，RRF 怎样把两路结果融合？','BM25 向量 RRF','解释按排名融合；使用统一文档标识；理解召回限制','RRF 主要根据各列表中的排名累计贡献，无需直接相加不同尺度的原始分数。融合前需统一文档标识并去重；如果两路都没召回正确文档，融合本身也不能补出缺失证据。','rrf'],
    ['scenario','deep','专业缩写和精确型号经常检索不到，你会怎样判断要增加词法召回、向量召回还是重排？','混合检索 缩写 重排','建立失败查询集；分开测召回和排序；比较延迟成本','先用有标注的失败查询确认正确证据是否进入候选集。精确字符串通常需要词法召回，语义改写可借助向量召回；只有候选已包含证据而排序不足时，重排才是直接的改进点。','rrf'],
    ['project','deep','给现有 RAG 系统增加一批新文档后，你会怎样证明检索质量没有退化？','RAG 回归 标注 查询集','固定评估集；分知识范围和用户问法；比较召回排序与成本','评估需要保留代表性查询和可接受证据标注，对比变更前后的候选命中、排名和响应成本。新增文档可能改变词频或近邻分布，应分别看原知识和新增知识，避免只展示几个成功案例。','rrf'],
    ['scenario','core','多个异步检索工具中只有部分可用，Agent 应直接失败还是返回部分证据？你会如何设计？','异步检索 超时 部分证据','区分必要与可选工具；限制总预算；标记缺失证据','是否允许部分成功由任务约束决定。并发工具调用应有各自期限和整体预算，必需证据缺失时应说明无法判断；可选来源失败可以降级，但不能把不完整证据包装成完整结论。','async'],
    ['tech','deep','在取消推理请求后，为什么 GPU 或远端请求仍可能继续工作？如何限制无效计算？','取消 协作式 中止','区分调用取消与资源中止；检查 SDK 支持；记录剩余任务','上层协程取消不必然中止底层计算或已经发出的请求。需要检查执行器、客户端与服务端的中止能力，并限制队列和任务预算；通过取消后的资源曲线及在途任务数验证是否真正释放。','async']
  ],
  'web-frontend': [
    ['tech','core','React 事件处理函数里的 state 为什么可能是旧值？连续三次 setCount(count + 1) 会怎样？','React state 快照 函数更新','理解每次渲染的快照；区分替换和函数更新；避免闭包误判','每次渲染生成的事件处理器读取该次渲染的状态快照。多次基于同一旧值计算的替换更新不等于连续递增；依赖前一个结果时可使用函数式更新，不能把状态当成同步可变变量。','snapshot'],
    ['scenario','core','组件卸载后异步请求才返回，或搜索结果乱序覆盖，你会怎样防止过期结果更新页面？','React cleanup 请求竞态','使旧结果失效；中止可中止请求；检查当前请求身份','异步响应顺序不一定等于发起顺序。清理时使旧请求失效，回填前核对请求身份；可配合 AbortController 中止工作，但仍应对无法中止或已完成的响应做过期检查。','effects'],
    ['tech','core','React 开发环境里 Effect 会额外执行一次，为什么只加一个全局标记并不是可靠修复？','Effect StrictMode 清理','让初始化和清理对称；正确依赖；支持重新挂载','开发检查帮助发现 Effect 未清理的问题。订阅、连接和定时器应在清理时释放；通过全局标记阻止再次运行可能掩盖泄漏，并破坏多个实例或重新挂载时的正确行为。','effects'],
    ['tech','core','Vue computed 为什么不适合发请求或修改其他响应式状态？watch 和 watchEffect 如何取舍？','computed watch watchEffect','保持计算纯粹；区分显式与自动依赖；清理副作用','computed 主要用于派生数据，getter 应避免副作用。watch 可以明确指定来源，watchEffect 根据同步读取收集依赖；涉及异步请求时应处理清理和过期结果，不能让旧请求覆盖新状态。','computed'],
    ['scenario','deep','深层 watch 导致大表单卡顿，你会怎样缩小依赖范围并验证不是漏掉必要更新？','Vue deep watch 性能','关注具体字段；评估深遍历成本；用交互用例验证','深层侦听可能需要遍历大量嵌套属性。应根据真实业务选择具体字段或派生值，避免对整份大对象无差别侦听；用表单交互回归和性能测量同时检查更新正确性与开销。','watchers'],
    ['tech','core','AbortController 取消 fetch 后，为什么业务代码仍需要检查当前请求是否已过期？','AbortController 请求身份 竞态','理解取消边界；区分中止和业务错误；阻止旧结果提交','中止信号可通知支持它的操作停止，但无法撤销已经完成的业务副作用。页面还需以请求标识或版本判断响应是否有效，并把中止与普通失败分开处理，避免误报或覆盖新结果。','abort'],
    ['scenario','core','用户快速切换十个搜索条件，你会如何组合防抖、请求取消与结果缓存？','防抖 取消 缓存','区分减少请求和保证正确；缓存键包含条件；处理过期','防抖减少发起次数，取消减少无效在途工作，响应版本检查保证提交结果的正确性。缓存键需要包含所有影响结果的条件；命中缓存时仍要处理过期和刷新，三者各有职责。','abort'],
    ['tech','core','SSE 和 WebSocket 的通信方向有什么不同？大模型逐字输出为什么常用 SSE？','SSE EventSource 单向','区分通信模型；解释事件流格式；清理连接','SSE 适合服务端持续向浏览器推送文本事件，标准 EventSource 主要是一条服务端到客户端的单向连接。双向高频通信可评估 WebSocket；无论何种方式都需要处理断线、资源清理与界面状态。','sse'],
    ['scenario','deep','流式回复断线后重连，如何防止同一段内容被追加两次？','SSE event id 去重','标识事件；定义续传范围；处理重复和缺口','流式协议应给事件稳定标识，客户端记录已处理位置；重连后按合同续传并去重，发现缺口则明确补齐或重置。不能仅依赖字符串前缀猜测，因为重复词句可能本来就是合法内容。','sse'],
    ['tech','core','IndexedDB 与 localStorage 相比有哪些能力差异？保存离线面试草稿时你会选哪一个？','IndexedDB 事务 异步','比较同步和异步；说明结构化数据；考虑配额和失败','IndexedDB 适合异步存储较复杂的结构化数据并支持事务。localStorage 接口简单但同步；实际草稿功能还应处理存储配额、写入失败、版本升级与用户清理，不能默认本地数据永不丢失。','idb'],
    ['scenario','deep','离线缓存升级时旧数据结构仍在，怎样设计 IndexedDB 的版本迁移和失败恢复？','IndexedDB versionchange 迁移','明确版本变更路径；协调旧连接；保留可恢复状态','数据库升级应在规定的版本变更流程中进行，并处理其他标签页持有旧连接的情况。迁移需兼容从多个旧版本升级，失败时保留可恢复数据；不要把清空所有历史作为默认迁移策略。','idb'],
    ['tech','core','把大 JSON 解析和计算放进 Web Worker，是否一定更快？数据复制与 Transferable 有什么影响？','Worker 结构化克隆 Transferable','区分响应性和总耗时；计算通信成本；理解所有权转移','Worker 可把计算移出主线程，改善交互响应，但通信和数据处理也有成本。消息通常经过结构化克隆；支持转移的数据可以避免部分复制，但转移后原侧的访问能力会改变，需要明确所有权。','worker'],
    ['scenario','deep','富文本导入功能要显示用户填写的题干，如何避免把恶意标签当成页面执行？','XSS textContent CSP','优先按文本输出；区分转义与净化；把 CSP 作为额外防线','纯文字内容应通过安全的文本接口或上下文正确的转义输出。必须支持富文本时使用经过验证的净化方案；CSP 可降低某些注入后果，但不能代替安全的内容处理和可信资源策略。','csp'],
    ['tech','core','前端接口响应声明成 TypeScript 类型后，运行时就安全吗？unknown 比 any 好在哪里？','unknown any 类型收窄','区分编译与运行时；验证外部输入；通过守卫收窄','TypeScript 的类型声明不会自动校验网络输入。unknown 迫使使用前先检查和收窄，而 any 会绕过许多检查；外部 JSON 应经过运行时结构和字段校验，再进入业务逻辑。','ts'],
    ['scenario','core','页面并发加载五块互相独立的数据，一块失败不该拖垮整页，Promise.allSettled 怎样使用？','allSettled 部分失败 降级','区分全部成功与全部完成；保留结果对应关系；设计局部重试','allSettled 会收集每个输入的完成状态，适合互不依赖的模块分别展示成功与失败。需要将结果和原模块正确对应，给失败块提供重试；不能把失败结果当成正常数据参与汇总。','settled'],
    ['project','deep','你优化了实验室里的性能分数，但真实用户仍觉得慢，会怎样结合 Web Vitals 和现场数据继续定位？','Web Vitals INP 现场数据','区别实验室和真实用户；按设备网络分组；观察分位数','实验室测试便于复现，现场数据反映真实设备、网络和交互。应分群观察加载、交互与视觉稳定性，并检查分位数和异常样本；一次高分不能证明所有用户的实际体验都已改善。','vitals'],
    ['tech','deep','Vue 大列表中给每一行传入新对象，为什么可能导致无谓更新？你会怎样保持 props 稳定？','Vue props 稳定 更新','识别引用变化；减少不必要依赖；用分析工具验证','父组件更新时，如果大量子组件接收的 props 不稳定，就可能扩大更新范围。应将真正变化的状态与稳定数据分开，并在测量后采用适合的优化；不要在未定位瓶颈时添加复杂缓存。','performance'],
    ['project','core','为面试页面设计一个请求状态机，你会怎样处理开始、取消、失败重试和迟到响应？','状态机 取消 迟到响应','定义合法转换；请求绑定会话；验证结束后的行为','页面请求应绑定明确的会话或请求版本。取消或结束后，使旧回调失效并释放定时器与监听；对开始、完成、失败和重试定义合法转换，再用迟到响应等时序用例验证。','abort']
  ]
};
for (const [position, rows] of Object.entries(batches)) {
  const file = path.join(__dirname, '..', 'data', 'questions', position + '.json');
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  let added = 0;
  rows.forEach(([type, stage, text, keywords, points, reference, source], i) => {
    const id = `ext20261027_${i + 1}`;
    if (b.questions.some(q => q.id === id || q.text === text)) return;
    const criteria = points.split('；');
    b.questions.push({ id, type, stage, text, keywords: keywords.split(' '), points: criteria,
      hint: '先解释问题边界，再结合项目举例。重点：' + criteria.join('；') + '。', reference, sources: [S[source]] });
    added++;
  });
  fs.writeFileSync(file, JSON.stringify(b, null, 2) + '\n');
  console.log(position, '+', added, '=>', b.questions.length);
}

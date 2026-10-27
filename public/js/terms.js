/* lib/terms.js —— 技术术语纠偏词典（含口音/谐音变体）
 *
 * 问题：离线 ASR（zipformer-zh）对专业英文名词识别不准，尤其带口音时会被听成
 * 中文谐音（Redis→"瑞迪斯"、MySQL→"麦斯扣"、Vue→"威优"）或小写英文（jvm/redis）。
 *
 * 方案：识别结果返回前做一次术语归一：
 *   ① 中文谐音变体 → 标准英文写法（覆盖常见口音误识）
 *   ② ASCII 小写/大小写混乱 → 标准大小写（jvm→JVM、redis→Redis、vue→Vue）
 * 只在"完整词/词组"边界替换，避免误伤正常中文与英文单词。
 */
const TERMS = [
  // —— 后端 / 中间件 / 数据库 ——
  { to: 'Redis', from: ['瑞迪斯', '雷迪斯', '瑞帝斯', '锐迪斯', '瑞的斯', '瑞迪思', 'redis'] },
  { to: 'MySQL', from: ['麦斯扣', '迈斯扣', '麦斯Q', '买sql', '麦斯库', 'mysql'] },
  { to: 'Kafka', from: ['卡夫卡', '卡福卡', 'kafka'] },
  { to: 'RocketMQ', from: ['rocketmq', '罗凯特MQ', '火箭MQ'] },
  { to: 'RabbitMQ', from: ['rabbitmq', '瑞比特MQ'] },
  { to: 'Spring', from: ['斯普瑞', '斯普林', '斯不瑞', '斯普瑞ng', 'spring'] },
  { to: 'SpringBoot', from: ['斯普瑞布特', '斯普林布特', 'springboot', 'spring boot'] },
  { to: 'MyBatis', from: ['麦巴蒂斯', '买巴蒂斯', '麦巴提斯', 'mybatis'] },
  { to: 'Docker', from: ['道克', '多克', '刀客', 'docker'] },
  { to: 'Kubernetes', from: ['库伯内特斯', 'k8s', 'K8S', 'kubernetes'] },
  { to: 'Nginx', from: ['恩吉克斯', 'N吉克斯', 'engine x', 'nginx'] },
  { to: 'ZooKeeper', from: ['祖keeper', '祖克珀', 'zookeeper'] },
  { to: 'Elasticsearch', from: ['es搜索', 'elastic search', 'elasticsearch'] },
  { to: 'MongoDB', from: ['芒果DB', '芒果db', 'mongodb'] },
  { to: 'Tomcat', from: ['tomcat'] },
  { to: 'Netty', from: ['netty', '内蒂'] },
  { to: 'Dubbo', from: ['dubbo', '都伯', '杜博'] },
  { to: 'Canal', from: ['canal', '卡纳尔'] },
  { to: 'Sentinel', from: ['sentinel', '森提奈尔'] },
  { to: 'Linux', from: ['李纽克斯', '里努克斯', 'linux'] },
  { to: 'JVM', from: ['jvm', 'Jvm', '加瓦虚拟机'] },
  { to: 'JMM', from: ['jmm', 'Jmm'] },
  { to: 'GC', from: ['gc', 'Gc'] },
  { to: 'Full GC', from: ['fullgc', 'full gc', 'FullGC', '富尔GC'] },
  { to: 'OOM', from: ['oom', 'Oom'] },
  { to: 'JVM 调优', from: ['jvm调优'] },
  // —— Java / 并发 ——
  { to: 'HashMap', from: ['哈希map', 'hashmap', '哈希麦普', '哈西map'] },
  { to: 'ConcurrentHashMap', from: ['并发哈希map', 'concurrenthashmap'] },
  { to: 'ArrayList', from: ['arraylist', '数组list'] },
  { to: 'LinkedList', from: ['linkedlist', '链表list'] },
  { to: 'ThreadLocal', from: ['threadlocal', '线程local'] },
  { to: 'volatile', from: ['volatile', '沃兰泰勒'] },
  { to: 'synchronized', from: ['synchronized'] },
  { to: 'CAS', from: ['cas', 'Cas'] },
  { to: 'AQS', from: ['aqs', 'Aqs'] },
  { to: '线程池', from: ['线城池', '县城池'] },
  { to: 'MVCC', from: ['mvcc', 'Mvcc'] },
  { to: 'SQL', from: ['sql', 'Sql', 'circle'] },
  { to: '索引', from: ['缩影'] },
  { to: 'B+ 树', from: ['b加树', 'b+树', 'B加树'] },
  { to: 'RPC', from: ['rpc', 'Rpc'] },
  { to: 'MQ', from: ['mq', 'Mq'] },
  { to: 'JWT', from: ['jwt', 'Jwt'] },
  { to: 'CDN', from: ['cdn', 'Cdn'] },
  { to: 'HTTP', from: ['http', 'Http'] },
  { to: 'HTTPS', from: ['https', 'Https'] },
  { to: 'TCP', from: ['tcp', 'Tcp'] },
  { to: 'DNS', from: ['dns', 'Dns'] },
  { to: 'API', from: ['api', 'Api'] },
  { to: 'QPS', from: ['qps', 'Qps'] },
  { to: 'TPS', from: ['tps', 'Tps'] },
  { to: 'P99', from: ['p99', 'P99'] },
  { to: 'Prometheus', from: ['普罗米修斯', 'prometheus'] },
  { to: 'Grafana', from: ['grafana', '格拉法纳'] },
  { to: 'SkyWalking', from: ['skywalking', '天行者'] },
  { to: 'Arthas', from: ['arthas', '阿尔萨斯'] },
  // —— 前端 ——
  { to: 'Vue', from: ['威优', '维优', 'VUE', 'vue', 'V U E'] },
  { to: 'Vue3', from: ['vue3', '威优3', 'Vue 3'] },
  { to: 'React', from: ['瑞艾克特', '瑞阿克特', 'react', 'React'] },
  { to: 'Angular', from: ['安古拉', 'angular', 'Angular'] },
  { to: 'Webpack', from: ['威派克', 'webpack', 'WebPack'] },
  { to: 'Vite', from: ['维特', '外特', 'vite', 'Vite'] },
  { to: 'Node.js', from: ['诺德js', 'nodejs', 'node.js', 'NodeJS'] },
  { to: 'TypeScript', from: ['太普斯克里特', 'typescript', 'TypeScript', 'TS', 'ts'] },
  { to: 'JavaScript', from: ['javascript', 'JavaScript', 'JS', 'js'] },
  { to: 'CSS', from: ['css', 'Css', '西西西'] },
  { to: 'HTML', from: ['html', 'Html'] },
  { to: 'DOM', from: ['dom', 'Dom'] },
  { to: 'Flex', from: ['福莱克斯', 'flex', 'Flex'] },
  { to: 'Proxy', from: ['普罗西', '普洛克西', 'proxy', 'Proxy'] },
  { to: 'Promise', from: ['普罗米斯', '普若米斯', 'promise', 'Promise'] },
  { to: 'Event Loop', from: ['eventloop', '事件循环event loop'] },
  { to: '虚拟 DOM', from: ['虚拟dom', '虚拟DOM', '虚拟当'] },
  { to: 'Pinia', from: ['pinia', '皮尼亚'] },
  { to: 'Vuex', from: ['vuex', 'VueX'] },
  { to: 'Redux', from: ['redux', '瑞达克斯'] },
  { to: 'Axios', from: ['axios', '阿克西奥斯'] },
  { to: 'CORS', from: ['cors', 'Cors', '考斯'] },
  { to: 'WebSocket', from: ['websocket', 'WebSocket'] },
  { to: 'Sass', from: ['sass', '萨斯'] },
  { to: 'Tailwind', from: ['tailwind', 'TailWind'] },
  { to: 'Babel', from: ['babel', '巴别尔'] },
  { to: 'ESLint', from: ['eslint', 'ESLint', 'es lint'] },
  { to: 'LCP', from: ['lcp', 'Lcp'] },
  { to: 'SSR', from: ['ssr', 'Ssr'] },
  { to: 'SPA', from: ['spa', 'Spa'] },
  { to: 'PWA', from: ['pwa', 'Pwa'] },
  { to: 'SEO', from: ['seo', 'Seo'] },
  { to: 'Source Map', from: ['sourcemap', 'source map'] },
  { to: 'Electron', from: ['electron', '伊莱克tron'] },
  { to: 'uni-app', from: ['uniapp', 'uni app'] },
  // —— 算法 / AI ——
  { to: 'Multi-Agent', from: ['multi-agent', 'multi agent'] },
  { to: 'Agent', from: ['agent', 'A整', 'A 整', '诶简特', '艾简特', '诶gent'] },
  { to: 'DeepSeek', from: ['deepseek', 'deep seek', '迪普西克'] },
  { to: 'LangChain', from: ['langchain', 'lang chain'] },
  { to: 'LangGraph', from: ['langgraph', 'lang graph'] },
  { to: 'MCP', from: ['mcp', 'M C P'] },
  { to: 'ReAct', from: ['re act'] },
  { to: 'Python', from: ['派森', '怕森', 'python', 'Python'] },
  { to: 'PyTorch', from: ['派托驰', 'pytorch', 'PyTorch'] },
  { to: 'TensorFlow', from: ['tensorflow', 'TensorFlow'] },
  { to: 'NumPy', from: ['numpy', '那派'] },
  { to: 'Pandas', from: ['pandas', '攀达斯'] },
  { to: 'XGBoost', from: ['xgboost', 'XGBoost', '埃克斯gboost'] },
  { to: 'LightGBM', from: ['lightgbm', 'LightGBM'] },
  { to: 'Transformer', from: ['transformer', 'Transformer', '特兰斯福莫'] },
  { to: 'Attention', from: ['attention', 'Attention'] },
  { to: 'Self-Attention', from: ['self attention'] },
  { to: 'BERT', from: ['bert', 'Bert', '波特'] },
  { to: 'GPT', from: ['gpt', 'Gpt'] },
  { to: 'LLM', from: ['llm', 'Llm'] },
  { to: 'RAG', from: ['rag', 'Rag', '锐鸡'] },
  { to: 'LoRA', from: ['lora', 'Lora', '劳拉'] },
  { to: 'Embedding', from: ['embedding', 'Embedding', '艾姆 bedding'] },
  { to: 'Faiss', from: ['faiss', 'Faiss', '菲斯'] },
  { to: 'Milvus', from: ['milvus', 'Milvus'] },
  { to: 'softmax', from: ['softmax', 'SoftMax', 'sofemax'] },
  { to: 'ReLU', from: ['relu', 'ReLu'] },
  { to: 'CNN', from: ['cnn', 'Cnn'] },
  { to: 'RNN', from: ['rnn', 'Rnn'] },
  { to: 'LSTM', from: ['lstm', 'Lstm'] },
  { to: 'GAN', from: ['gan', 'Gan'] },
  { to: 'AUC', from: ['auc', 'Auc'] },
  { to: 'F1', from: ['f1', 'F1'] },
  { to: 'GPU', from: ['gpu', 'Gpu'] },
  { to: 'CUDA', from: ['cuda', 'Cuda'] },
  { to: 'ONNX', from: ['onnx', 'Onnx'] },
  { to: 'NLP', from: ['nlp', 'Nlp'] },
  { to: 'OCR', from: ['ocr', 'Ocr'] },
  { to: 'ASR', from: ['asr', 'Asr'] },
  { to: 'TTS', from: ['tts', 'Tts'] },
  { to: 'Prompt', from: ['prompt', '普若普特'] },
  { to: 'Token', from: ['token', 'Token'] },
  { to: '过拟合', from: ['过你和', '过你和'] },
  { to: '欠拟合', from: ['欠你和'] },
  { to: '梯度下降', from: ['剃度下降'] },
  { to: '交叉验证', from: ['交叉验真'] },
  { to: '消融实验', from: ['消融试验'] }
];

/* 口语混读模式层：ASR 常把技术名词听成「中文谐音 + 空格 + 英文词」的组合（如 HashMap→"哈 map"），
 * 音变很多，无法穷举词条，故用正则覆盖发音相近的一族写法。放在 TERMS 之前执行。 */
const PATTERNS = [
  // —— Java 集合：最常见的重灾区（"哈 map" / "哈希 map" / "哈西map"…）——
  // 注意顺序：长词（并发map/链表map）必须排在 HashMap 之前，否则会被短规则先吞掉
  { to: 'ConcurrentHashMap', re: /(?<![A-Za-z])(并发|康凯特|肯卡伦特|康卡伦特|康凯瑞特|康卡瑞特|concurrent|Concurrent)[\s·・]*(HashMap|哈希?[\s·・]*map|哈[\s·・]*希?[\s·・]*map|hash[\s·・]*map|map)(?![A-Za-z])/gi },
  { to: 'LinkedHashMap', re: /(?<![A-Za-z])(链表|林克特|linked|Linked)[\s·・]*(HashMap|哈希?[\s·・]*map|哈[\s·・]*希?[\s·・]*map|hash[\s·・]*map|map)(?![A-Za-z])/gi },
  { to: 'HashTable', re: /(?<![A-Za-z])(哈|哈什|哈西|哈希|hash)[\s·・]*(table|Table|泰博|泰布尔)(?![A-Za-z])/gi },
  { to: 'HashSet', re: /(?<![A-Za-z])(哈|哈什|哈西|哈希|hash)[\s·・]*(set|Set|赛特)(?![A-Za-z])/gi },
  { to: 'TreeMap', re: /(?<![A-Za-z])(tree|Tree|特瑞|树)[\s·・]*(map|Map)(?![A-Za-z])/g },
  { to: 'HashMap', re: /(?<![A-Za-z])(哈|哈斯|哈什|哈西|黑什|亥什|嗨稀|哈许|嗨许)[\s·・]*[希西许斯]?[\s·・]*(map|MAP|Map|麦普|马普|迈普|迈扑|玛普)(?![A-Za-z])/g },
  { to: 'ArrayList', re: /(?<![A-Za-z])(array|Array|阿瑞|埃瑞|儿瑞|额瑞)[\s·・]*(list|List|力斯特)(?![A-Za-z])/g },
  { to: 'LinkedList', re: /(?<![A-Za-z])(linked|Linked|林克特|链表)[\s·・]*(list|List|力斯特)(?![A-Za-z])/g },
  { to: 'ThreadLocal', re: /(?<![A-Za-z])(thread|Thread|思瑞德|斯莱德|斯瑞德|线城|县城|线程)[\s·・]*(local|Local|楼口|洛克|罗克)(?![A-Za-z])/g },
  { to: 'StringBuilder', re: /(?<![A-Za-z])(string|String|思俊|斯俊)[\s·・]*(builder|Builder|必得|比尔德)(?![A-Za-z])/g },
  { to: 'StringBuffer', re: /(?<![A-Za-z])(string|String|思俊|斯俊)[\s·・]*(buffer|Buffer|巴佛|巴菲)(?![A-Za-z])/g },
  { to: 'volatile', re: /(?<![A-Za-z])(沃兰泰勒|沃勒泰|沃来泰)[\s·・]*(泰|太)?[\s·・]*(tile|tle)?(?![A-Za-z])/g },
  { to: 'synchronized', re: /(?<![A-Za-z])(辛格耐子|辛格耐兹|sing克耐|singk)[\s·・]*(耐兹|奈兹|耐子)?(?![A-Za-z])/g },
  // —— 后端中间件 ——
  { to: 'Redis', re: /(?<![A-Za-z])(瑞|锐|雷|睿|瑞德)[\s·・]*(迪|帝|的|德)?[\s·・]*(斯|思|丝|dis)(?![A-Za-z])/g },
  { to: 'MySQL', re: /(?<![A-Za-z])(麦|迈|买|卖|麦斯)[\s·・]*(斯|思|的|德)?[\s·・]*(扣|库|sql|SQL|色口)(?![A-Za-z])/g },
  { to: 'PostgreSQL', re: /(?<![A-Za-z])(postgre|Postgre|波斯格雷|波斯特)[\s·・]*(sql|SQL|斯扣|色口)(?![A-Za-z])/g },
  { to: 'MyBatis', re: /(?<![A-Za-z])(麦|迈|买|麦巴)[\s·・]*(巴)?[\s·・]*(蒂斯|提斯|第斯|迪斯)(?![A-Za-z])/g },
  { to: 'SpringBoot', re: /(?<![A-Za-z])(斯|思|spring|Spring)[\s·・]*(普|不|布)[\s·・]*(瑞|林|瑞英)?[\s·・]*(boot|Boot|布特|不特|波特)(?![A-Za-z])/g },
  { to: 'SpringCloud', re: /(?<![A-Za-z])(斯|思|spring|Spring)[\s·・]*(普|不|布)[\s·・]*(瑞|林)?[\s·・]*(cloud|Cloud|克劳德|可捞的)(?![A-Za-z])/g },
  { to: 'Nginx', re: /(?<![A-Za-z])(恩|嗯|ng|NG)[\s·・]*(吉|鸡|机|g)[\s·・]*(克斯|克思|nix)(?![A-Za-z])/g },
  { to: 'Kafka', re: /(?<![A-Za-z])(卡|咖)[\s·・]*(夫|福|弗)[\s·・]*(卡|咖|ka)(?![A-Za-z])/g },
  { to: 'RocketMQ', re: /(?<![A-Za-z])(罗|骆|rock|Rock)[\s·・]*(凯|凯特|ket)?[\s·・]*(MQ|mq)(?![A-Za-z])/g },
  { to: 'Netty', re: /(?<![A-Za-z])(net|Net|奈|内)[\s·・]*(ty|提|蒂|迪)(?![A-Za-z])/g },
  { to: 'Docker', re: /(?<![A-Za-z])(道|多|刀|doc|Doc)[\s·・]*(克|客|ker|Q)(?![A-Za-z])/g },
  { to: 'Tomcat', re: /(?<![A-Za-z])(tom|Tom|汤|唐|汤姆)[\s·・]*(cat|Cat|凯特|卡特)(?![A-Za-z])/g },
  { to: 'Elasticsearch', re: /(?<![A-Za-z])(elastic|Elastic|伊莱斯特)[\s·・]*(search|Search|色取|搜索)(?![A-Za-z])/g },
  { to: 'MongoDB', re: /(?<![A-Za-z])(芒果|mango|Mango|蒙戈)[\s·・]*(DB|db|蒂比)(?![A-Za-z])/g },
  { to: 'JVM', re: /(?<![A-Za-z])(加瓦|java|Java)[\s·・]*(虚拟机|虚机|VM|vm|威艾姆)(?![A-Za-z])/g },
  { to: 'GC', re: /(?<![A-Za-z])(G|g)[\s·・]*(C|c)(?![\u4e00-\u9fa5A-Za-z])/g },
  // —— 前端 ——
  { to: 'React', re: /(?<![A-Za-z])(瑞|锐)[\s·・]*(艾|爱|埃)[\s·・]*(克|可)[\s·・]*(特|te|t)?(?![A-Za-z])/g },
  { to: 'Webpack', re: /(?<![A-Za-z])(威|微|web|Web)[\s·・]*(派|拍|pa)[\s·・]*(克|客)(?![A-Za-z])/g },
  { to: 'WebSocket', re: /(?<![A-Za-z])(web|Web|微布)[\s·・]*(socket|Socket|索科特|赛克特)(?![A-Za-z])/g },
  { to: 'Promise', re: /(?<![A-Za-z])(普|普罗)[\s·・]*(若|罗)?[\s·・]*(米斯|密斯|迈斯)(?![A-Za-z])/g },
  { to: 'JavaScript', re: /(?<![A-Za-z])(Java|java|加瓦)[\s·・]*(Script|script|斯克里特|斯科瑞特)(?![A-Za-z])/g },
  { to: 'TypeScript', re: /(?<![A-Za-z])(Type|type|太普)[\s·・]*(Script|script|斯克里特|斯科瑞特)(?![A-Za-z])/g },
  // —— 算法 / AI ——
  { to: 'Transformer', re: /(?<![A-Za-z])(trans|Trans|特兰斯|川斯)[\s·・]*(former|佛莫|福莫|弗莫)(?![A-Za-z])/g },
  { to: 'DeepSeek', re: /(?<![A-Za-z])(deep|Deep|迪普|迪帕)[\s·・]*(seek|Seek|西克|思科)(?![A-Za-z])/g },
  { to: 'LangChain', re: /(?<![A-Za-z])(lang|Lang|朗|蓝)[\s·・]*(chain|Chain|琴|岑)(?![A-Za-z])/g }
];

/** 纯 ASCII 词：按单词边界替换，避免把 test 里的 es、test 里的 ts 误改 */
function replaceAscii(text, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'gi');
  return text.replace(re, to);
}

/** 识别结果术语归一 */
function normalize(text) {
  let out = String(text || '');
  if (!out) return out;
  // ① 口语混读模式（中文谐音 + 空格 + 英文词）优先归整，再走词条表
  for (const p of PATTERNS) out = out.replace(p.re, p.to);
  for (const t of TERMS) {
    for (const v of t.from) {
      if (/^[A-Za-z0-9.+ \-]+$/.test(v)) out = replaceAscii(out, v, t.to);
      else if (out.includes(v)) out = out.split(v).join(t.to);
    }
  }
  return out;
}

const termAPI = { normalize, TERMS };
if (typeof module !== 'undefined' && module.exports) module.exports = termAPI;
else window.InterviewTerms = termAPI;

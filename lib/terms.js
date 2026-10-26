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
  { to: 'ZooKeeper', from: ['祖keeper', '动物管理员', '祖克珀', 'zookeeper'] },
  { to: 'Elasticsearch', from: ['es搜索', 'elastic search', 'elasticsearch'] },
  { to: 'MongoDB', from: ['芒果DB', '芒果db', 'mongodb'] },
  { to: 'Tomcat', from: ['汤姆猫', 'tomcat'] },
  { to: 'Netty', from: ['netty', '内蒂'] },
  { to: 'Dubbo', from: ['dubbo', '都伯', '杜博'] },
  { to: 'Canal', from: ['canal', '卡纳尔'] },
  { to: 'Sentinel', from: ['sentinel', '森提奈尔', '哨兵'] },
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
  { to: 'synchronized', from: ['synchronized', '同步锁'] },
  { to: 'CAS', from: ['cas', 'Cas'] },
  { to: 'AQS', from: ['aqs', 'Aqs'] },
  { to: '线程池', from: ['线城池', '县城池'] },
  { to: 'MVCC', from: ['mvcc', 'Mvcc'] },
  { to: 'SQL', from: ['sql', 'Sql', 'circle'] },
  { to: '索引', from: ['所以', '缩影'] },
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
  { to: 'Python', from: ['派森', '怕森', 'python', 'Python'] },
  { to: 'PyTorch', from: ['派托驰', 'pytorch', 'PyTorch'] },
  { to: 'TensorFlow', from: ['tensorflow', 'TensorFlow'] },
  { to: 'NumPy', from: ['numpy', '那派'] },
  { to: 'Pandas', from: ['pandas', '攀达斯'] },
  { to: 'XGBoost', from: ['xgboost', 'XGBoost', '埃克斯gboost'] },
  { to: 'LightGBM', from: ['lightgbm', 'LightGBM'] },
  { to: 'Transformer', from: ['transformer', 'Transformer', '特兰斯福莫'] },
  { to: 'Attention', from: ['attention', 'Attention', '注意力机制'] },
  { to: 'Self-Attention', from: ['self attention', '自注意力'] },
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
  for (const t of TERMS) {
    for (const v of t.from) {
      if (!out.includes(v)) continue;
      if (/^[A-Za-z0-9.+\-]+$/.test(v)) out = replaceAscii(out, v, t.to);
      else out = out.split(v).join(t.to);
    }
  }
  return out;
}

module.exports = { normalize, TERMS };

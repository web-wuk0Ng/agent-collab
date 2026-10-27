// 术语归一口语混读回归测试：覆盖「中文谐音 + 空格 + 英文」混合读法，同时守住误伤红线
const { normalize } = require('../lib/terms');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`${ok ? '✔' : '✘'} ${name}\n    in : ${want}\n    out: ${got}`);
  ok ? pass++ : fail++;
};
const contains = (name, input, want) => {
  const got = normalize(input);
  const ok = got.includes(want);
  console.log(`${ok ? '✔' : '✘'} ${name} → ${got.slice(0, 90)}`);
  ok ? pass++ : fail++;
};

console.log('术语归一口语混读测试\n');

// —— 用户实测：HashMap 被听成"哈 map" ——
contains('用户实录 哈 map', '后端项目中的哈 map的相关的一些知识', 'HashMap');
contains('哈 map（带空格）', '我看了 HashMap 的源码哦不对是哈 map 的源码', 'HashMap');
contains('哈 西 map', '说说哈 西 map 的底层结构', 'HashMap');
contains('哈希 map', '哈希 map 的扩容机制', 'HashMap');
contains('哈希map（无缝）', '哈希map的底层实现', 'HashMap');
contains('哈迈普（全谐音）', '哈迈普大家都知道吧', 'HashMap');
contains('并发哈 map', '并发哈 map 怎么保证线程安全', 'ConcurrentHashMap');
contains('哈希 set', '哈希 set 去重原理', 'HashSet');

// —— 其他高频词同样要能扛住口音 ——
contains('瑞迪斯', '用瑞迪斯做缓存', 'Redis');
contains('雷迪斯', '雷迪斯做分布式锁', 'Redis');
contains('麦斯扣', '麦斯扣 的索引', 'MySQL');
contains('麦斯扣 SQL', '买的sql慢查询', 'MySQL');
contains('思瑞德 local', '思瑞德 local 会内存泄漏', 'ThreadLocal');
contains('斯普瑞 boot', '斯普瑞 boot 自动配置', 'SpringBoot');
contains('array list', 'array list 扩容机制', 'ArrayList');
contains('string builder', 'string builder 为什么快', 'StringBuilder');
contains('恩吉克斯', '恩吉克斯反向代理', 'Nginx');
contains('thread local', 'thread local 的弱引用', 'ThreadLocal');
contains('Trans former', 'Trans former 的自注意力', 'Transformer');
contains('Java 虚拟机', 'Java 虚拟机内存模型', 'JVM');

// —— 误伤红线：正常中文不能被改坏 ——
const KEEP = [
  '我平时会看中英文博客学习',
  '他的哥哥在卡夫听歌',
  '我们一起去看地图还有icola',
  '这个问题我确实不太清楚细节',
  '卡拉OK 里有一首老歌',
  'Java 的垃圾回收很重要',
  '我用 Git 管理代码并提交 commit',
  '这个问题的复杂度偏高',
  '我买了个麦片当早餐'
];
for (const s of KEEP) {
  const got = normalize(s);
  const ok = got === s;
  console.log(`${ok ? '✔' : '✘'} 不误伤：${s}\n    out: ${got}`);
  ok ? pass++ : fail++;
}

// —— 最后的红线：不能把 Java 单独改成 JVM ——
check('Java 不被改成 JVM', normalize('我做过 Java 后端开发'), '我做过 Java 后端开发');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

# Web 前端开发工程师 知识库

## 核心技术栈
前端岗位要求掌握：HTML5/CSS3（布局、动画、响应式）、JavaScript 核心（闭包、原型链、事件循环、异步）、ES6+、Vue 或 React 至少精通一个（响应式原理、组件通信、生命周期、Hooks）、TypeScript、工程化（Webpack/Vite、ESLint、CI）、浏览器原理（渲染流程、缓存、跨域）、HTTP 协议、性能优化。加分项：Node.js、小程序、可视化（Canvas/SVG/WebGL）、微前端。

## 考点：Flex 布局与水平垂直居中
Flex 容器属性：flex-direction（主轴方向）、justify-content（主轴对齐）、align-items（交叉轴对齐）、flex-wrap（换行）、gap；子项属性：flex-grow/shrink/basis（可用 flex:1 简写）、align-self、order。水平垂直居中方案：1）父 display:flex + justify-content:center + align-items:center（首选）；2）子绝对定位 top/left:50% + transform:translate(-50%,-50%)（兼容老浏览器）；3）Grid：父 display:grid + place-items:center（最简）；4）已知尺寸：absolute + margin 负值。要点是能说清主轴/交叉轴概念与至少两种方案的适用场景。

## 考点：事件循环（Event Loop）
JS 单线程，同步任务在调用栈执行；异步任务回调进入任务队列。宏任务（macrotask）：setTimeout/setInterval、I/O、UI 渲染、script 整体代码；微任务（microtask）：Promise.then/catch/finally、MutationObserver、queueMicrotask。执行规则：每执行完一个宏任务，清空整个微任务队列（期间产生的微任务也一并执行），再进行渲染，然后取下一个宏任务。经典输出顺序题：同步代码 → Promise.then（微任务）→ setTimeout（宏任务）。async/await 中 await 后面的代码相当于 then 回调，属于微任务。

## 考点：Vue 响应式原理
Vue2 用 Object.defineProperty 递归遍历 data 劫持每个属性的 getter/setter：getter 中做依赖收集（Dep 收集 Watcher），setter 中派发更新。缺陷：无法监听新增/删除属性（需 $set）、数组索引和 length 变化监听不到（重写数组七个方法）、初始化时递归开销大。Vue3 改用 Proxy 代理整个对象，可拦截属性增删、索引访问等 13 种操作，惰性代理（访问时才深层转换）性能更好；配合编译时优化（静态提升 hoistStatic、patchFlag 标记动态节点）使 diff 只比对动态部分。响应式三件套：reactive（对象代理）、ref（包装基本类型，.value 访问）、effect（副作用收集）。

## 考点：从输入 URL 到页面渲染
流程：1）URL 解析与缓存查找（浏览器缓存→系统缓存→hosts）；2）DNS 解析（递归查询）；3）TCP 三次握手，HTTPS 再加 TLS 握手；4）发送 HTTP 请求，服务器返回 HTML；5）解析 HTML 构建 DOM 树，解析 CSS 构建 CSSOM，合并为渲染树；6）布局（Layout 计算几何信息）→ 分层绘制（Paint）→ 合成（Composite）；7）JS 执行会阻塞 DOM 解析（script 默认同步，defer 异步下载按序执行，async 下载完即执行）。性能优化：网络层——HTTP2、CDN、gzip/brotli、强缓存+协商缓存、资源预加载 preload/prefetch；资源层——图片懒加载、WebP、代码分割与按需加载、Tree shaking；渲染层——减少重排（批量修改、transform 代替 top/left）、防抖节流、虚拟列表；指标——FCP/LCP/CLS 优化。

## 考点：虚拟 DOM 与 Diff
虚拟 DOM 是用 JS 对象描述真实 DOM 树的编程模型：状态变化先在新旧虚拟树间 Diff，再最小化 patch 到真实 DOM，兼顾性能与声明式开发体验。Diff 策略：同层比较（不跨层级）、不同类型节点直接替换其子树、同类型节点比较 props 并递归子节点。列表 diff 需要 key 标识节点身份：key 相同且内容变化就原地复用更新；用数组下标作 key 时，插入/删除会导致后续所有节点的 key 位移，Vue/React 会错误复用节点，造成状态错位（典型 bug：带输入框的列表项删中间一条后内容串位）、无法命中复用反而性能更差。key 应使用稳定唯一 id。

## 考点：跨域与同源策略
同源 = 协议、域名、端口三者相同；同源策略限制 Ajax/fetch 跨源读取响应、跨源 DOM 访问、部分存储 API，但不限制 img/script/link 标签的加载（这也是 JSONP 的原理，现在已少用）。解决方案：1）CORS（主流）——服务端设置 Access-Control-Allow-Origin 等响应头；非简单请求（如带自定义头的 PUT/JSON POST）先发 OPTIONS 预检请求，服务端需正确响应 Access-Control-Allow-Methods/Headers，带 cookie 需 Allow-Credentials:true 且 Origin 不能为 *；2）开发环境 proxy——devServer 代理转发，同源策略只作用于浏览器，服务端之间不受限；3）Nginx 反向代理——生产环境同域部署；4）JSONP（历史方案）、postMessage（跨窗口）。

## 考点：白屏排查
线上白屏排查路径：1）接入错误监控（window.onerror、unhandledrejection、资源加载 onerror）收集线上报错与用户环境；2）区分类型：JS 执行报错（白屏常见根因）、静态资源加载失败（CDN 故障、路径错误、缓存旧 chunk）、接口异常导致渲染中断；3）用 sourcemap 还原压缩代码堆栈定位到源码；4）兼容性问题：新版语法（可选链、空值合并）在老浏览器报 SyntaxError 导致整包失败——构建时配置 targets/browserslist 与 polyfill；5）灰度发布控制影响面，必要时快速回滚止血；6）本地无法复现时，对比线上与本地环境差异（数据、浏览器版本、网络），用录屏与用户信息辅助定位。

## 考点：长列表渲染优化
万级数据列表卡顿的根因是 DOM 节点过多：渲染慢、内存高、滚动重排开销大。优化：1）分页/触底加载——最简单，数据不过量时首选；2）虚拟列表——只渲染可视区 ± 缓冲区的条目（约 20 条），用总高度撑开滚动条，监听 scroll 计算起始索引并 transform 偏移，数据量万级也只维护少量 DOM；3）减少单条开销——事件委托代替每项绑定、避免深层嵌套组件、图片懒加载；4）滚动用 rAF 节流，避免布局抖动；5）不可变数据量极端大时考虑 Web Worker 处理数据。要点：先量化（Performance 面板看长任务与渲染耗时），再选方案。

## 行为面试要点（前端）
自我介绍突出：技术栈匹配度、作品链接（面试官能点开看的项目最有说服力）、学习能力（怎么跟上新框架）。面对高成本需求的沟通范式：先追问需求背后的目标（用户是谁、要解决什么问题）→ 给出 2~3 个不同成本的方案及各自效果差异 → 用数据/原型说话（如 A/B 数据、竞品做法）→ 把技术成本翻译成业务语言（工期、风险、体验）→ 尊重最终决策并执行。切忌直接说"做不了"，而是说"怎么做更划算"。

## 优秀回答范例
范例（事件循环）：「JS 是单线程语言，同步任务在调用栈里执行，异步回调进入任务队列。队列分两类：微任务如 Promise.then，宏任务如 setTimeout。每执行完一个宏任务，会先把整个微任务队列清空，其中新产生的微任务也会继续执行，然后才可能进行页面渲染，再取下一个宏任务。比如 `console.log(1); setTimeout(()=>console.log(2)); Promise.resolve().then(()=>console.log(3)); console.log(4);` 输出是 1 4 3 2：同步先执行 1 和 4，然后微任务 3，最后宏任务 2。这个机制直接影响异步代码时序，比如我会在渲染前把 DOM 计算放到微任务里，避免闪烁。」——要点：模型准确、能现场推演、落到实践。

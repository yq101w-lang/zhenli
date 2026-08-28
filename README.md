# 缓冲区 · 考研 / ADHD 友好型个人工作台

一个纯原生、local-first、手机优先的个人工作台。它不展示羞耻型完成率，不要求永不偏离，而是帮助用户更容易开始、状态差时降低难度、偏离后更容易回来。

> 系统承担记忆，我承担生活。  
> 不需要现在解决整个人生，只处理下一步。

## 技术架构

本项目没有任何前端框架、构建工具、运行时 npm 包或开发依赖。

- HTML5
- 原生响应式 CSS
- Vanilla JavaScript，所有浏览器脚本均使用 IIFE
- IndexedDB 本地持久化
- Node.js 内置模块静态服务器与 AI 代理
- 原生 Service Worker 离线缓存
- Node.js 内置 `node:test` 测试

`package.json` 中没有 `dependencies` 或 `devDependencies`，启动前无需执行 `npm install`。

## 启动

需要 Node.js 20 或更高版本：

```bash
node server.js
```

或：

```bash
npm start
```

默认地址：<http://127.0.0.1:4173>

自定义监听地址：

```powershell
$env:HOST="0.0.0.0"
$env:PORT="8080"
node server.js
```

项目没有构建步骤。修改 `public/` 后刷新浏览器即可；Service Worker 更新时可在“设置与数据”中点击“检查离线资源更新”。

## AI 代理配置

AI 功能是可选能力；不设置 API key 时，全部本地功能仍可正常使用。

PowerShell：

```powershell
$env:OPENAI_API_KEY="你的 API key"
$env:OPENAI_MODEL="gpt-5.4"
node server.js
```

代理实现位于 `server.js`：

- 浏览器只请求同源 `/api/agent`
- API key 只从服务端 `OPENAI_API_KEY` 环境变量读取
- 使用 OpenAI Responses API `POST /v1/responses`
- 请求设置 `store: false`
- 限制请求体为 32 KiB
- 每个来源地址每分钟最多 20 次请求
- 45 秒上游超时
- 不记录提示词、情绪数据或 API key
- AI API 请求不会被 Service Worker 缓存

不要把 API key 写入 `public/`、IndexedDB、备份 JSON 或提交到版本控制。

参考：[OpenAI Responses API](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create)

## IndexedDB

- 数据库名：`life-workbench`
- 对象仓库：`app`
- 主状态记录：`state-v2`
- 代码：`public/js/db.js` 与 `public/js/store.js`

首次加载新架构时，如果 IndexedDB 尚无数据，应用会读取旧版 `localStorage` 的 `life-workbench-v1`，兼容 Zustand persist 的 `{ state, version }` 格式，并迁移到 IndexedDB。旧数据只用于这次兼容迁移；后续写入全部走 IndexedDB。

设置页支持：

- 导出完整 JSON 备份
- 从 JSON 导入 IndexedDB
- 恢复示例数据

清除浏览器站点数据会删除 IndexedDB 与离线缓存，建议定期导出备份。

## Service Worker

`public/sw.js` 使用原生 Cache Storage API：

- 安装时预缓存 HTML、CSS、IIFE 脚本、manifest 和 PWA 图标
- 页面导航采用 network-first，离线时回退到缓存的 `index.html`
- 同源静态资源采用 cache-first，并在后台更新
- `/api/*` 始终走网络，绝不缓存 AI 响应
- 激活新版本时删除旧的 `life-workbench-*` 缓存

首次访问需要在线完成一次 Service Worker 安装，之后核心工作台可离线打开。

## 页面和功能

- **Today**：状态快选、高焦虑时隐藏长期压力信息、下一动作、最低线、丑陋完成、启动急救
- **Tasks**：Task 与 Next Action 分离、新增/编辑/完成/删除、启动与认知负荷
- **Focus**：10/25/45/自定义计时、暂停、走神捕获、Session 保存、Done Enough
- **Morning**：容貌/学业/健康焦虑的不同缓冲流程，不做诊断或外貌评分
- **Review**：10 秒睡觉版、生存版、标准版；明天第一动作影响第二天推荐
- **Toilet Mode**：每日固定 6 张有限内容卡，不允许无限刷新
- **Insights**：30 天专注、各科投入与摩擦地图，不合成效率总分
- **Knowledge Drops**：保存知识问题与解释
- **大脑 Bug 修复脚本**：新增、编辑、删除自定义 If–Then 规则
- **Settings**：考试日期、最低线、主题、IndexedDB 备份、离线更新
- **AI 行动拆解**：只发送用户主动提交的文本，服务端代理保护密钥

## 目录结构

```text
life-workbench/
├── package.json          # 零依赖脚本
├── server.js             # Node 内置模块服务器 + AI 代理
├── .env.example
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── sw.js
│   ├── manifest.webmanifest
│   ├── js/
│   │   ├── domain.js     # 纯函数与推荐算法 IIFE
│   │   ├── db.js         # IndexedDB IIFE
│   │   ├── store.js      # 状态与业务操作 IIFE
│   │   └── app.js        # 原生渲染和事件委托 IIFE
│   └── PWA 图标
└── test/
    ├── domain.test.js
    └── server.test.js
```

## 验证

语法检查：

```bash
npm run check
```

零依赖测试：

```bash
npm test
```

测试覆盖任务推荐、复盘动作优先级、HTML 转义、服务器路径隔离、Responses API 文本提取、静态首页与健康检查。

## HTTP 端点

- `GET /`：工作台
- `GET /api/health`：服务器和 AI 配置状态，不泄露 API key
- `POST /api/agent`：AI 行动拆解代理

## 隐私与安全边界

- 本地记录默认只保存在 IndexedDB
- 服务端不接收整个数据库，只接收用户在 AI 弹窗中主动提交的文字
- CSP 禁止第三方脚本、内联脚本、iframe、摄像头、麦克风和定位
- 静态服务器阻止目录穿越
- 工作台不是医疗产品，不诊断 ADHD、焦虑、BDD 或疾病，不提供药物或补剂剂量建议

如果未来增加云同步，应默认排除情绪与焦虑记录，并提供清晰的删除、导出和同步开关。

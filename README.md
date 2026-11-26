# MeetingCopilot Integrated Next (V3.2)

面向 Windows 10/11 的 **BYOK（自带 API Key）实时面试与笔试辅助工作台**。基于 MeetingCopilot `0.2.0-beta.1` Electron 运行时构建，完整重构了模块化 React 前端、浮窗底层交互、笔试专用浮窗、五层本地知识库检索与双轨录音复盘闭环。

> **架构与历史版本说明**  
> 本仓库 `main` 分支自 V2/V3 起已全面升级为 **模块化 React 前端 + 便携基线打包（`build_portable_next.py`）** 架构。  
> 早期 V1 阶段的 25 个增量热补丁脚本（`install_*.py`、`patches/` 与旧版 DOM 注入前端）已完整归档并单版备份于分支 [`archive/v1-legacy`](../../tree/archive/v1-legacy) 与标签 [`v2026.11.18`](../../tree/v2026.11.18)，`main` 分支不再保留冗余的历史补丁脚本。

---

## 核心特性（V3.2）

### 1. 双场景实时浮窗与五项底层窗口控制
面试工作台（`WorkbenchView`）与笔试浮窗（`WrittenCompactView`）共用一套经过 Windows 实机打磨的底层窗口控制能力（`meeting-copilot/tools/workbench-window.cjs`）：
- **悬停显隐（Hover Reveal）**：鼠标移出窗口自动淡隐并穿透，碰回立刻显现。
- **自动收起标题栏**：阅读时自动收起顶栏/底栏，最大化内容面积。
- **局部智能鼠标穿透**：主进程 80ms 光标轮询 + 渲染层命中测试，正文区域可穿透点击后方网页/IDE，顶栏与按钮仍可点击。
- **不抢焦点 + 自动重登顶**：基于 `setFocusable(false)` + 临时安全输入（`requestTempFocus`）与 `screen-saver` 置顶保活，支持全指针 JS 拖拽（无 `-webkit-app-region` 焦点冲突）。
- **防截屏与隐私保护**：支持系统防截屏（`SetWindowDisplayAffinity`）、安全模式虚拟 SVG 光标，以及全局自定义白底圆角 Tooltip（自动接管所有原生 `title`，杜绝系统黑框 Tooltip 在防截屏模式下泄漏）。

### 2. 面试助手（实时双栏工作台 + 双轨录音）
- **极简首配与全自定义模型/转录适配**：新用户仅配好文本大模型即可立即开始提问；文本与多模态视觉模型支持纯自定义 Base URL + 动态拉取 `/models` + 可选思考等级；语音转写支持 **6 大流式 WebSocket 协议族**（阿里云百炼 DashScope、火山豆包 SAUC v3、OpenAI Realtime / 阿里 Qwen3-ASR 实时、Deepgram Live、腾讯云实时 ASR v2、科大讯飞 RTASR，各协议独立加密保存密钥）与 **2 大分段 HTTP 协议族**（标准 `/audio/transcriptions` 兼容硅基流动 / 智谱 / Groq / OpenAI / 本地 Whisper 服务，及兼容 `chat/completions input_audio`），均支持内置样本音频端到端「试转写」。
- **双栏实时工作台**：左栏实时语音转写与问题卡片（支持拖拽/合并/回看历史题不串答），右栏流式作答 + 编程偏好（常规 / Coding、语言、ACM / 核心代码、精简 / 全面）。
- **双轨本地 WAV 录音**：内置 `audio-recorder.cjs`，会中可手动一键录制 16kHz PCM 双轨音频至独立录音目录，不阻塞问答主链路。
- **三栏辅助抽屉**：会中可随时展开「知识库原文 / 滚动备忘 / 检索证据来源 / 导出整理」。

### 3. 笔试助手（笔试专用浮窗 + 极简选项条）
- **极速识题模式**：支持静默全屏（默认 `Ctrl+Shift+S`）与无蒙层四边细框区域截图（默认低冲突 `Ctrl+Alt+A`，支持鼠标侧键 `Mouse4`/`Mouse5`），多视觉模型并行交叉验证并展示耗时，选择题自动提纯大字号，代码块自带独立「复制代码」按钮。
- **对话追问模式**：由首选视觉模型承接多轮追问，自动保留原题截图与上下文，支持输入框 `Ctrl+V` 贴图与内联多图队列（最多 12 张连拍暂存）。
- **一键极简选项条（`280×188`）**：超窄浮窗只展示模型编号与大字号答案，随时展开回标准浮窗。
- **通透视觉与悬浮胶囊底栏**：内层卡片、输入框与代码块联动 `--mc-bg-alpha` 实现可透视背景，底栏采用悬浮圆角胶囊样式，顶栏集成眼神矫正快捷开关。

### 4. 五层本地知识库 V2、记忆复盘与可选向量 RAG
- **五层分层检索架构（`meeting-copilot/v2/`）**：严格区分「个人设定与项目事实 / 岗位档案与真题 / 预测题 / 通用技术参考 / 历史归档」，强制事实护栏与来源校验，避免通用八股混入本人项目经历。
- **在线知识库工作台与 Diff 编辑器**：应用内直接浏览、编辑、对比并保存 Markdown 资料，可视化维护人物设定（Persona）。
- **记忆与记录闭环（`memory-store.cjs`）**：统一管理历史面试/笔试记录、原版与纠错版转录、Agent 复盘归档，支持快照版本 Diff 与一键回滚。
- **可选本地向量检索（`meeting-copilot/rag/`）**：基于 Qdrant 稠密 + 稀疏混合检索、Rerank 与问题改写，服务不可用时自动降级回本地关键词检索。

### 5. 自有 NVIDIA Maxine 眼神矫正
- 内置自有 C# 引擎源码（`meeting-copilot/maxine-eye-contact/`）、Softcam 虚拟摄像头组件与官方 7-Zip 解包器（`meeting-copilot/maxine-tools/`）。
- 轻量便携包默认不内置 1.3GB SDK；首次开启时自动识别本机 NVIDIA 显卡架构，通过 `maxine-sdk.cjs` 下载、校验并缓存至便携版 `data/maxine-sdk`。

---

## 仓库目录结构

```text
meetingcopilot-integrated/
├── bin/
│   └── QuietCapture.exe              # Windows 静默全屏 / 无蒙层框选 / 鼠标侧键原生辅助程序
├── src/
│   └── QuietCapture.cs               # QuietCapture .NET Framework C# 源码
├── build.cmd                         # 使用系统 csc.exe 编译 QuietCapture.exe
├── licenses/                         # 上游 MeetingCopilot 许可证
├── meeting-copilot/
│   ├── ui/                           # V3.2 模块化 React 前端（esbuild 构建至 ui/dist/）
│   │   ├── src/
│   │   │   ├── components/           # AppShell / HomeView / WorkbenchView / WrittenCompactView /
│   │   │   │                         # KnowledgeView / RecordsView / SettingsView / GearPopover / ...
│   │   │   ├── core/                 # sessionModel / globalTooltip / clickThroughHitTest / codingPrefs / ...
│   │   │   └── styles/app.css        # 浅色/深色双主题与浮窗透明视觉样式
│   │   ├── build.mjs
│   │   └── package.json
│   ├── tools/                        # V3.2 Electron 主进程控制器模块
│   │   ├── asr-adapters.cjs          # 6 大流式 WS + 2 大分段 HTTP 语音转写协议适配器与试转写
│   │   ├── model-reasoning.cjs       # 通用思考等级参数路由（reasoning_effort / enable_thinking）
│   │   ├── workbench-window.cjs      # 首页 / 面试工作台 / 笔试浮窗 / 极简条窗口状态机
│   │   ├── workbench-prefs.cjs       # 窗口几何、透明度、编程偏好与笔试配置持久化
│   │   ├── audio-recorder.cjs        # 双轨 16kHz PCM WAV 录音器
│   │   ├── kb-workspace.cjs          # 五层知识库文件读写与目录治理
│   │   ├── memory-store.cjs          # 会话记录、快照 Diff/回滚与复盘归档
│   │   └── templates-store.cjs       # 面试场景模板存储
│   ├── v2/                           # 五层知识库 V2 检索、证据校验、意图路由与向量客户端
│   ├── rag/                          # 可选本地 Python 混合向量检索服务（Qdrant + Rerank）
│   ├── prompts/                      # 笔试 / 面试 / 自动场景默认多模态提示词模板
│   ├── maxine-eye-contact/           # 自有 NVIDIA Maxine 眼神矫正 C# 引擎与虚拟摄像头脚本
│   ├── maxine-tools/                 # 官方 7-Zip 解包工具及许可
│   ├── release/                      # 便携版构建流水线
│   │   ├── build_portable_next.py    # V3.2 便携包主构建脚本（生成隔离目录 + ZIP + SHA-256 清单）
│   │   ├── patch_baseline.py         # 只读基线 ASAR 主进程 / Preload 安全补丁器
│   │   ├── asar_util.py              # 纯 Python ASAR 读写与块级 SHA-256 校验工具
│   │   ├── build_portable.py         # 通用便携配置、启动脚本与校验辅助模块
│   │   ├── portable-bootstrap.cjs    # 便携版独立 data/ 与空白配置初始化引导
│   │   ├── configure-rag.cjs         # 交互式向量检索配置脚本
│   │   └── 配置指南.txt              # 面向终端用户的空白配置指南
│   ├── multimodal-router.cjs         # 多模态视觉路由（顺序回退 / 并行作答 / 多轮视觉历史）
│   ├── quiet-capture.cjs             # 截图调度与低冲突快捷键配置（默认框选 Ctrl+Alt+A）
│   ├── shortcut-runtime.cjs          # 全局组合键与鼠标侧键运行时录制/派发
│   ├── window-controls.cjs           # 窗口缩放、移动与热键回滚控制
│   ├── written-window.cjs            # 紧凑笔试窗口基础控制器
│   ├── interview-export.cjs          # 面试问答与转写导出格式化
│   ├── interview-prompt.cjs          # 面试文本 Prompt 热读取存储
│   ├── eye-contact.cjs               # 眼神矫正进程管理与状态机
│   └── maxine-sdk.cjs                # NVIDIA AR SDK 按 GPU 架构自动下载与校验器
└── tests/                            # Node + Python 自动化测试套件
```

---

## 开发、测试与打包

### 环境要求
- Windows 10/11 x64
- Node.js 22+（用于前端构建与 `node --test`）
- Python 3.11+（用于便携打包、ASAR 校验与可选向量检索服务）
- （可选）Windows 内置 `.NET Framework 4.x` `csc.exe`（仅重新编译 `bin/QuietCapture.exe` 时需要）

### 1. 构建前端
```powershell
npm --prefix meeting-copilot/ui install
npm --prefix meeting-copilot/ui run build
```
构建产物输出至 `meeting-copilot/ui/dist/`（`index-hyFYaQxP.js` 与 `index-BJg-OUFD.css`）。

### 2. 运行自动化测试
```powershell
# Node 单元与契约测试（核心路由、知识库五层检索、浮窗控制器、V3.1/V3.2 回归等）
node --test tests/*.test.cjs

# Python 测试（ASAR 完整性、QuietCapture 无控制台校验、眼神矫正轻量发布打包）
python -m unittest discover -s tests -v
```

### 3. 构建隔离便携发布包（V3.2 Next）
将验证过的只读基线便携目录置于本地 `releases/MeetingCopilot/`（已被 `.gitignore` 忽略，不随源码入库），然后执行：

```powershell
# 首次输出或每日原地覆盖最新交付包（--overwrite 严禁覆盖只读基线 releases/MeetingCopilot）
python meeting-copilot/release/build_portable_next.py --output releases/MeetingCopilot-V3.2 --overwrite
```

构建完成后，双击 `releases/MeetingCopilot-V3.2/启动.cmd` 或仓库根目录 `启动MeetingCopilot.cmd` 即可启动最新版。更多功能说明与测试清单见 [`MeetingCopilot-V3.2功能清单与测试指南.md`](MeetingCopilot-V3.2功能清单与测试指南.md)。

构建脚本会：
1. 校验只读基线 `app.asar` 的 SHA-256，绝不修改 `releases/MeetingCopilot/`；
2. 同步仓库最新的 `tools/`、`v2/`、`multimodal-router.cjs`、`QuietCapture.exe` 与编译好的 React 前端包；
3. 生成完全空白的 `config/`、空 `data/` 目录、`启动.cmd` 与 `release-manifest.json`；
4. 执行语法检查、ASAR 回读校验与个人路径防泄漏扫描，并输出同名 `.zip` 便携压缩包。

### 4. 重新编译原生静默截图助手（可选）
```powershell
.\build.cmd
.\bin\QuietCapture.exe --self-test "$env:TEMP\quiet-capture-check.png"
```

---

## 安全与隐私说明

- **完全本地化与空白默认**：仓库与发布包均不包含任何个人简历、面试记录、API Key 或本机路径；首次运行所有模型、语音与资料库开关默认关闭。
- **密钥加密存储**：所有云端 API Key 通过 Electron `safeStorage`（Windows DPAPI）加密保存，与当前 Windows 用户及设备绑定。
- **共享前请注意**：如需分享便携包，请使用构建生成的空白 `.zip`，切勿包含已运行产生的 `data/` 目录。

---

## 来源与许可

- 本项目基于开源项目 [MeetingCopilot](https://github.com/qiao94/Interview-and-Written-Test-Assistant) `0.2.0-beta.1` 进行二次开发与整合，保留原始许可证于 [`licenses/MeetingCopilot-LICENSE.txt`](licenses/MeetingCopilot-LICENSE.txt)。
- 本仓库非 MeetingCopilot 官方发行版；NVIDIA Maxine AR SDK 及 7-Zip 工具遵循其各自官方许可条款。
- V1 增量补丁历史版本备份见 [`archive/v1-legacy`](../../tree/archive/v1-legacy)（对应标签 `v2026.11.18`）。

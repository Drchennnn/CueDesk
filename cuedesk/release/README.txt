CueDesk 面试台 v1.0.0 (2026-11-26)

完整解压到可写目录后，双击「CueDesk.exe」（或「启动.cmd」）即可启动。
运行环境面向 Windows 10/11 x64，已内置 Electron 运行时与独立 data 目录。

核心功能
- 首页与双场景入口：面试助手（会前自检 + 实时双栏工作台）与笔试助手（笔试前准备 + 笔试专用浮窗 / 极简选项条）。
- 面试实时工作台：6 大流式 WebSocket + 2 大分段 HTTP 语音转写协议、低延迟断句与外放回声过滤、手打提问、RAG 五层资料检索与引用来源、双轨 16kHz WAV 本地录制、第三方辅助面板（资料 / 笔记 / 证据 / 导出）。
- 笔试浮窗与极简选项条：极速识题（多视觉模型并行对比 + 选择题大字号提纯 + 代码块独立一键复制）与对话追问（首选视觉模型保留原题截图的多轮承接），支持内联多图暂存与 Ctrl+V 贴图。
- 五项底层浮窗控制：悬停显隐（移出淡隐穿透）、自动收起标题栏、80ms 局部智能鼠标穿透、不抢焦点与自动重登顶、防截屏安全模式 + 虚拟光标 + 全局自定义隐私 Tooltip。
- 静默截屏与无蒙层框选：默认全屏 Ctrl+Shift+S、低冲突框选 Ctrl+Alt+A，支持鼠标侧键 Mouse4/Mouse5 录制与一键解决冲突。
- 本地知识库 V2 与记忆复盘：五层资料库在线浏览与 Diff 编辑、人物设定表单、历史会话与复盘归档闭环、可选 Qdrant 混合向量检索服务。
- NVIDIA Maxine 眼神矫正：轻量发布按显卡自动下载 NVIDIA AR SDK 缓存至 data/maxine-sdk，内置 Softcam 虚拟摄像头。

包内结构
- app/                            整合应用、Electron 运行时及 tools/ 模块
- app/resources/eye-contact/      EyeContactEngine.exe 与虚拟摄像头组件
- config/                         空白默认配置模板（所有密钥与个人路径从空白开始）
- data/                           便携版独立数据目录（配置、会话、录音、本地索引）
- rag/                            可选本地向量检索服务与依赖清单
- release-manifest.json           文件 SHA-256 校验清单

安全与隐私
- 所有 API Key 均通过 Windows DPAPI (Electron safeStorage) 加密保存，换设备需重新填写。
- 如需分享给他人，请始终重新使用原始空白 ZIP，不要直接打包包含 data/ 的目录。

上游版本：MeetingCopilot 0.2.0-beta.1（许可证见 LICENSE.MeetingCopilot.txt）。

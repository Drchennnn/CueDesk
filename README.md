# MeetingCopilot 整合版

Windows x64 便携版，以 MeetingCopilot 0.2.0-beta.1 为基础，集成实时转录、文本与截图问答、面试资料库、会话导出、窗口控制和 NVIDIA Maxine 眼神矫正。

## 下载与启动

从 [GitHub Releases](https://github.com/Drchennnn/meetingcopilot-integrated/releases/latest) 下载 `MeetingCopilot.zip`，完整解压后运行 `启动.cmd`。使用自己的 API 和资料目录完成配置，具体步骤见 [配置指南](meeting-copilot/release/配置指南.txt)。升级时先备份旧版数据，再迁移同一台电脑、同一 Windows 用户下的配置与会话。若 API Key 无法读取，可在新版界面重新填写。

首次开启眼神矫正时，程序会为受支持的 NVIDIA 显卡下载约 1.3 GB 的对应运行时，校验、解包并缓存到便携版的 `data/maxine-sdk`。在会议软件中选择 `DirectShow Softcam`。自动下载和预览已有 RTX 3060 Laptop（SM86）和 RTX 4060 Laptop（SM89）的实测记录。

`EyeContact.zip` 提供独立眼神模块、源码和接入 Prompt。独立模块首次下载运行时使用 Node.js 22+，完整整合包使用自带的 Electron。

## 源码与构建

- `meeting-copilot/` 包含整合模块、补丁和打包脚本。
- `meeting-copilot/maxine-eye-contact/` 包含摄像头采集、SDK 调用、虚拟摄像头输出和引擎构建脚本。
- `meeting-copilot/maxine-sdk.cjs` 管理 GPU 探测、SDK 下载、校验和解包。
- `src/` 包含原生截图与快捷键辅助程序，`tests/` 包含回归测试。

完整便携包构建以已整合的 Windows 安装目录为输入。用 Python 运行 `meeting-copilot/release/build_portable.py --source <已整合的安装目录> --output <新输出目录>`，构建使用 Node.js 检查 JavaScript。`--eye-contact-resources` 可指定引擎资源目录，`--include-sdk` 用于需要预置 SDK 的离线构建。

```powershell
node --test tests/*.test.cjs meeting-copilot/eye-contact*.test.cjs
python -m unittest discover -s tests -v
```

上游许可证见 [MeetingCopilot-LICENSE.txt](licenses/MeetingCopilot-LICENSE.txt)。Softcam、NVIDIA 头文件和 7-Zip 的许可保存在对应组件目录。

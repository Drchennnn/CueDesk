MeetingCopilot 眼神矫正独立模块
2026-11-17

用途
此包提取现有眼神矫正的控制器、设备设置、视频预览和诊断逻辑，适合接入 Windows Electron + React 项目。
主进程使用 Node.js 内置模块，前端使用宿主提供的 React 及 JSX runtime。
安装配置任务可以直接将本包和“安装与接入Prompt.txt”交给 AI 执行。

功能
引擎开启、关闭、重启和退出清理。
真实输入摄像头选择，眼神矫正与原画直通切换。
空闲释放、3 秒宽限及运行故障恢复一次。
随机移开视线、眼部融合区域与时间平滑参数。
虚拟摄像头预览、首帧检查、超时清理和迟到视频流释放。
状态通知、近期事件、处理帧率、推理耗时和复制诊断。

运行资源
控制器对接 Tinks/suisi 眼神引擎和 NVIDIA AR SDK。
使用电脑上需要准备以下资源。
1. 引擎目录，包含 suisi-eye-contact.exe、softcam.dll，以及该引擎配套依赖。
2. SDK 目录，包含 nvARPose.dll、models 及该显卡对应的完整资源。
3. 支持的 NVIDIA 显卡、相容驱动和可用的真实摄像头。

本 ZIP 提供控制层、前端和接入代码。推理引擎、虚拟摄像头 DLL 和 GPU 模型资源需在使用电脑上另外准备。
配置中的引擎路径、SDK 路径、设备 ID 和设备名初始为空。
开启运行后由本机引擎处理摄像头画面。这个模块的配置项为本地文件路径及设备参数。

文件
eye-contact.cjs               核心控制器及 Windows 平台适配。
electron-main.cjs             可复用 Electron IPC 注册与退出清理。
preload.cjs                   提供给渲染页面的受限桥接 API。
renderer.mjs                  可直接由宿主前端构建工具导入的 React 组件。
eye-contact-ui.js             原始顶部开关组件。
eye-contact-settings-ui.js    原始设备与参数设置组件。
eye-contact-preview.js        原始视频预览生命周期代码。
styles.css                    可选样式，作用于 eye-contact-module 容器。
config/runtime.json           空白引擎和 SDK 路径配置。
config/settings.example.json  空白设备选择及默认参数示例。
*.test.cjs                    核心、预览、前端及桥接回归测试。
安装与接入Prompt.txt          可复制给 AI 的端到端安装接入任务。
验证结果.json                 本次打包的检查范围。
manifest.json                 文件 SHA-256 校验清单。

主进程接入
在 app.whenReady() 之后，创建主窗口并取得它的引用，然后初始化模块。

const path = require('node:path');
const {app, ipcMain} = require('electron');
const {registerEyeContact} = require('./eye-contact-module/electron-main.cjs');

const eyeContact = registerEyeContact({
  app,
  ipcMain,
  getWindow: () => mainWindow,
  configFile: path.join(moduleDirectory, 'config', 'runtime.json'),
  dataDirectory: path.join(app.getPath('userData'), 'eye-contact')
});

mainWindow 与 moduleDirectory 按宿主项目的真实变量和安装位置替换。
默认会在 before-quit 时清理。宿主提前卸载模块时调用 eyeContact.dispose()。
同一套 eye-contact IPC 通道由一个实例注册。
对于已安装眼神矫正的 MeetingCopilot，复用已有控制器与桥接位置即可。

preload 接入
将下面的辅助函数合并到宿主现有 preload 构建中。
若宿主已暴露 window.mc，将这些方法合并到同一次 exposeInMainWorld 调用。

const {contextBridge, ipcRenderer} = require('electron');
const {createEyeContactBridge} = require('./eye-contact-module/preload.cjs');

contextBridge.exposeInMainWorld('mc', {
  ...existingBridge,
  ...createEyeContactBridge(ipcRenderer)
});

existingBridge 表示宿主已有的桥接对象，新宿主可以使用空对象。
sandbox preload 使用宿主现有构建工具，将这个本地辅助模块打包进 preload 产物。
IPC 会核对指定窗口和主 frame，摄像头权限沿用宿主的权限管理。

React 前端接入
import {EyeContactToggle, EyeContactSettings} from './eye-contact-module/renderer.mjs';
import './eye-contact-module/styles.css';

<div className="eye-contact-module">
  <EyeContactToggle />
  <EyeContactSettings active={cameraTabIsActive} />
</div>

cameraTabIsActive 根据宿主设置页的实际状态传入。
离开页面时卸载设置组件，或把 active 改为 false，组件会停止本地预览。
状态 API、设备列表和预览媒体权限在 Electron 的本地受信页面中使用。

配置路径
编辑 config/runtime.json 中的 eyeEngineDirectory 和 eyeSdkDirectory。
路径建议使用正斜杠。相对路径以 runtime.json 所在目录为基准。
留空时会检查 MC_EYE_ENGINE_DIR、MC_EYE_SDK_DIR，以及当前用户的 Tinks 安装与 suisi SDK 缓存。
自动查找的位置是当前用户目录/Tinks/resources/eye-contact 和 %APPDATA%/suisi/Cache/NVIDIA AR SDK。
路径修改后重新初始化模块或重启宿主。

设备参数由设置页自动保存到 dataDirectory/eye-contact-settings.json。
日志位于 dataDirectory/eye-contact.log，约 256 KiB 后轮换。
config/settings.example.json 是参数参考，宿主初始化时由控制器生成实际设置。

检查
在安装了 Node.js 的终端进入本包目录，执行 npm test。
测试使用模拟进程和媒体设备，覆盖引擎生命周期、空闲释放、预览与 IPC。
真实摄像头、显卡推理与会议软件取流按 Prompt 中的步骤验收。

来源
从本工作区 MeetingCopilot 的现有眼神矫正实现提取。
独立包补充了 Electron 接入、preload 桥接、React 导出及显式资源路径支持。
许可证副本见 LICENSE.txt。外部引擎和 SDK 按其各自许可安装使用。

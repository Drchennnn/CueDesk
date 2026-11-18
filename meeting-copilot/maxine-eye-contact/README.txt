MeetingCopilot Maxine 眼神矫正模块

项目内的 EyeContactEngine 源码负责摄像头采集、SDK 参数与逐帧推理、输出虚拟摄像头以及进程控制协议。
NVIDIA AR SDK 的 GazeRedirection 特性负责眼神矫正模型推理，Softcam 提供 DirectShow 虚拟摄像头。

处理流程
MeetingCopilot 摄像头开关 → eye-contact.cjs → EyeContactEngine → NvAR / NvCVImage → Softcam → 会议软件。

独立使用
1. 解压模块包，保留 runtime 目录结构。默认轻量包包含自有引擎、Softcam、SDK 管理器及官方 7-Zip 工具。
2. 独立轻量模块首次下载 SDK 使用 Node.js 22 或更新版本，可从 https://nodejs.org/ 获取。
3. 双击启动.cmd，脚本自动检测显卡并调用 SDK 管理器下载、校验、解包匹配的资源。首次下载约 1.3GB。
   SDK 缓存位于 %LOCALAPPDATA%/MeetingCopilot-Maxine/maxine-sdk，后续启动复用已安装的缓存。
   出错后检查终端提示和网络，重新启动可重试。
   config.json 中路径与设备名为空时，采用自动管理的 SDK 和自动选取的真实摄像头。
   终端接收 mode correct、mode passthrough、mode idle、stop 命令。
4. 会议软件选择 DirectShow Softcam。首次使用可运行 .\register-softcam-user.ps1，在当前用户下注册包内DLL。
   脚本输出注册恢复记录的位置，恢复时运行 .\register-softcam-user.ps1 -Restore "receipt.json完整路径"。
   也可在管理员终端运行 regsvr32.exe "完整路径\runtime\engine\softcam.dll"，完成全系统注册。

MeetingCopilot 集成
安装目录 resources\eye-contact\engine 放置 EyeContactEngine.exe 与 softcam.dll。
resources\tools\maxine-sdk.cjs 管理 SDK 下载、校验与解包，资源清单内置于代码。
resources\tools\maxine 放置官方 7z.exe、7z.dll 与 License.txt。
SDK 下载到宿主 userData/maxine-sdk。整合版使用自带 Electron 运行管理器，首次开启眼神矫正即可完成资源准备。
resources\tools\eye-contact.cjs 连接自有引擎与现有摄像头设置页 IPC。
启动时工作目录为 SDK，传入 --sdk-dir .，支持包含中文的安装路径。
MC_EYE_ENGINE_DIR 和 MC_EYE_SDK_DIR 可显式覆盖资源位置。
控制层通过HKCR合并视图检查虚拟摄像头，支持当前用户注册。

编译
在 Windows PowerShell 运行 source\build.ps1，使用系统 .NET Framework x64 编译器。
项目源码目录则直接运行 build.ps1，产物为 bin\EyeContactEngine.exe。
运行仍需 NVIDIA SDK 的 DLL、GPU 对应模型、NVIDIA 显卡驱动及 VC++ x64 运行库。

SDK 管理器按实际显卡架构选择资源包。自有引擎使用 NVIDIA AR SDK 0.8.7.0 的调用接口。
实机验收设备为 RTX 3060 Laptop GPU，使用 SM86 模型。
自定义已有 SDK 可通过 config.json 的 sdkDirectory 或 MC_EYE_SDK_DIR 环境变量指定。
独立包在找到有效的显式 SDK 或包内 runtime/sdk 时可直接启动引擎。
本地 SDK 推理通过 DLL 调用，配置项中无需填写云端 API 密钥。

构建发布包
默认轻量构建使用以下命令，运行资源中的 SDK 由首次启动下载。
python build_package.py --softcam <softcam.dll完整路径> --output <新的输出目录>

离线构建可显式封入 SDK。
python build_package.py --softcam <softcam.dll完整路径> --sdk-dir <SDK目录> --include-sdk --output <新的输出目录>

独立包的 runtime/tools/maxine-sdk.cjs 可直接由 Node 运行。
node runtime/tools/maxine-sdk.cjs --directory <SDK缓存目录> --extractor runtime/tools/maxine/7z.exe
添加 --probe 可以只探测显卡，添加 --sdk-directory <已有SDK目录> 可以使用预先准备的 SDK。

官方资料
NVIDIA AR SDK 开发资料 https://developer.nvidia.com/maxine
NVIDIA AR SDK 编程指南 https://docs.nvidia.com/deeplearning/maxine/ar-sdk-programming-guide/index.html
Gaze Redirection 示例 https://github.com/NVIDIA-Maxine/Maxine-AR-SDK/tree/main/samples/GazeRedirect
Softcam 源码与许可 https://github.com/tshino/softcam

SDK 下载包中的许可与第三方许可随解包资源保留。离线包将其保存在 runtime/sdk 中。
7-Zip 许可位于 runtime/tools/maxine/License.txt。
真实摄像头对照图片属于本机验收资料，发布包包含源码和运行依赖。

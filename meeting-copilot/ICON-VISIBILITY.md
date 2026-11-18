# 运行时图标隐藏补丁

2026-10-31，已安装到当前用户的 `AppData/Local/Programs/meeting-copilot`，版本 0.2.0-beta.1。

## 修改

- Windows 上 AppTray.create 在创建 Electron Tray 前返回 false，因此不注册托盘图标，也不会弹出该托盘的提示气泡。
- 引导窗口 skipTaskbar 改为 true。
- 主窗口显示时重新设置 skipTaskbar；小窗每次调用 setFocusable 后重新设置 skipTaskbar。
- 快捷键仍为 Ctrl+B；重新运行 MeetingCopilot.exe 会呼出现有窗口。Alt+F4 正常退出已验证。

## 验证和边界

- node --check、ASAR 修改后读回验证通过。
- node --test tests/written-window.test.cjs：11 项通过。
- 已正常退出并重启；任务栏截图未见 MeetingCopilot 图标。
- Ctrl+B 后 IsWindowVisible=false；再次启动后同一窗口恢复显示，任务栏仍无图标。
- 托盘依据代码路径已禁用；未展开托盘溢出面板作视觉验证。未进行远端会议屏幕共享测试。此补丁不保证任意会议软件或未来版本的行为。
- 程序升级可能覆盖补丁；程序进程仍正常存在。

## REA 证据

原 ASAR SHA256：

`49dba9852f0f0448760ac419b92454dbf0ce49a4c754c649c4c246e161afe1b2`

分析主程序与 package.json 的父证据：`ev_9950c7ff381c9a6595e6a8e7632b58afb197c88f45325a1f3e487d301be9bea8`。这是选择文件的静态分析，其他 2636 个库存文件未分析，不代表全应用行为证明。

外置 written-window.cjs 分析摘要证据：`ev_bb6ac90df1fa618d50690931e1fce59123e9416658b09de49adb707e06e5b5e0`。

修改后 ASAR SHA256：`c546ccde5f7a3172ff1fa03b798e43da50066ad3898e13e76bf1263665418e5f`。

完整 REA 证据保存在工作区 `work/icon-visibility/rea-evidence.json`；任务栏截图为同目录 `taskbar-after.png`。

## 安装与恢复

退出程序后运行 `python meeting-copilot/install_icon_visibility.py`；`--check` 只检查兼容性。脚本对重复安装作检测，遇到代码不匹配会停止。

恢复时先退出程序，再用以下备份覆盖各自原文件：

- `resources/app.asar.before-hide-icons.bak` → `resources/app.asar`
- `resources/tools/written-window.cjs.before-hide-icons.bak` → `resources/tools/written-window.cjs`

备份包含本次操作之前的累计补丁；将来若安装了更新或其他补丁，不应直接覆盖回旧备份。

"""Exact-once anchor patches for the portable 0.2.0-beta.1 main and preload entries."""
from __future__ import annotations

BASELINE_ASAR_SHA256 = "fd6b8422c15ad9f26ee489b865306646247a71fc2c0e6bdf080962aac5477907"


def replace_once(text: str, before: str, after: str, label: str = "") -> str:
    count = text.count(before)
    if count != 1:
        hint = label or before[:100]
        raise ValueError(f"Expected anchor once (found {count}) at {hint}")
    return text.replace(before, after, 1)


MAIN_CODING_HELPER = r'''
const CODING_LANG_LABELS = {
  python: "Python",
  cpp: "C++",
  java: "Java",
  javascript: "JavaScript",
  typescript: "TypeScript",
  go: "Go",
  sql: "SQL",
  other: "最合适的编程语言"
};
function formatCodingDirective(codingPrefs) {
  if (!codingPrefs || codingPrefs.mode !== "coding") return "";
  const lang = CODING_LANG_LABELS[codingPrefs.language] || "Python";
  const parts = [
    `【编程作答偏好】请使用 ${lang} 编写代码。`
  ];
  if (codingPrefs.codeFormat === "acm") {
    parts.push("代码格式要求：完整 ACM 模式（包含必要头文件/导入、标准输入输出读取与打印、完整主函数）。");
  } else if (codingPrefs.codeFormat === "core") {
    parts.push("代码格式要求：核心代码模式（保留题目或签名中的函数/类结构，仅实现核心逻辑，不写多余 I/O 模板）。");
  } else {
    parts.push("代码格式要求：优先按题面或截图中的提交模板选择格式——有待实现函数/类签名时采用核心代码模式，明确要求标准输入输出时采用完整 ACM 程序；仅给出样例且无其他线索时默认完整可运行程序。");
  }
  if (codingPrefs.explainMode === "code-only") {
    parts.push("仅输出可直接运行的完整代码和极简关键注释，不要冗长文字说明。");
  } else if (codingPrefs.explainMode === "detailed") {
    parts.push("结论风格（全面）：先清晰讲解解题思路、算法选择与正确性说明，再给出完整代码和关键步骤说明。");
  } else {
    parts.push("结论风格（精简）：先用 1-2 句话讲清核心思路，再直接给出简洁、完整的代码。");
  }
  if (codingPrefs.includeComplexity !== false) {
    parts.push("最后简明给出时间复杂度和空间复杂度。");
  }
  if (codingPrefs.includeEdgeCases !== false) {
    parts.push("列出 2-3 个需要特别注意的边界条件或易错点。");
  }
  const extra = String(codingPrefs.extraInstruction || "").trim();
  if (extra) parts.push(`补充要求：${extra.slice(0, 500)}`);
  return parts.join("\n");
}
function appendCodingDirective(messages, codingPrefs, dialogueThinking = false, writtenFollowup = false) {
  const parts = [];
  const directive = formatCodingDirective(codingPrefs);
  if (directive) parts.push(directive);
  if (dialogueThinking) {
    parts.push("【对话思考模式】请结合前序多轮对话上下文做更深入、结构化的思考与拆解，指出关键权衡点与潜在追问方向。");
  }
  if (writtenFollowup) {
    parts.push("【笔试对话追问模式】请结合此前题图与历史解答上下文直接回应当前追问（如改写代码、排查样例报错、补充边界或解释推导），优先给出准确结论与可直接使用的完整代码。");
  }
  const combined = parts.join("\n\n");
  if (!combined || !Array.isArray(messages) || !messages.length) return messages;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  if (last && last.role === "user") {
    if (typeof last.content === "string") {
      messages[lastIdx] = { ...last, content: `${last.content}\n\n${combined}` };
    } else if (Array.isArray(last.content)) {
      messages[lastIdx] = { ...last, content: [...last.content, { type: "text", text: `\n\n${combined}` }] };
    }
    return messages;
  }
  messages.push({ role: "user", content: combined });
  return messages;
}
const TRANSLATE_TARGET_LABELS = {
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어"
};
function buildTargetTranslateMessages(text, targetLang) {
  const label = TRANSLATE_TARGET_LABELS[targetLang] || "简体中文";
  return [
    {
      role: "system",
      content: `你是专业技术面试翻译助手。请将用户提供的文本准确、自然地翻译为${label}，保留代码片段、专有名词与结构格式，不要添加多余解释。`
    },
    { role: "user", content: String(text || "") }
  ];
}
'''


def patch_main(raw: bytes) -> bytes:
    """Apply incremental main-process enhancements onto the verified portable baseline."""
    text = raw.decode("utf-8")

    # 1. Default blank theme to light (existing userData/settings.json is unaffected)
    text = replace_once(
        text,
        '    "theme": "dark",',
        '    "theme": "light",',
        "defaultSettings light theme",
    )

    # 1b. Expose llm.reasoningEffort in settings.getPublic() and inject reasoning_effort/thinking into chatStream
    text = replace_once(
        text,
        '''      llm: {
        baseUrl: d.llm.baseUrl,
        model: d.llm.model,
        answerLang: d.llm.answerLang,''',
        '''      llm: {
        baseUrl: d.llm.baseUrl,
        model: d.llm.model,
        reasoningEffort: d.llm.reasoningEffort || "default",
        answerLang: d.llm.answerLang,''',
        "settings.getPublic llm.reasoningEffort",
    )

    text = replace_once(
        text,
        '''async function chatStream(config, messages, callbacks, signal) {
  const url = `${config.baseUrl.replace(/\\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.5
    }),
    signal
  });''',
        '''async function chatStream(config, messages, callbacks, signal) {
  const url = `${config.baseUrl.replace(/\\/+$/, "")}/chat/completions`;
  const mr = require(path.join(process.resourcesPath, "tools", "model-reasoning.cjs"));
  const reasoningFields = mr.buildReasoningBodyFields(config.reasoningEffort, { baseUrl: config.baseUrl, model: config.model });
  const omitTemp = mr.shouldOmitTemperature(config.reasoningEffort, { baseUrl: config.baseUrl, model: config.model });
  const reqBody = {
    model: config.model,
    messages,
    stream: true,
    ...(omitTemp ? {} : { temperature: 0.5 }),
    ...reasoningFields
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(reqBody),
    signal
  });''',
        "chatStream reasoningEffort body injection",
    )

    text = replace_once(
        text,
        '''      const work = messages.skipGeneration || messages.directAnswer || (messages.blockedUnknown && !messages.suggestionOnly) ? Promise.resolve({ text: messages.directAnswer || messages.blockedUnknown || "" }) : chatStream(
        { baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, apiKey },''',
        '''      const work = messages.skipGeneration || messages.directAnswer || (messages.blockedUnknown && !messages.suggestionOnly) ? Promise.resolve({ text: messages.directAnswer || messages.blockedUnknown || "" }) : chatStream(
        { baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, reasoningEffort: settings.data.llm.reasoningEffort || "default", apiKey },''',
        "llm:ask pass reasoningEffort to chatStream",
    )

    # 2. SessionStore: add saveStrict that surfaces real disk write failures
    text = replace_once(
        text,
        '''  save(data) {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      console.error("[sessions] save failed:", e.message);
    }
  }''',
        '''  saveStrict(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
    fs.renameSync(tmp, this.filePath);
    return { ok: true, savedAt: Date.now() };
  }
  save(data) {
    try {
      this.saveStrict(data);
    } catch (e) {
      console.error("[sessions] save failed:", e.message);
    }
  }''',
        "SessionStore saveStrict",
    )

    # 3. Allow rect pass-through on captureQuietScreenshot + coding directive helper
    text = replace_once(
        text,
        'const captureQuietScreenshot = (mode = "full") => quietCaptureService.capture(mode);',
        'const captureQuietScreenshot = (mode = "full", rect = null) => quietCaptureService.capture(mode, rect);'
        + MAIN_CODING_HELPER,
        "captureQuietScreenshot rect + coding helper",
    )

    # 4. Declare new workbench controllers in bootstrap()
    text = replace_once(
        text,
        '  let eyeContact;\n',
        '  let eyeContact;\n  let templatesStore;\n  let workbenchPrefs;\n  let workbenchWindow;\n  let audioRecorder;\n',
        "bootstrap controller variables",
    )

    # 5. Respect workbenchWindow initialOptions & mode-managed alwaysOnTop / skipTaskbar in createWindow()
    text = replace_once(
        text,
        '''      ...writtenWindow.initialOptions(),
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      resizable: true,''',
        '''      ...writtenWindow.initialOptions(),
      ...(workbenchWindow ? workbenchWindow.initialOptions() : {}),
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: true,''',
        "createWindow initialOptions",
    )

    text = replace_once(
        text,
        '''    writtenWindow.attach(win);
    windowControls.attach(win);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setContentProtection(settings.data.ui.stealth);''',
        '''    writtenWindow.attach(win);
    windowControls.attach(win);
    workbenchWindow?.attach(win);
    if (writtenWindow.getPublic().enabled) win.setAlwaysOnTop(true, "screen-saver");
    win.setContentProtection(settings.data.ui.stealth);''',
        "createWindow attach workbenchWindow",
    )

    text = replace_once(
        text,
        '''    win.on("show", () => {
      win.setSkipTaskbar(true);
      console.log("[window] shown");
      refreshTray();
    });''',
        '''    win.on("show", () => {
      if (!workbenchWindow) win.setSkipTaskbar(true);
      console.log("[window] shown");
      refreshTray();
    });''',
        "win show taskbar delegation",
    )

    # 6. Add interview-library:pick-root and interview-library:read-doc IPCs
    text = replace_once(
        text,
        '    electron.ipcMain.handle("interview-library:get", event => { assertLibrarySender(event); return interviewLibrary.getPublic(); });',
        '''    electron.ipcMain.handle("interview-library:get", event => { assertLibrarySender(event); return interviewLibrary.getPublic(); });
    electron.ipcMain.handle("interview-library:pick-root", async (event) => {
      assertLibrarySender(event);
      const r = await electron.dialog.showOpenDialog(win ?? undefined, {
        title: "选择面试资料库文件夹",
        properties: ["openDirectory"]
      });
      if (r.canceled || !r.filePaths[0]) return null;
      return r.filePaths[0];
    });
    electron.ipcMain.handle("interview-library:read-doc", async (event, ref) => {
      assertLibrarySender(event);
      return interviewLibrary.readDocument(ref);
    });
    electron.ipcMain.handle("interview-library:open-doc", async (event, ref) => {
      assertLibrarySender(event);
      const doc = await interviewLibrary.readDocument(ref);
      const err = await electron.shell.openPath(doc.file);
      if (err) throw new Error(err);
      return { ok: true, title: doc.title };
    });
    electron.ipcMain.handle("interview-library:read-chunks", async (event, ref) => {
      assertLibrarySender(event);
      return interviewLibrary.readChunks(ref);
    });
    electron.ipcMain.handle("interview-library:rag-status", async (event) => {
      assertLibrarySender(event);
      return interviewLibrary.getRagStatus();
    });
    const { createKbWorkspace } = require(path.join(process.resourcesPath, "tools", "kb-workspace.cjs"));
    const kbWorkspace = createKbWorkspace({
      getRoot: () => interviewLibrary.root,
      trashItem: (p) => electron.shell.trashItem(p)
    });
    electron.ipcMain.handle("kb:write-doc", async (event, payload) => {
      assertLibrarySender(event);
      const res = kbWorkspace.writeDocument(payload);
      const lib = await interviewLibrary.getPublic();
      return { ...res, library: lib };
    });
    electron.ipcMain.handle("kb:trash-doc", async (event, payload) => {
      assertLibrarySender(event);
      const res = await kbWorkspace.trashDocument(payload);
      const lib = await interviewLibrary.getPublic();
      return { ...res, library: lib };
    });
    electron.ipcMain.handle("kb:create-role", async (event, payload) => {
      assertLibrarySender(event);
      const res = kbWorkspace.createRolePackage(payload);
      const lib = await interviewLibrary.getPublic();
      return { ...res, library: lib };
    });
    electron.ipcMain.handle("kb:update-role-status", async (event, payload) => {
      assertLibrarySender(event);
      const res = kbWorkspace.updateRoleStatus(payload);
      const lib = await interviewLibrary.getPublic();
      return { ...res, library: lib };
    });
    electron.ipcMain.handle("kb:import-files", async (event, payload) => {
      assertLibrarySender(event);
      const res = kbWorkspace.importFiles(payload);
      const lib = await interviewLibrary.getPublic();
      return { ...res, library: lib };
    });
    electron.ipcMain.handle("kb:pick-import-files", async (event) => {
      assertLibrarySender(event);
      const r = await electron.dialog.showOpenDialog(win ?? undefined, {
        title: "选择要导入到资料库的文件",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "文档与图片", extensions: ["md", "txt", "pdf", "png", "jpg", "jpeg", "webp"] }]
      });
      return r.canceled ? [] : r.filePaths;
    });
    electron.ipcMain.handle("kb:read-persona", (event) => {
      assertLibrarySender(event);
      return kbWorkspace.readPersona();
    });
    electron.ipcMain.handle("kb:save-persona", async (event, payload) => {
      assertLibrarySender(event);
      const res = kbWorkspace.savePersona(payload);
      const lib = await interviewLibrary.getPublic();
      return { ...res, library: lib };
    });
    electron.ipcMain.handle("kb:list-intro", (event) => {
      assertLibrarySender(event);
      return kbWorkspace.listIntroHeadings();
    });
    const { createMemoryStore } = require(path.join(process.resourcesPath, "tools", "memory-store.cjs"));
    const memoryStore = createMemoryStore({
      getRoot: () => interviewLibrary.root,
      snapshotDir: path.join(electron.app.getPath("userData"), "memory-snapshots")
    });
    electron.ipcMain.handle("memory:get", (event) => {
      assertLibrarySender(event);
      return memoryStore.getState();
    });
    electron.ipcMain.handle("memory:diff", (event, version) => {
      assertLibrarySender(event);
      return memoryStore.getSnapshotDiff(version);
    });
    electron.ipcMain.handle("memory:save-bucket", async (event, payload) => {
      assertLibrarySender(event);
      const state = memoryStore.saveBucket(payload);
      await interviewLibrary.getPublic().catch(() => {});
      return state;
    });
    electron.ipcMain.handle("memory:append-item", async (event, payload) => {
      assertLibrarySender(event);
      const state = memoryStore.appendItem(payload);
      await interviewLibrary.getPublic().catch(() => {});
      return state;
    });
    electron.ipcMain.handle("memory:resolve-pending", async (event, payload) => {
      assertLibrarySender(event);
      const state = memoryStore.resolvePendingFact(payload);
      await interviewLibrary.getPublic().catch(() => {});
      return state;
    });
    electron.ipcMain.handle("memory:rollback", async (event, version) => {
      assertLibrarySender(event);
      const state = memoryStore.rollbackSnapshot(version);
      await interviewLibrary.getPublic().catch(() => {});
      return state;
    });
    electron.ipcMain.handle("memory:open-dir", async (event) => {
      assertLibrarySender(event);
      const st = memoryStore.getState();
      const err = await electron.shell.openPath(st.memoryDir);
      if (err) throw new Error(err);
      return { ok: true, path: st.memoryDir };
    });
    electron.ipcMain.handle("memory:archive-session", async (event, payload) => {
      assertLibrarySender(event);
      const audioTakes = audioRecorder?.list(payload.session?.id)?.takes || [];
      const res = memoryStore.archiveSessionToRole({ ...payload, audioTakes });
      try {
        kbWorkspace.updateRoleStatus({
          directory: payload.roleDirectory || payload.session?.role,
          status: payload.nextStatus || "waiting",
          roundLabel: res.roundFolder
        });
      } catch {}
      await interviewLibrary.getPublic().catch(() => {});
      return res;
    });
    electron.ipcMain.handle("memory:open-path", async (event, targetPath) => {
      assertLibrarySender(event);
      const root = path.resolve(interviewLibrary.root || "");
      const target = path.resolve(String(targetPath || ""));
      if (!root || !target.toLowerCase().startsWith(root.toLowerCase())) throw new Error("路径超出资料库目录");
      const err = await electron.shell.openPath(target);
      if (err) throw new Error(err);
      return { ok: true };
    });
    electron.ipcMain.handle("memory:init-rulebook", async (event) => {
      assertLibrarySender(event);
      const res = memoryStore.ensureReviewRulebook();
      await interviewLibrary.getPublic().catch(() => {});
      return res;
    });''',
        "interview-library pick-root + read-doc IPC",
    )

    # 7. Notify workbenchWindow when written compact mode toggles
    text = replace_once(
        text,
        '''      writtenWindow.applyPatch(patch);
      return publicSettings();''',
        '''      const prevWritten = writtenWindow.getPublic().enabled;
      const nextWritten = writtenWindow.applyPatch(patch);
      if (prevWritten !== nextWritten.enabled) workbenchWindow?.onWrittenCompactChanged(nextWritten.enabled);
      return publicSettings();''',
        "writtenWindow toggle sync",
    )

    # 8. Instantiate templatesStore, workbenchPrefs, workbenchWindow and register their IPCs + hotkeys + mouse bindings + capture affinity lifecycle
    text = replace_once(
        text,
        '      onRegistered: () => windowControls.register(),',
        '      onRegistered: () => { windowControls.register(); workbenchWindow?.registerHotkeys(); },\n      getExtraMouseBindings: () => workbenchWindow?.getMouseBindings() || [],\n      onExtraMouse: (action) => workbenchWindow?.dispatchHotkeyAction(action),',
        "shortcutRuntime onRegistered workbench hotkeys + mouse bindings",
    )

    text = replace_once(
        text,
        '    electron.ipcMain.handle("window-controls:set", (event, patch) => {\n      if (!win || event.sender !== win.webContents) throw new Error("仅主窗口可修改窗口设置");\n      return windowControls.applyPatch(patch);\n    });',
        '''    electron.ipcMain.handle("window-controls:set", (event, patch) => {
      if (!win || event.sender !== win.webContents) throw new Error("仅主窗口可修改窗口设置");
      return windowControls.applyPatch(patch);
    });
    const assertMainSender = (event, msg) => {
      if (!win || event.sender !== win.webContents) throw new Error(msg || "仅主窗口可执行该操作");
    };
    const { createTemplatesStore } = require(path.join(process.resourcesPath, "tools", "templates-store.cjs"));
    templatesStore = createTemplatesStore({ file: path.join(electron.app.getPath("userData"), "templates.json") });
    const { createWorkbenchPrefs } = require(path.join(process.resourcesPath, "tools", "workbench-prefs.cjs"));
    workbenchPrefs = createWorkbenchPrefs({
      file: path.join(electron.app.getPath("userData"), "workbench-prefs.json"),
      onChange: (value) => { if (win && !win.isDestroyed()) win.webContents.send("workbench-prefs:state", value); }
    });
    const { createWorkbenchWindow } = require(path.join(process.resourcesPath, "tools", "workbench-window.cjs"));
    workbenchWindow = createWorkbenchWindow({
      prefs: workbenchPrefs,
      screen: electron.screen,
      shortcuts: electron.globalShortcut,
      getStealth: () => !!settings.data.ui.stealth,
      setStealth: (on) => {
        settings.applyPatch({ ui: { stealth: !!on } });
        win?.setContentProtection(!!on);
      },
      isWrittenCompact: () => !!writtenWindow?.getPublic().enabled,
      onStateChange: (state) => { if (win && !win.isDestroyed()) win.webContents.send("win:state", state); },
      onHoverChange: (inside) => { if (win && !win.isDestroyed()) win.webContents.send("win:hover-state", { inside }); },
      onHotkeyAction: (action) => { if (win && !win.isDestroyed()) win.webContents.send("win:hotkey-action", { action }); },
      onHotkeysChanged: () => { if (!shortcutRuntime?.recording) shortcutRuntime?.register(); }
    });
    const reapplyCapture = () => { workbenchWindow?.reapplyContentProtection(); };
    electron.powerMonitor?.on?.("resume", reapplyCapture);
    electron.powerMonitor?.on?.("unlock-screen", reapplyCapture);
    electron.screen?.on?.("display-added", reapplyCapture);
    electron.screen?.on?.("display-removed", reapplyCapture);
    electron.screen?.on?.("display-metrics-changed", reapplyCapture);
    electron.ipcMain.handle("templates:load", (event) => { assertMainSender(event); return templatesStore.load(); });
    electron.ipcMain.handle("templates:save", (event, data) => { assertMainSender(event); return templatesStore.save(data); });
    electron.ipcMain.handle("workbench-prefs:get", (event) => { assertMainSender(event); return workbenchPrefs.getPublic(); });
    electron.ipcMain.handle("workbench-prefs:set", (event, patch) => {
      assertMainSender(event);
      const next = workbenchPrefs.applyPatch(patch);
      workbenchWindow.syncHoverPolling();
      return next;
    });
    electron.ipcMain.handle("win:set-mode", (event, mode) => { assertMainSender(event); return workbenchWindow.setMode(mode); });
    electron.ipcMain.handle("win:get-state", (event) => { assertMainSender(event); return workbenchWindow.getWindowState(); });
    electron.ipcMain.handle("win:minimize", (event) => { assertMainSender(event); return workbenchWindow.minimize(); });
    electron.ipcMain.handle("win:toggle-maximize", (event) => { assertMainSender(event); return workbenchWindow.toggleMaximize(); });
    electron.ipcMain.handle("win:set-always-on-top", (event, on) => { assertMainSender(event); return workbenchWindow.setAlwaysOnTop(on); });
    electron.ipcMain.handle("win:set-prevent-focus", (event, on) => { assertMainSender(event); return workbenchWindow.setPreventFocus(on); });
    electron.ipcMain.handle("win:request-temp-focus", (event, active) => { assertMainSender(event); return workbenchWindow.requestTempFocus(active); });
    electron.ipcMain.handle("win:set-click-through", (event, on) => { assertMainSender(event); return workbenchWindow.setClickThrough(on); });
    electron.ipcMain.on("win:set-mouse-interactive", (event, interactive) => {
      if (!win || event.sender !== win.webContents) return;
      workbenchWindow.setMouseInteractive(interactive);
    });
    electron.ipcMain.handle("win:cursor-in-content", (event) => {
      assertMainSender(event);
      return workbenchWindow.getCursorInContent();
    });
    electron.ipcMain.handle("win:set-hover-tracking", (event, on) => { assertMainSender(event); return workbenchWindow.setHoverTracking(on); });
    electron.ipcMain.handle("win:set-hover-blocked", (event, blocked) => { assertMainSender(event); return workbenchWindow.setHoverBlocked(blocked); });
    electron.ipcMain.on("win:drag-start", (event, sx, sy) => {
      if (!win || event.sender !== win.webContents) return;
      workbenchWindow.beginDrag(sx, sy);
    });
    electron.ipcMain.on("win:drag-move", (event, sx, sy) => {
      if (!win || event.sender !== win.webContents) return;
      workbenchWindow.dragTo(sx, sy);
    });
    electron.ipcMain.on("win:drag-end", (event) => {
      if (!win || event.sender !== win.webContents) return;
      workbenchWindow.endDrag();
    });
    electron.ipcMain.handle("win:set-workbench-hotkeys", (event, patch) => { assertMainSender(event); return workbenchWindow.setWorkbenchHotkeys(patch); });
    electron.ipcMain.handle("win:reset-workbench-hotkeys", (event) => { assertMainSender(event); return workbenchWindow.resetWorkbenchHotkeys(); });
    electron.ipcMain.handle("win:set-allow-capture", (event, allow) => { assertMainSender(event); return workbenchWindow.setAllowCapture(allow); });
    electron.ipcMain.handle("win:get-displays", (event) => { assertMainSender(event); return workbenchWindow.getDisplays(); });
    electron.ipcMain.handle("security:enable", (event, options) => { assertMainSender(event); return workbenchWindow.enableSecurity(options); });
    electron.ipcMain.handle("security:disable", (event, options) => { assertMainSender(event); return workbenchWindow.disableSecurity(options); });
    electron.ipcMain.handle("security:set-prefs", (event, patch) => { assertMainSender(event); return workbenchWindow.setSecurityPrefs(patch); });
    electron.ipcMain.handle("security:check-env", (event) => { assertMainSender(event); return workbenchWindow.checkEnvironment(); });
    const { createAudioRecorder } = require(path.join(process.resourcesPath, "tools", "audio-recorder.cjs"));
    audioRecorder = createAudioRecorder({
      defaultDir: path.join(electron.app.getPath("userData"), "recordings"),
      getCustomDir: () => workbenchPrefs?.getPublic().recordingDir || "",
      onStateChange: (state) => { if (win && !win.isDestroyed()) win.webContents.send("recording:state", state); }
    });
    electron.ipcMain.handle("recording:start", (event, opts) => { assertMainSender(event); return audioRecorder.start(opts); });
    electron.ipcMain.handle("recording:stop", (event) => { assertMainSender(event); return audioRecorder.stop(); });
    electron.ipcMain.handle("recording:status", (event) => { assertMainSender(event); return audioRecorder.status(); });
    electron.ipcMain.handle("recording:list", (event, sessionId) => { assertMainSender(event); return audioRecorder.list(sessionId); });
    electron.ipcMain.handle("recording:read-track", (event, opts) => { assertMainSender(event); return audioRecorder.readTrack(opts); });
    electron.ipcMain.handle("recording:discard", (event, sessionId) => { assertMainSender(event); return audioRecorder.discardSession(sessionId); });
    electron.ipcMain.handle("recording:open-folder", async (event, sessionId) => {
      assertMainSender(event);
      const target = audioRecorder.getRecordingDir(sessionId);
      const err = await electron.shell.openPath(target);
      if (err) throw new Error(err);
      return { ok: true, path: target };
    });
    electron.ipcMain.handle("recording:pick-dir", async (event) => {
      assertMainSender(event);
      const r = await electron.dialog.showOpenDialog(win ?? undefined, {
        title: "选择整场录音存储目录",
        properties: ["openDirectory", "createDirectory"]
      });
      if (r.canceled || !r.filePaths[0]) return null;
      return r.filePaths[0];
    });''',
        "workbench IPC registration",
    )

    # 8a. Tee capture:pcm stream to dual-track WAV audioRecorder when recording is active
    text = replace_once(
        text,
        '''    electron.ipcMain.on(IPC.capturePcm, (_e, buf, captureTs, channel) => {
      asr.sendPcm(buf, captureTs, channel === "me" ? "me" : "them");
    });''',
        '''    electron.ipcMain.on(IPC.capturePcm, (_e, buf, captureTs, channel) => {
      const ch = channel === "me" ? "me" : "them";
      asr.sendPcm(buf, captureTs, ch);
      audioRecorder?.writePcm(buf, ch);
    });''',
        "capturePcm tee to audioRecorder",
    )

    # 8b. Support optional targetLang on translateText IPC
    text = replace_once(
        text,
        '''    electron.ipcMain.handle(IPC.translateText, async (_e, text) => {
      const apiKey = settings.getLlmApiKey();
      if (!apiKey) throw new Error(T().noApiKeyShort);
      const r = await chatStream(
        { baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, apiKey },
        buildTranslateMessages(text),
        { onDelta: () => {
        } }
      );
      return r.text;
    });''',
        '''    electron.ipcMain.handle(IPC.translateText, async (_e, text, targetLang) => {
      const apiKey = settings.getLlmApiKey();
      if (!apiKey) throw new Error(T().noApiKeyShort);
      const msgs = targetLang && targetLang !== "zh-CN"
        ? buildTargetTranslateMessages(text, targetLang)
        : buildTranslateMessages(text);
      const r = await chatStream(
        { baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, apiKey },
        msgs,
        { onDelta: () => {} }
      );
      return r.text;
    });''',
        "translateText targetLang",
    )

    # 9. Add sessions:save-sync and display-aware region:pick + stealthSet sync
    text = replace_once(
        text,
        '''    electron.ipcMain.on(IPC.sessionsSave, (_e, data) => sessionStore.save(data));
    electron.ipcMain.handle(IPC.regionPick, (_e, mode) => captureQuietScreenshot(mode === "region" ? "region" : "full"));
    electron.ipcMain.handle(IPC.stealthSet, (_e, on) => {
      settings.applyPatch({ ui: { stealth: on } });
      win?.setContentProtection(on);
      return on;
    });''',
        '''    electron.ipcMain.on(IPC.sessionsSave, (_e, data) => sessionStore.save(data));
    electron.ipcMain.handle("sessions:save-sync", (event, data) => {
      if (!win || event.sender !== win.webContents) return { ok: false, error: "仅主窗口可保存会话" };
      try {
        return sessionStore.saveStrict(data);
      } catch (e) {
        console.error("[sessions] save-sync failed:", e.message);
        return { ok: false, error: e.message || "保存会话失败" };
      }
    });
    electron.ipcMain.handle(IPC.regionPick, (_e, mode, displayId) => {
      const m = mode === "region" ? "region" : "full";
      if (m === "region") return captureQuietScreenshot("region");
      const resolved = workbenchWindow?.resolveCaptureRect(displayId);
      return captureQuietScreenshot("full", resolved?.rect ?? null);
    });
    electron.ipcMain.handle(IPC.stealthSet, (_e, on) => {
      if (workbenchPrefs?.getPublic().securityMode.enabled && !on) {
        throw new Error("安全模式已开启，已强制禁止出现在截图中");
      }
      settings.applyPatch({ ui: { stealth: !!on } });
      win?.setContentProtection(!!on);
      if (win && !win.isDestroyed() && workbenchWindow) win.webContents.send("win:state", workbenchWindow.getWindowState());
      return !!on;
    });''',
        "sessions:save-sync + display-aware region:pick + stealth guard",
    )

    # 10. Support codingPrefs on llm:ask and shot:ask, displayId on shot:ask, and fix baseline shotAsk options bug
    text = replace_once(
        text,
        '''      try {
        messages = await interviewLibrary.build({ ...payload, scene: multimodalRouter.getPublic().mode, answerLang: payload.answerLang ?? settings.data.llm.answerLang }, messages);
      } catch (error) {''',
        '''      try {
        messages = await interviewLibrary.build({ ...payload, scene: payload.scene || multimodalRouter.getPublic().mode, answerLang: payload.answerLang ?? settings.data.llm.answerLang }, messages);
      } catch (error) {''',
        "llmAsk scene override",
    )

    text = replace_once(
        text,
        '''      const evidence = messages.evidence;
      const stream = evidence ?''',
        '''      if (!isTranslate && (payload.codingPrefs?.mode === "coding" || payload.dialogueThinking) && !messages.skipGeneration && !messages.directAnswer && !messages.blockedUnknown) {
        appendCodingDirective(messages, payload.codingPrefs, Boolean(payload.dialogueThinking));
      }
      const evidence = messages.evidence;
      const stream = evidence ?''',
        "llmAsk coding directive",
    )

    text = replace_once(
        text,
        '''        const imgP = (Array.isArray(payload.imageDataUrls) && payload.imageDataUrls.length ? Promise.resolve(payload.imageDataUrls) : payload.imageDataUrl ? Promise.resolve([payload.imageDataUrl]) : captureQuietScreenshot().then(dataUrl => dataUrl ? [dataUrl] : null)).then((dataUrls) => {
          if (!dataUrls?.length) throw Object.assign(new Error("已取消截图"), { captureCancelled: true });
          if (dataUrls.length > 12 || dataUrls.some(url => typeof url !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,/.test(url))) throw new Error("截图数据无效或数量超限");
          return dataUrls;
        });''',
        '''        const resolvedRect = workbenchWindow?.resolveCaptureRect(payload.displayId)?.rect ?? null;
        const allowEmptyImages = payload.textOnly === true;
        const imgP = (
          Array.isArray(payload.imageDataUrls) && payload.imageDataUrls.length
            ? Promise.resolve(payload.imageDataUrls)
            : payload.imageDataUrl
              ? Promise.resolve([payload.imageDataUrl])
              : allowEmptyImages
                ? Promise.resolve([])
                : captureQuietScreenshot("full", resolvedRect).then(dataUrl => dataUrl ? [dataUrl] : null)
        ).then((dataUrls) => {
          if (!allowEmptyImages && !dataUrls?.length) throw Object.assign(new Error("已取消截图"), { captureCancelled: true });
          const safeList = Array.isArray(dataUrls) ? dataUrls : [];
          if (safeList.length > 12 || safeList.some(url => typeof url !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,/.test(url))) throw new Error("截图数据无效或数量超限");
          return safeList;
        });''',
        "shotAsk display rect + textOnly followup support",
    )

    text = replace_once(
        text,
        '''        imgP.then(
          async (dataUrls) => multimodalRouter.chat(
            (multimodalRouter.getPublic().mode === "interview" ? await (async () => { const messages = await interviewLibrary.build({ ...payload, images: dataUrls, answerLang: settings.data.llm.answerLang }, []); shotEvidence = messages.evidence; shotBlockedUnknown = messages.suggestionOnly ? null : messages.blockedUnknown; shotAnswerPolicy = messages.answerPolicy; return messages; })() : multimodalRouter.buildMessages({
              ...payload, imageDataUrls: dataUrls, imageDataUrl: dataUrls[0], answerLang: settings.data.llm.answerLang, background: payload.background || knowledge.text,
              originalMessages: buildVisionMessages(payload.question || "", dataUrls[0], payload.background || knowledge.text),
              originalPersona: buildVisionMessages("", dataUrls[0], "")[0].content
            }, "shot")),
            ac.signal, unifiedProgress(sendEv, payload.requestId), shotEvidence ? (() => {}) : unifiedResults(sendEv, payload.requestId)
          )
        )''',
        '''        imgP.then(
          async (dataUrls) => {
            const effectiveLang = payload.answerLang ?? settings.data.llm.answerLang;
            const effectiveMode = payload.scene || multimodalRouter.getPublic().mode;
            const built = effectiveMode === "interview" ? await (async () => {
              const messages = await interviewLibrary.build({ ...payload, scene: effectiveMode, images: dataUrls, answerLang: effectiveLang }, []);
              shotEvidence = messages.evidence;
              shotBlockedUnknown = messages.suggestionOnly ? null : messages.blockedUnknown;
              shotAnswerPolicy = messages.answerPolicy;
              return messages;
            })() : multimodalRouter.buildMessages({
              ...payload,
              scene: effectiveMode,
              imageDataUrls: dataUrls,
              imageDataUrl: dataUrls[0],
              history: Array.isArray(payload.history) ? payload.history : [],
              writtenPrompt: payload.writtenPrompt || "",
              answerLang: effectiveLang,
              background: payload.background || knowledge.text,
              originalMessages: dataUrls[0] ? buildVisionMessages(payload.question || "", dataUrls[0], payload.background || knowledge.text) : undefined,
              originalPersona: dataUrls[0] ? buildVisionMessages("", dataUrls[0], "")[0].content : undefined
            }, dataUrls.length ? "shot" : "answer");
            if (payload.codingPrefs?.mode === "coding" || payload.writtenMode === "followup") {
              appendCodingDirective(built, payload.codingPrefs, false, payload.writtenMode === "followup");
            }
            const effectiveSim = typeof payload.simultaneousAnswers === "boolean"
              ? payload.simultaneousAnswers
              : (effectiveMode === "written" && multimodalRouter.getPublic().simultaneousAnswers);
            const baseOpts = shotEvidence ? {} : {
              ...unifiedResults(sendEv, payload.requestId),
              simultaneousAnswers: effectiveSim,
              ...(payload.endpointId ? { endpointId: payload.endpointId } : {})
            };
            return multimodalRouter.chat(
              built,
              ac.signal,
              unifiedProgress(sendEv, payload.requestId),
              baseOpts
            );
          }
        )''',
        "shotAsk codingPrefs + written followup + primary vision routing",
    )

    # 11. Withdraw legacy setup.html wizard: route startup & onboarding:rerun to main V3 in-app Quick-Start Guide (M21)
    text = replace_once(
        text,
        '''    electron.ipcMain.handle(IPC.onboardingRerun, () => {
      openSetupWindow(true);
      return true;
    });''',
        '''    electron.ipcMain.handle(IPC.onboardingRerun, () => {
      if (!win || win.isDestroyed()) {
        startMainApp();
      } else {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      if (win && !win.isDestroyed()) {
        if (win.webContents.isLoading()) {
          win.webContents.once("did-finish-load", () => {
            if (win && !win.isDestroyed()) win.webContents.send(IPC.trayCommand, { command: "open-quickstart" });
          });
        } else {
          win.webContents.send(IPC.trayCommand, { command: "open-quickstart" });
        }
      }
      return true;
    });''',
        "withdraw legacy onboardingRerun setup window",
    )

    text = replace_once(
        text,
        '''    if (process.env.MC_FORCE_ONBOARDING === "1" || !settings.data.onboarding.completed) {
      openSetupWindow();
    } else {
      startMainApp();
    }''',
        '''    const shouldShowQuickStart = process.env.MC_FORCE_ONBOARDING === "1" || !settings.data.onboarding.completed;
    if (!settings.data.onboarding.completed) {
      settings.completeOnboarding({ skipped: true });
    }
    startMainApp();
    if (shouldShowQuickStart && win && !win.isDestroyed()) {
      win.webContents.once("did-finish-load", () => {
        if (win && !win.isDestroyed()) win.webContents.send(IPC.trayCommand, { command: "open-quickstart" });
      });
    }''',
        "withdraw legacy startup setup window",
    )

    # 12. Register models:list IPC (CC Switch style dynamic model fetching with stored encrypted key + proxy support)
    text = replace_once(
        text,
        '''    electron.ipcMain.handle(IPC.onboardingRerun, () => {''',
        '''    electron.ipcMain.handle("models:list", async (_e, req = {}) => {
      const mr = require(path.join(process.resourcesPath, "tools", "model-reasoning.cjs"));
      const baseUrl = String(req?.baseUrl || "").trim();
      let apiKey = String(req?.apiKey || "").trim();
      if (!apiKey) {
        if (req?.slot === "llm") {
          apiKey = settings.getLlmApiKey() || "";
        } else if (req?.slot === "vision-endpoint" && req?.endpointId) {
          apiKey = multimodalRouter?.getEndpointApiKey?.(req.endpointId) || "";
        } else if (req?.slot === "asr-cloud") {
          apiKey = settings.getCloudAsrApiKey() || "";
        }
      }
      try {
        return await mr.fetchModelList({
          baseUrl,
          apiKey,
          proxyUrl: String(req?.proxyUrl || "").trim(),
          electron,
          timeoutMs: 15000
        });
      } catch (err) {
        return { ok: false, models: [], error: err?.message || String(err) };
      }
    });
    electron.ipcMain.handle(IPC.onboardingRerun, () => {''',
        "models:list IPC handler",
    )

    # 13. Dispose workbenchWindow & audioRecorder cleanly on before-quit
    text = replace_once(
        text,
        '''    writtenWindow?.flush();
    windowControls?.dispose();''',
        '''    audioRecorder?.dispose();
    workbenchWindow?.dispose();
    writtenWindow?.flush();
    windowControls?.dispose();''',
        "before-quit dispose workbenchWindow",
    )

    return text.encode("utf-8")


def patch_preload(raw: bytes) -> bytes:
    """Apply incremental preload IPC enhancements onto the verified portable baseline."""
    text = raw.decode("utf-8")

    # Extend pickRegion to accept optional displayId and translate to accept optional targetLang
    text = replace_once(
        text,
        '  pickRegion: (mode = "full") => electron.ipcRenderer.invoke(IPC.regionPick, mode === "region" ? "region" : "full"),',
        '  pickRegion: (mode = "full", displayId) => electron.ipcRenderer.invoke(IPC.regionPick, mode === "region" ? "region" : "full", displayId),',
        "preload pickRegion displayId",
    )
    text = replace_once(
        text,
        '  translate: (text) => electron.ipcRenderer.invoke(IPC.translateText, text),',
        '  translate: (text, targetLang) => electron.ipcRenderer.invoke(IPC.translateText, text, targetLang),',
        "preload translate targetLang",
    )

    # Add new window.mc APIs right before quit
    text = replace_once(
        text,
        '  hide: () => electron.ipcRenderer.send(IPC.winHide),\n  quit: () => electron.ipcRenderer.send(IPC.appQuit)\n};',
        '''  saveSessionsSync: (data) => electron.ipcRenderer.invoke("sessions:save-sync", data),
  pickInterviewLibraryRoot: () => electron.ipcRenderer.invoke("interview-library:pick-root"),
  readInterviewDocument: (ref) => electron.ipcRenderer.invoke("interview-library:read-doc", ref),
  openInterviewDocument: (ref) => electron.ipcRenderer.invoke("interview-library:open-doc", ref),
  readInterviewChunks: (ref) => electron.ipcRenderer.invoke("interview-library:read-chunks", ref),
  getRagStatus: () => electron.ipcRenderer.invoke("interview-library:rag-status"),
  kbWriteDoc: (payload) => electron.ipcRenderer.invoke("kb:write-doc", payload),
  kbTrashDoc: (payload) => electron.ipcRenderer.invoke("kb:trash-doc", payload),
  kbCreateRole: (payload) => electron.ipcRenderer.invoke("kb:create-role", payload),
  kbUpdateRoleStatus: (payload) => electron.ipcRenderer.invoke("kb:update-role-status", payload),
  kbImportFiles: (payload) => electron.ipcRenderer.invoke("kb:import-files", payload),
  kbPickImportFiles: () => electron.ipcRenderer.invoke("kb:pick-import-files"),
  kbReadPersona: () => electron.ipcRenderer.invoke("kb:read-persona"),
  kbSavePersona: (payload) => electron.ipcRenderer.invoke("kb:save-persona", payload),
  kbListIntro: () => electron.ipcRenderer.invoke("kb:list-intro"),
  memoryGet: () => electron.ipcRenderer.invoke("memory:get"),
  memoryDiff: (version) => electron.ipcRenderer.invoke("memory:diff", version),
  memorySaveBucket: (payload) => electron.ipcRenderer.invoke("memory:save-bucket", payload),
  memoryAppendItem: (payload) => electron.ipcRenderer.invoke("memory:append-item", payload),
  memoryResolvePending: (payload) => electron.ipcRenderer.invoke("memory:resolve-pending", payload),
  memoryRollback: (version) => electron.ipcRenderer.invoke("memory:rollback", version),
  memoryOpenDir: () => electron.ipcRenderer.invoke("memory:open-dir"),
  memoryArchiveSession: (payload) => electron.ipcRenderer.invoke("memory:archive-session", payload),
  memoryOpenPath: (targetPath) => electron.ipcRenderer.invoke("memory:open-path", targetPath),
  memoryInitRulebook: () => electron.ipcRenderer.invoke("memory:init-rulebook"),
  startRecording: (opts) => electron.ipcRenderer.invoke("recording:start", opts),
  stopRecording: () => electron.ipcRenderer.invoke("recording:stop"),
  getRecordingStatus: () => electron.ipcRenderer.invoke("recording:status"),
  listRecordings: (sessionId) => electron.ipcRenderer.invoke("recording:list", sessionId),
  readRecordingTrack: (opts) => electron.ipcRenderer.invoke("recording:read-track", opts),
  discardRecording: (sessionId) => electron.ipcRenderer.invoke("recording:discard", sessionId),
  openRecordingFolder: (sessionId) => electron.ipcRenderer.invoke("recording:open-folder", sessionId),
  pickRecordingDir: () => electron.ipcRenderer.invoke("recording:pick-dir"),
  onRecordingState: (cb) => {
    const listener = (_e, value) => cb(value);
    electron.ipcRenderer.on("recording:state", listener);
    return () => electron.ipcRenderer.removeListener("recording:state", listener);
  },
  loadTemplates: () => electron.ipcRenderer.invoke("templates:load"),
  saveTemplates: (data) => electron.ipcRenderer.invoke("templates:save", data),
  getWorkbenchPrefs: () => electron.ipcRenderer.invoke("workbench-prefs:get"),
  setWorkbenchPrefs: (patch) => electron.ipcRenderer.invoke("workbench-prefs:set", patch),
  onWorkbenchPrefsState: (cb) => {
    const listener = (_e, value) => cb(value);
    electron.ipcRenderer.on("workbench-prefs:state", listener);
    return () => electron.ipcRenderer.removeListener("workbench-prefs:state", listener);
  },
  setWindowMode: (mode) => electron.ipcRenderer.invoke("win:set-mode", mode),
  getWindowState: () => electron.ipcRenderer.invoke("win:get-state"),
  onWindowState: (cb) => {
    const listener = (_e, value) => cb(value);
    electron.ipcRenderer.on("win:state", listener);
    return () => electron.ipcRenderer.removeListener("win:state", listener);
  },
  minimizeWindow: () => electron.ipcRenderer.invoke("win:minimize"),
  toggleMaximizeWindow: () => electron.ipcRenderer.invoke("win:toggle-maximize"),
  setAlwaysOnTop: (on) => electron.ipcRenderer.invoke("win:set-always-on-top", on),
  setPreventFocus: (on) => electron.ipcRenderer.invoke("win:set-prevent-focus", on),
  requestTempFocus: (active) => electron.ipcRenderer.invoke("win:request-temp-focus", active),
  setClickThrough: (on) => electron.ipcRenderer.invoke("win:set-click-through", on),
  setMouseInteractive: (interactive) => electron.ipcRenderer.send("win:set-mouse-interactive", !!interactive),
  getCursorInContent: () => electron.ipcRenderer.invoke("win:cursor-in-content"),
  setHoverTracking: (on) => electron.ipcRenderer.invoke("win:set-hover-tracking", on),
  setHoverBlocked: (blocked) => electron.ipcRenderer.invoke("win:set-hover-blocked", !!blocked),
  onHoverState: (cb) => {
    const listener = (_e, value) => cb(value);
    electron.ipcRenderer.on("win:hover-state", listener);
    return () => electron.ipcRenderer.removeListener("win:hover-state", listener);
  },
  dragStart: (sx, sy) => electron.ipcRenderer.send("win:drag-start", sx, sy),
  dragMove: (sx, sy) => electron.ipcRenderer.send("win:drag-move", sx, sy),
  dragEnd: () => electron.ipcRenderer.send("win:drag-end"),
  setWorkbenchHotkeys: (patch) => electron.ipcRenderer.invoke("win:set-workbench-hotkeys", patch),
  resetWorkbenchHotkeys: () => electron.ipcRenderer.invoke("win:reset-workbench-hotkeys"),
  onWorkbenchHotkeyAction: (cb) => {
    const listener = (_e, value) => cb(value);
    electron.ipcRenderer.on("win:hotkey-action", listener);
    return () => electron.ipcRenderer.removeListener("win:hotkey-action", listener);
  },
  setAllowCapture: (allow) => electron.ipcRenderer.invoke("win:set-allow-capture", allow),
  getDisplays: () => electron.ipcRenderer.invoke("win:get-displays"),
  enableSecurity: (options) => electron.ipcRenderer.invoke("security:enable", options),
  disableSecurity: (options) => electron.ipcRenderer.invoke("security:disable", options),
  setSecurityPrefs: (patch) => electron.ipcRenderer.invoke("security:set-prefs", patch),
  checkSecurityEnvironment: () => electron.ipcRenderer.invoke("security:check-env"),
  listModels: (req) => electron.ipcRenderer.invoke("models:list", req),
  hide: () => electron.ipcRenderer.send(IPC.winHide),
  quit: () => electron.ipcRenderer.send(IPC.appQuit)
};''',
        "preload new window.mc methods",
    )

    return text.encode("utf-8")

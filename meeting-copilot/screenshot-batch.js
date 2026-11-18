// Shared by the compact and full views; no API calls until send in batch mode.
function createScreenshotBatch({ capture, send, isWritten, getSession, onChange }) {
  let state = { enabled: false, images: [], question: '', busy: false, message: '' };
  const snapshot = () => ({ ...state, images: [...state.images] });
  const update = patch => { state = { ...state, ...patch }; onChange(snapshot()); };
  function toggle() {
    if (state.busy) return update({ message: '截图中，请完成或取消框选后再切换模式' });
    if (!isWritten()) return update({ message: '请先切换到笔试模式' });
    update({ enabled: !state.enabled, message: state.enabled ? '已关闭多图；暂存截图保留，不会自动发送' : '多图已开启：用原截图键逐张暂存，再用发送键提交' });
  }
  async function take(mode = 'full', question = '') {
    if (state.busy) return false;
    const batch = state.enabled && isWritten(), session = getSession();
    if (batch && state.images.length >= 12) { update({ message: '已暂存 12 张，请先发送或移除截图' }); return false; }
    update({ busy: true, message: '' });
    try {
      const dataUrl = await capture(mode);
      if (!dataUrl) return false;
      if (batch) {
        if (state.images.reduce((n, img) => n + img.dataUrl.length, dataUrl.length) > 64 * 1024 * 1024) throw new Error('截图已保存本地，但暂存总量超过 48 MiB，未加入队列');
        update({ images: [...state.images, { dataUrl, name: `${mode === 'region' ? '框选' : '全屏'} ${new Date().toLocaleTimeString()}` }], question: question || state.question, message: '截图已保存并暂存，尚未发送' });
      } else {
        if (session !== getSession() || !session) throw new Error('会话已改变：截图已保存本地，请重新截图后发送');
        send(question, dataUrl);
      }
      return true;
    } catch (e) { update({ message: e.message }); return false; }
    finally { update({ busy: false }); }
  }
  function sendBatch() {
    if (state.busy) return update({ message: '截图中，请完成或取消框选后再发送' });
    if (!isWritten()) return update({ message: '请先切换到笔试模式再发送暂存截图' });
    if (!state.images.length) return update({ message: '没有暂存截图，请先开启多图并按截图键' });
    if (!getSession()) return update({ message: '会话尚未就绪，截图已保留' });
    try {
      send(state.question, undefined, state.images.map(img => img.dataUrl));
      update({ images: [], question: '', message: '全部暂存截图已提交，原图保存在本地' });
    } catch (e) { update({ message: '发送失败，截图已保留：' + e.message }); }
  }
  return { snapshot, take, toggle, sendBatch,
    question: value => update({ question: value }),
    remove: index => { if (!state.busy) update({ images: state.images.filter((_, i) => i !== index) }); },
    clear: () => { if (!state.busy) update({ images: [], message: '暂存已清空，本地原图保留' }); }
  };
}
if (typeof module !== 'undefined') module.exports = { createScreenshotBatch };

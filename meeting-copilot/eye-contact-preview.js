function createEyeContactPreview(options = {}) {
  const media = options.mediaDevices || navigator.mediaDevices;
  const delay = options.pollMs ?? 250, enumerationTimeout = options.enumerationTimeout ?? 10000;
  let version = 0, stream = null, video = null, sessionId = null;
  const cancellations = new Set();
  const stopTracks = value => value?.getTracks().forEach(track => track.stop());
  const abortError = () => Object.assign(new Error('预览已停止。'), { name: 'AbortError' });
  const emit = report => {
    options.onState?.(report);
    if (sessionId !== null) Promise.resolve(options.report?.({ ...report, sessionId })).catch(() => {});
  };
  function bounded(promise, ms, message, token, lateCleanup) {
    let finished = false, timeout, cancel;
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        if (finished) return; finished = true; clearTimeout(timeout); cancellations.delete(cancel);
        error ? reject(error) : resolve(value);
      };
      cancel = () => finish(abortError()); cancellations.add(cancel);
      timeout = setTimeout(() => finish(new Error(message)), ms);
      Promise.resolve(promise).then(value => {
        if (finished || token !== version) { lateCleanup?.(value); return; }
        finish(null, value);
      }, error => finish(error));
    });
  }
  function stop() {
    version++; for (const cancel of [...cancellations]) cancel(); cancellations.clear();
    stopTracks(stream); stream = null;
    if (video) { try { video.pause(); } catch {} video.srcObject = null; video = null; }
    emit({ status: 'stopped' }); sessionId = null;
  }
  async function listDevices(requestPermission = false) {
    const token = version;
    let devices = await bounded(media.enumerateDevices(), enumerationTimeout, '读取摄像头列表超时。', token);
    if (requestPermission && !devices.some(item => item.kind === 'videoinput' && item.label)) {
      const temporary = await bounded(media.getUserMedia({ video: true, audio: false }), options.openTimeout ?? 15000,
        '摄像头权限请求超时，请检查系统或浏览器权限。', token, stopTracks);
      stopTracks(temporary); devices = await bounded(media.enumerateDevices(), enumerationTimeout, '读取摄像头列表超时。', token);
    }
    return devices.filter(item => item.kind === 'videoinput');
  }
  function waitForFrame(element, token) {
    return new Promise((resolve, reject) => {
      let frameId, timeout, poll, done = false;
      const finish = error => {
        if (done) return; done = true; clearTimeout(timeout); clearInterval(poll);
        cancellations.delete(cancel);
        if (frameId !== undefined) element.cancelVideoFrameCallback?.(frameId);
        element.removeEventListener?.('loadeddata', check);
        error ? reject(error) : resolve();
      };
      const cancel = () => finish(abortError());
      const check = () => {
        if (token !== version) finish(abortError());
        else if (element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0) finish();
      };
      cancellations.add(cancel);
      timeout = setTimeout(() => finish(new Error('虚拟摄像头已打开，但没有收到首帧。')), options.frameTimeout ?? 8000);
      if (typeof element.requestVideoFrameCallback === 'function') frameId = element.requestVideoFrameCallback(() => token === version ? finish() : finish(abortError()));
      else { element.addEventListener?.('loadeddata', check); poll = setInterval(check, 100); }
      try { Promise.resolve(element.play()).catch(error => finish(error)); } catch (error) { finish(error); }
    });
  }
  async function start({ virtualCamera, element, sessionId: id }) {
    stop(); const token = version; sessionId = id; video = element;
    emit({ status: 'waiting' });
    try {
      let devices = await listDevices(true), device;
      const deadline = Date.now() + enumerationTimeout;
      while (token === version) {
        device = devices.find(item => item.label === virtualCamera);
        if (device) break;
        if (Date.now() >= deadline) throw new Error('没有发现虚拟摄像头；如果刚安装或更新过组件，请完全退出并重新打开使用摄像头的软件。');
        await bounded(new Promise(resolve => setTimeout(resolve, delay)), delay + 1000, '等待设备列表超时。', token);
        devices = await bounded(media.enumerateDevices(), enumerationTimeout, '读取摄像头列表超时。', token);
      }
      if (token !== version) throw abortError();
      const obtained = await bounded(media.getUserMedia({ video: { deviceId: { exact: device.deviceId } }, audio: false }),
        options.openTimeout ?? 15000, '虚拟摄像头打开超时，请检查其他预览是否已停止。', token, stopTracks);
      if (token !== version) { stopTracks(obtained); throw abortError(); }
      stream = obtained;
      for (const track of stream.getTracks()) track.onended = () => { if (token === version) stop(); };
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await waitForFrame(video, token);
      if (token !== version) throw abortError();
      const report = { status: 'first-frame', width: video.videoWidth, height: video.videoHeight };
      emit(report);
      const timer = setTimeout(() => { if (token === version) stop(); }, options.previewTimeout ?? 300000);
      cancellations.add(() => clearTimeout(timer));
      return report;
    } catch (error) {
      if (token === version) {
        stopTracks(stream); stream = null;
        if (video) { try { video.pause(); } catch {} video.srcObject = null; video = null; }
        emit({ status: error.name === 'AbortError' ? 'stopped' : 'error', message: `${error.name || 'Error'}: ${error.message}` });
      }
      throw error;
    }
  }
  return { start, stop, listDevices, isActive: () => sessionId !== null };
}

/**
 * Unified audio capture router matching MeetingCopilot's LoopbackCapture / MicCapture runtime contract:
 * - LoopbackCapture: new LoopbackCapture(); await cap.start((buf, ts) => ...)
 * - MicCapture: new MicCapture(); await mic.start(deviceId, (buf, ts) => ..., opts?)
 *
 * Modes:
 * - audioSource === 'system': LoopbackCapture (or MicCapture with themDeviceId on macOS/input platforms)
 *   feeds channel "them"; optional secondary MicCapture feeds channel "me".
 * - audioSource === 'mic': MicCapture directly feeds channel "them" (for in-person / speakerphone interviews).
 */
export function createAudioController({
  LoopbackCapture,
  MicCapture,
  platform = 'win32',
  sendPcm,
  notifyStarted,
  notifyStopped,
  onError = () => {}
}) {
  let primary = null;
  let secondaryMic = null;
  let active = false;
  let currentSource = 'system';
  let currentMicEnabled = false;
  let currentMicDeviceId = '';
  let currentThemDeviceId = '';

  async function start({
    audioSource = 'system',
    micEnabled = false,
    micDeviceId = '',
    themDeviceId = ''
  } = {}) {
    await stop();
    currentSource = audioSource === 'mic' ? 'mic' : 'system';
    currentMicEnabled = Boolean(micEnabled);
    currentMicDeviceId = String(micDeviceId || '');
    currentThemDeviceId = String(themDeviceId || '');

    const onThemPcm = (buf, ts) => sendPcm(buf, ts, 'them');
    const onMePcm = (buf, ts) => sendPcm(buf, ts, 'me');

    try {
      if (currentSource === 'mic') {
        primary = new MicCapture();
        await primary.start(currentMicDeviceId || undefined, onThemPcm);
      } else if (platform === 'darwin') {
        primary = new MicCapture();
        await primary.start(currentThemDeviceId || undefined, onThemPcm, { audioProcessing: false });
      } else {
        primary = new LoopbackCapture();
        await primary.start(onThemPcm);
        if (currentMicEnabled) {
          try {
            secondaryMic = new MicCapture();
            await secondaryMic.start(currentMicDeviceId || undefined, onMePcm);
          } catch (micErr) {
            secondaryMic = null;
            onError(`辅助麦克风启动失败（已继续系统音频采集）：${micErr?.message || micErr}`);
          }
        }
      }
      active = true;
      notifyStarted();
      return { ok: true, audioSource: currentSource, secondaryMicActive: Boolean(secondaryMic) };
    } catch (err) {
      await stop();
      throw err;
    }
  }

  async function stop() {
    const wasActive = active;
    active = false;
    try { await primary?.stop?.(); } catch {}
    try { await secondaryMic?.stop?.(); } catch {}
    primary = null;
    secondaryMic = null;
    if (wasActive) {
      try { notifyStopped(); } catch {}
    }
  }

  async function setSecondaryMic(enabled, micDeviceId = currentMicDeviceId) {
    currentMicEnabled = Boolean(enabled);
    currentMicDeviceId = String(micDeviceId || '');
    if (!active || currentSource !== 'system') return { ok: true, secondaryMicActive: false };
    if (currentMicEnabled && !secondaryMic) {
      const mic = new MicCapture();
      await mic.start(currentMicDeviceId || undefined, (buf, ts) => sendPcm(buf, ts, 'me'));
      secondaryMic = mic;
    } else if (!currentMicEnabled && secondaryMic) {
      try { await secondaryMic.stop(); } catch {}
      secondaryMic = null;
    }
    return { ok: true, secondaryMicActive: Boolean(secondaryMic) };
  }

  function getStatus() {
    return {
      active,
      audioSource: currentSource,
      secondaryMicActive: Boolean(secondaryMic)
    };
  }

  return { start, stop, setSecondaryMic, getStatus };
}

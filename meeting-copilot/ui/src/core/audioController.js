/**
 * Unified audio capture router supporting explicit audioSource selection:
 * - audioSource === 'system': system loopback feeds channel "them"; optional secondary mic feeds channel "me".
 * - audioSource === 'mic': microphone directly feeds channel "them" (for in-person / external-speaker interviews).
 */
export function createAudioController({
  LoopbackCapture,
  MicCapture,
  sendPcm,
  notifyStarted,
  notifyStopped,
  onLevel = () => {},
  onError = () => {}
}) {
  let primary = null;
  let secondaryMic = null;
  let active = false;
  let currentSource = 'system';
  let currentMicEnabled = false;
  let currentMicDeviceId = '';

  async function start({ audioSource = 'system', micEnabled = false, micDeviceId = '' } = {}) {
    await stop();
    currentSource = audioSource === 'mic' ? 'mic' : 'system';
    currentMicEnabled = Boolean(micEnabled);
    currentMicDeviceId = String(micDeviceId || '');

    const onThemPcm = (buf, ts) => sendPcm(buf, ts, 'them');
    const onMePcm = (buf, ts) => sendPcm(buf, ts, 'me');

    try {
      if (currentSource === 'mic') {
        primary = new MicCapture(onThemPcm, onLevel, currentMicDeviceId || undefined);
        await primary.start();
      } else {
        primary = new LoopbackCapture(onThemPcm, onLevel);
        await primary.start();
        if (currentMicEnabled) {
          try {
            secondaryMic = new MicCapture(onMePcm, () => {}, currentMicDeviceId || undefined);
            await secondaryMic.start();
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
      const mic = new MicCapture((buf, ts) => sendPcm(buf, ts, 'me'), () => {}, currentMicDeviceId || undefined);
      await mic.start();
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

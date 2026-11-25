'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8); // 32000 B/s
const WAV_HEADER_SIZE = 44;

function sanitizeId(raw) {
  const s = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!s) throw new Error('无效的会话或录音 ID');
  return s;
}

function buildWavHeader(dataBytes, sampleRate = SAMPLE_RATE, channels = CHANNELS, bitsPerSample = BITS_PER_SAMPLE) {
  const buf = Buffer.alloc(WAV_HEADER_SIZE);
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const clamped = Math.max(0, Math.min(0x7fffffff - 36, Math.floor(dataBytes)));
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + clamped, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(clamped, 40);
  return buf;
}

function float32ToInt16Buffer(input) {
  let floats;
  if (input instanceof Float32Array) {
    floats = input;
  } else if (ArrayBuffer.isView(input)) {
    const ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    floats = new Float32Array(ab);
  } else if (input instanceof ArrayBuffer) {
    floats = new Float32Array(input);
  } else {
    return Buffer.alloc(0);
  }
  const out = Buffer.allocUnsafe(floats.length * 2);
  for (let i = 0; i < floats.length; i++) {
    let s = floats[i];
    if (!Number.isFinite(s)) s = 0;
    else if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), i * 2);
  }
  return out;
}

function createAudioRecorder({ defaultDir, getCustomDir = () => '', onStateChange = () => {} }) {
  let current = null;
  let flushTimer = null;

  function resolveBaseDir() {
    const custom = String(getCustomDir?.() || '').trim();
    const target = custom || defaultDir;
    return path.resolve(target);
  }

  function ensureInside(base, target) {
    const absBase = path.resolve(base);
    const absTarget = path.resolve(target);
    if (absTarget !== absBase && !absTarget.toLowerCase().startsWith((absBase + path.sep).toLowerCase())) {
      throw new Error('路径越界');
    }
    return absTarget;
  }

  function emitState() {
    try { onStateChange(status()); } catch {}
  }

  function openTrack(filePath) {
    const fd = fs.openSync(filePath, 'w+');
    fs.writeSync(fd, buildWavHeader(0), 0, WAV_HEADER_SIZE, 0);
    return { filePath, fd, dataBytes: 0, dirtyHeader: false };
  }

  function updateHeader(track) {
    if (!track || track.fd === null || !track.dirtyHeader) return;
    try {
      const hdr = buildWavHeader(track.dataBytes);
      fs.writeSync(track.fd, hdr, 0, WAV_HEADER_SIZE, 0);
      track.dirtyHeader = false;
    } catch {}
  }

  function flushHeaders() {
    if (!current) return;
    updateHeader(current.tracks.them);
    updateHeader(current.tracks.me);
    emitState();
  }

  function status() {
    const baseDir = resolveBaseDir();
    if (!current) {
      return {
        active: false,
        sessionId: null,
        takeId: null,
        startedAt: null,
        durationSec: 0,
        themBytes: 0,
        meBytes: 0,
        recordingDir: baseDir
      };
    }
    const now = Date.now();
    return {
      active: true,
      sessionId: current.sessionId,
      takeId: current.takeId,
      startedAt: current.startedAt,
      durationSec: Math.max(0, Math.floor((now - current.startedAt) / 1000)),
      themBytes: current.tracks.them.dataBytes,
      meBytes: current.tracks.me.dataBytes,
      recordingDir: current.baseDir
    };
  }

  function start({ sessionId, sessionName = '', role = '', audioSource = 'system' } = {}) {
    if (current) stop();
    const safeSid = sanitizeId(sessionId);
    const baseDir = resolveBaseDir();
    const startedAt = Date.now();
    const takeId = 'take-' + startedAt;
    const takeDir = ensureInside(baseDir, path.join(baseDir, safeSid, takeId));
    fs.mkdirSync(takeDir, { recursive: true });

    const tracks = {
      them: openTrack(path.join(takeDir, 'them.wav')),
      me: openTrack(path.join(takeDir, 'me.wav'))
    };
    current = {
      sessionId: safeSid,
      sessionName: String(sessionName || ''),
      role: String(role || ''),
      audioSource: String(audioSource || 'system'),
      baseDir,
      takeId,
      takeDir,
      startedAt,
      tracks
    };
    flushTimer = setInterval(flushHeaders, 2000);
    flushTimer.unref?.();
    emitState();
    return status();
  }

  function writePcm(buf, channel = 'them') {
    if (!current || !buf) return;
    const ch = channel === 'me' ? 'me' : 'them';
    const track = current.tracks[ch];
    if (!track || track.fd === null) return;
    const pcm = float32ToInt16Buffer(buf);
    if (!pcm.length) return;
    try {
      const pos = WAV_HEADER_SIZE + track.dataBytes;
      fs.writeSync(track.fd, pcm, 0, pcm.length, pos);
      track.dataBytes += pcm.length;
      track.dirtyHeader = true;
    } catch {}
  }

  function stop() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (!current) return { ok: true, stopped: false, meta: null };
    const snap = current;
    current = null;

    const endedAt = Date.now();
    const savedTracks = [];
    for (const ch of ['them', 'me']) {
      const tr = snap.tracks[ch];
      if (!tr) continue;
      try {
        if (tr.fd !== null) {
          if (tr.dataBytes > 0) {
            const hdr = buildWavHeader(tr.dataBytes);
            fs.writeSync(tr.fd, hdr, 0, WAV_HEADER_SIZE, 0);
          }
          fs.closeSync(tr.fd);
          tr.fd = null;
        }
        if (tr.dataBytes <= 0) {
          fs.rmSync(tr.filePath, { force: true });
        } else {
          savedTracks.push({
            channel: ch,
            file: path.basename(tr.filePath),
            path: tr.filePath,
            bytes: tr.dataBytes + WAV_HEADER_SIZE,
            durationSec: Number((tr.dataBytes / BYTES_PER_SECOND).toFixed(1))
          });
        }
      } catch {}
    }

    let meta = null;
    if (savedTracks.length > 0) {
      meta = {
        schema: 1,
        takeId: snap.takeId,
        sessionId: snap.sessionId,
        sessionName: snap.sessionName,
        role: snap.role,
        audioSource: snap.audioSource,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
        startedAt: snap.startedAt,
        endedAt,
        durationSec: Math.max(
          Math.round((endedAt - snap.startedAt) / 1000),
          Math.round(Math.max(...savedTracks.map(t => t.durationSec), 0))
        ),
        tracks: savedTracks
      };
      try {
        fs.writeFileSync(path.join(snap.takeDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
      } catch {}
    } else {
      try { fs.rmSync(snap.takeDir, { recursive: true, force: true }); } catch {}
    }

    emitState();
    return { ok: true, stopped: true, meta };
  }

  function list(sessionId) {
    const safeSid = sanitizeId(sessionId);
    const baseDir = resolveBaseDir();
    const sessionDir = ensureInside(baseDir, path.join(baseDir, safeSid));
    if (!fs.existsSync(sessionDir)) return { recordingDir: baseDir, sessionDir, takes: [] };
    const takes = [];
    for (const ent of fs.readdirSync(sessionDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const takeDir = path.join(sessionDir, ent.name);
      const metaPath = path.join(takeDir, 'meta.json');
      let meta = null;
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
      }
      const tracks = [];
      for (const ch of ['them', 'me']) {
        const fp = path.join(takeDir, `${ch}.wav`);
        if (fs.existsSync(fp)) {
          const st = fs.statSync(fp);
          if (st.size > WAV_HEADER_SIZE) {
            tracks.push({
              channel: ch,
              file: `${ch}.wav`,
              path: fp,
              bytes: st.size,
              durationSec: Number(((st.size - WAV_HEADER_SIZE) / BYTES_PER_SECOND).toFixed(1))
            });
          }
        }
      }
      if (tracks.length > 0) {
        takes.push({
          takeId: ent.name,
          sessionId: safeSid,
          startedAt: meta?.startedAt || Number(ent.name.replace(/^take-/, '')) || 0,
          endedAt: meta?.endedAt || 0,
          durationSec: meta?.durationSec || Math.round(Math.max(...tracks.map(t => t.durationSec), 0)),
          audioSource: meta?.audioSource || 'system',
          tracks
        });
      }
    }
    takes.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    return { recordingDir: baseDir, sessionDir, takes };
  }

  function readTrack({ sessionId, takeId, channel }) {
    const safeSid = sanitizeId(sessionId);
    const safeTake = sanitizeId(takeId);
    const ch = channel === 'me' ? 'me' : 'them';
    const baseDir = resolveBaseDir();
    const fp = ensureInside(baseDir, path.join(baseDir, safeSid, safeTake, `${ch}.wav`));
    if (!fs.existsSync(fp)) throw new Error('录音文件不存在');
    const bytes = fs.readFileSync(fp);
    return { mime: 'audio/wav', filePath: fp, size: bytes.length, data: bytes };
  }

  function discardSession(sessionId) {
    const safeSid = sanitizeId(sessionId);
    if (current && current.sessionId === safeSid) stop();
    const baseDir = resolveBaseDir();
    const sessionDir = ensureInside(baseDir, path.join(baseDir, safeSid));
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    return { ok: true };
  }

  function getRecordingDir(sessionId) {
    const baseDir = resolveBaseDir();
    if (!sessionId) {
      fs.mkdirSync(baseDir, { recursive: true });
      return baseDir;
    }
    const safeSid = sanitizeId(sessionId);
    const sessionDir = ensureInside(baseDir, path.join(baseDir, safeSid));
    if (fs.existsSync(sessionDir)) return sessionDir;
    fs.mkdirSync(baseDir, { recursive: true });
    return baseDir;
  }

  return {
    start,
    writePcm,
    stop,
    status,
    list,
    readTrack,
    discardSession,
    getRecordingDir,
    dispose: stop
  };
}

module.exports = {
  createAudioRecorder,
  buildWavHeader,
  float32ToInt16Buffer,
  SAMPLE_RATE,
  BYTES_PER_SECOND,
  WAV_HEADER_SIZE
};

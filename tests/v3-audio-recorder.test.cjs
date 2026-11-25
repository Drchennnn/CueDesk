'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createAudioRecorder,
  buildWavHeader,
  float32ToInt16Buffer,
  SAMPLE_RATE,
  WAV_HEADER_SIZE
} = require('../meeting-copilot/tools/audio-recorder.cjs');

test('audio-recorder writes valid dual-track 16kHz PCM WAV headers and supports list/read/discard', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const events = [];
  const rec = createAudioRecorder({
    defaultDir: tmp,
    onStateChange: (st) => events.push(st)
  });

  const st0 = rec.start({ sessionId: 'sess_abc_123', sessionName: '测试面试', role: '测试岗', audioSource: 'system' });
  assert.equal(st0.active, true);
  assert.equal(st0.sessionId, 'sess_abc_123');

  // Feed 0.5 second (8000 samples) of sine wave on 'them' and 0.25 second (4000 samples) on 'me'
  const themPcm = new Float32Array(8000);
  for (let i = 0; i < themPcm.length; i++) themPcm[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 0.5;
  const mePcm = new Float32Array(4000);
  for (let i = 0; i < mePcm.length; i++) mePcm[i] = Math.sin((2 * Math.PI * 880 * i) / SAMPLE_RATE) * 0.25;

  rec.writePcm(themPcm.buffer, 'them');
  rec.writePcm(mePcm.buffer, 'me');

  const stopped = rec.stop();
  assert.equal(stopped.ok, true);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.meta.tracks.length, 2);

  const listed = rec.list('sess_abc_123');
  assert.equal(listed.takes.length, 1);
  const take = listed.takes[0];
  assert.equal(take.tracks.length, 2);

  // Verify RIFF/WAV header fields on 'them' track
  const readThem = rec.readTrack({ sessionId: 'sess_abc_123', takeId: take.takeId, channel: 'them' });
  assert.equal(readThem.mime, 'audio/wav');
  assert.equal(readThem.size, WAV_HEADER_SIZE + 8000 * 2);
  assert.equal(readThem.data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(readThem.data.toString('ascii', 8, 12), 'WAVE');
  assert.equal(readThem.data.readUInt32LE(24), 16000);
  assert.equal(readThem.data.readUInt16LE(22), 1);
  assert.equal(readThem.data.readUInt16LE(34), 16);
  assert.equal(readThem.data.readUInt32LE(40), 8000 * 2);

  // Empty second take should not leave ghost files on disk
  rec.start({ sessionId: 'sess_abc_123' });
  const emptyStop = rec.stop();
  assert.equal(emptyStop.meta, null);
  assert.equal(rec.list('sess_abc_123').takes.length, 1);

  // Discard removes session recordings cleanly
  rec.discardSession('sess_abc_123');
  assert.equal(rec.list('sess_abc_123').takes.length, 0);
  assert(events.length >= 2);
});

test('float32ToInt16Buffer clamps out-of-range and NaN samples safely', () => {
  const buf = float32ToInt16Buffer(new Float32Array([1.5, -2.0, 0, Number.NaN]));
  assert.equal(buf.readInt16LE(0), 32767);
  assert.equal(buf.readInt16LE(2), -32768);
  assert.equal(buf.readInt16LE(4), 0);
  assert.equal(buf.readInt16LE(6), 0);
  assert.equal(buildWavHeader(100).length, 44);
});

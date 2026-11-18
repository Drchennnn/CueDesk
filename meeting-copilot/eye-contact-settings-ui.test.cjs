const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const slots = [], effects = [], calls = [], refs = [];
  let slot = 0, effect = 0, listener, cleanup = [];
  const state = { enabled: true, phase: 'ready', preview: {}, sessionId: 8, virtualCamera: 'Virtual Camera' };
  const config = { sourceDeviceId: 'cam1', sourceDeviceName: 'Integrated Camera', outputMode: 'correct', releaseWhenIdle: true,
    restartOnFailure: true, lookAway: false, temporal: 4294967295, eyeSize: 3, idleGraceMs: 3000 };
  const preview = { active: false, stops: 0, listDevices: async () => [{ deviceId: 'cam1', label: 'Integrated Camera', kind: 'videoinput' }],
    start: async value => { calls.push(['preview', value]); preview.active = true; },
    stop: () => { preview.stops++; preview.active = false; }, isActive: () => preview.active };
  const ctx = { reactExports: {
    useState(initial) { const i = slot++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = slot++; if (!(i in slots)) slots[i] = { current: initial }; refs.push(slots[i]); return slots[i]; },
    useEffect(fn, deps) { const i = effect++; if (!effects[i] || deps.some((v, k) => v !== effects[i].deps[k])) { effects[i]?.cleanup?.(); effects[i] = { deps, fn }; } }
  }, jsxRuntimeExports: { jsx: (tag, props) => ({ tag, props }), jsxs: (tag, props) => ({ tag, props }) },
    createEyeContactPreview: () => preview, eyeContactStatus: () => 'ready',
    window: { mc: {
      getEyeContactState: async () => state, getEyeContactSettings: async () => config,
      onEyeContactState: fn => { listener = fn; return () => {}; },
      setEyeContactSettings: async value => { calls.push(['save', value]); return { ...config, ...value }; },
      setEyeContactEnabled: async value => { calls.push(['enabled', value]); return { ...state, enabled: value }; },
      restartEyeContact: async () => { calls.push(['restart']); return state; }, reportEyeContactPreview: async () => {},
      getEyeContactDiagnostics: async () => ({ state })
    } }, navigator: { clipboard: { writeText: async () => {} } } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/eye-contact-settings-ui.js', 'utf8'), ctx);
  function render(active = true) {
    slot = 0; effect = 0;
    const tree = ctx.EyeContactSettings({ active });
    for (const item of effects) if (item.fn) { item.cleanup = item.fn(); item.fn = null; }
    return tree;
  }
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  }
  return { render, nodes, calls, preview, emit: value => listener(value), cleanup() { effects.forEach(item => item.cleanup?.()); } };
}

test('settings save a selected processing mode without restarting or opening a camera', async t => {
  const f = fixture(); t.after(() => f.cleanup()); f.render(); await flush();
  const tree = f.render();
  const select = f.nodes(tree).find(node => node.tag === 'select' && node.props.value === 'correct');
  await select.props.onChange({ target: { value: 'passthrough' } }); await flush();
  assert.equal(f.calls[0][0], 'save'); assert.equal(f.calls[0][1].outputMode, 'passthrough');
  assert.equal(f.calls.some(call => ['restart', 'enabled', 'preview'].includes(call[0])), false);
});

test('leaving the camera tab and unmounting stop preview resources', async t => {
  const f = fixture(); t.after(() => f.cleanup()); f.render(); await flush();
  f.preview.active = true; const before = f.preview.stops; f.render(false);
  assert.equal(f.preview.active, false); assert.ok(f.preview.stops > before);
  f.preview.active = true; f.cleanup(); assert.equal(f.preview.active, false);
});

test('a recovering engine stops an active preview once, avoiding an IPC feedback loop', async t => {
  const f = fixture(); t.after(() => f.cleanup()); f.render(); await flush();
  f.preview.active = true; const before = f.preview.stops;
  f.emit({ enabled: true, phase: 'restarting' }); f.emit({ enabled: true, phase: 'restarting' });
  assert.equal(f.preview.stops, before + 1);
});

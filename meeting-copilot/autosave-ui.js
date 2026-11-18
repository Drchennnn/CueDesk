// Serialized, debounced saves shared by independently persisted settings panels.
const settingsAutoFlushers = new Set();
function createAutoSaveQueue(write, notify = () => {}, delay = 550) {
  let baseline, latest, timer, running = null, failed, disposed = false;
  const key = value => JSON.stringify(value);
  function seed(value) { baseline = key(value); latest = value; }
  async function flush() {
    clearTimeout(timer);
    if (running) { await running; return flush(); }
    if (!latest || key(latest) === baseline) return true;
    if (key(latest) === failed) return false;
    const value = latest, signature = key(value); notify('saving');
    running = (async () => {
      try { await write(value); baseline = signature; failed = null; if (!disposed) notify(key(latest) === baseline ? 'saved' : 'pending'); }
      catch (error) { failed = signature; if (!disposed) notify('error', error.message); }
    })();
    await running; running = null;
    if (key(latest) !== baseline && key(latest) !== failed) return flush();
    return key(latest) === baseline;
  }
  function update(value) {
    latest = value; clearTimeout(timer);
    if (baseline === undefined) { seed(value); return; }
    if (key(value) === baseline) return;
    if (key(value) !== failed) { notify('pending'); timer = setTimeout(flush, delay); }
  }
  return { seed, update, flush, dispose() { disposed = true; clearTimeout(timer); } };
}
function useAutoSaveValue(value, write, onSaved) {
  const [status, setStatus] = reactExports.useState('saved'), [error, setError] = reactExports.useState('');
  const latest = reactExports.useRef({ value, write, onSaved }); latest.current = { value, write, onSaved };
  const queue = reactExports.useRef(null);
  if (!queue.current) queue.current = createAutoSaveQueue(async snapshot => {
    const result = await latest.current.write(snapshot);
    if (JSON.stringify(latest.current.value) === JSON.stringify(snapshot)) latest.current.onSaved?.(result);
  }, (state, message) => { setStatus(state); setError(message || ''); });
  reactExports.useEffect(() => { if (value !== null) queue.current.update(value); }, [JSON.stringify(value)]);
  reactExports.useEffect(() => { const flush = () => queue.current.flush(); settingsAutoFlushers.add(flush); return () => { settingsAutoFlushers.delete(flush); void queue.current.flush(); queue.current.dispose(); }; }, []);
  return { status, error, flush: () => queue.current.flush() };
}
if (typeof module !== 'undefined') module.exports = { createAutoSaveQueue };

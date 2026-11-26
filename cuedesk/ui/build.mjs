import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const DOCS_LINKS_IMPORT = './docsLinks-DacHPHnf.js';

const reactHooksAndApis = [
  'Activity', 'Children', 'Component', 'Fragment', 'Profiler', 'PureComponent',
  'StrictMode', 'Suspense', 'cache', 'cloneElement', 'createContext', 'createElement',
  'createRef', 'forwardRef', 'isValidElement', 'lazy', 'memo', 'startTransition',
  'use', 'useActionState', 'useCallback', 'useContext', 'useDebugValue',
  'useDeferredValue', 'useEffect', 'useId', 'useImperativeHandle', 'useInsertionEffect',
  'useLayoutEffect', 'useMemo', 'useOptimistic', 'useReducer', 'useRef', 'useState',
  'useSyncExternalStore', 'useTransition'
];

const docsLinksBridgePlugin = {
  name: 'mc-docs-links-bridge',
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'mc-bridge' }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'react/jsx-runtime', namespace: 'mc-bridge' }));
    build.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: 'react-dom/client', namespace: 'mc-bridge' }));
    build.onResolve({ filter: /^@mc\/runtime$/ }, () => ({ path: '@mc/runtime', namespace: 'mc-bridge' }));

    build.onLoad({ filter: /.*/, namespace: 'mc-bridge' }, (args) => {
      if (args.path === 'react') {
        const exports = reactHooksAndApis.map((name) => `export const ${name} = r.${name};`).join('\n');
        return {
          contents: `import { R, r } from "${DOCS_LINKS_IMPORT}";\nexport default R;\n${exports}\n`,
          loader: 'js'
        };
      }
      if (args.path === 'react/jsx-runtime') {
        return {
          contents: `import { j } from "${DOCS_LINKS_IMPORT}";\nexport const jsx = j.jsx;\nexport const jsxs = j.jsxs;\nexport const Fragment = j.Fragment;\n`,
          loader: 'js'
        };
      }
      if (args.path === 'react-dom/client') {
        return {
          contents: `import { h } from "${DOCS_LINKS_IMPORT}";\nexport const createRoot = h.createRoot;\nexport const hydrateRoot = h.hydrateRoot;\nexport default h;\n`,
          loader: 'js'
        };
      }
      if (args.path === '@mc/runtime') {
        return {
          contents: `export {
  C as ConnectionResult,
  D as DOCS,
  L as LOCAL_REALTIME_MODELS,
  M as MicCapture,
  P as PROVIDER_HELP,
  a as findPresetById,
  b as providerIdForEndpoint,
  c as candidateKeyTest,
  d as storedKeyTest,
  e as docUrl,
  f as findPresetByEndpoint,
  g as LoopbackCapture,
  i as isTestableTarget,
  l as listMics,
  o as orderTestTargets,
  p as presetsForCapability,
  s as sanitizeApiKeyInput,
  t as targetFromPreset
} from "${DOCS_LINKS_IMPORT}";\n`,
          loader: 'js'
        };
      }
      return null;
    });
  }
};

fs.mkdirSync(DIST, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(HERE, 'src', 'main.jsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome128'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  outfile: path.join(DIST, 'index-hyFYaQxP.js'),
  external: [DOCS_LINKS_IMPORT],
  plugins: [docsLinksBridgePlugin],
  loader: {
    '.png': 'dataurl'
  },
  minify: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

// Bundle CSS separately with deterministic target filename matching index.html
const cssEntry = path.join(HERE, 'src', 'styles', 'app.css');
if (fs.existsSync(cssEntry)) {
  await esbuild.build({
    entryPoints: [cssEntry],
    bundle: true,
    outfile: path.join(DIST, 'index-BJg-OUFD.css'),
    minify: false
  });
}

console.log('[ui-build] Built dist/index-hyFYaQxP.js and dist/index-BJg-OUFD.css');

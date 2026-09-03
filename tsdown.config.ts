import { defineConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-live2d-avatar'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    name: PACKAGE_ID,
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    outDir: 'lib',
    clean: true,
    deps: { neverBundle: [/@deepseek-ai\//, 'electron'] },
    outputOptions: { entryFileNames: 'index.mjs' },
  },
  {
    name: `${PACKAGE_ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    outDir: 'lib',
    dts: false,
    clean: false,
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    deps: {
      neverBundle: (id: string) => CLIENT_EXTERNALS.includes(id) ? true : undefined,
      alwaysBundle: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
  {
    name: `${PACKAGE_ID}/pet-window`,
    entry: { 'pet-window': 'src/pet-window.ts' },
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outDir: 'lib',
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      alwaysBundle: (id: string) => id === 'l2d' ? true : undefined,
    },
    outputOptions: { entryFileNames: 'pet-window.js' },
  },
])

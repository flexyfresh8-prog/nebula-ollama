/* Browser shim for QA — fakes the Neutralino native API with a virtual FS.
   Loaded only by dev/serve.mjs (never shipped in the real app). */
(() => {
  const VFS = new Map([
    ['/home/z/demo-project', { type: 'DIRECTORY' }],
    ['/home/z/demo-project/README.md', { type: 'FILE', data: '# Demo Project\nA tiny mock workspace for QA.\n' }],
    ['/home/z/demo-project/src', { type: 'DIRECTORY' }],
    ['/home/z/demo-project/src/main.py', { type: 'FILE', data: 'import utils\n\ndef run():\n    print(utils.greet("nebula"))\n\n# TODO: add CLI args\nrun()\n' }],
    ['/home/z/demo-project/src/utils.js', { type: 'FILE', data: 'export const greet = (name) => `hello, ${name}!`;\n// TODO: unit tests\n' }],
    ['/home/z/demo-project/notes', { type: 'DIRECTORY' }],
    ['/home/z/demo-project/notes/todo.md', { type: 'FILE', data: '- ship nebula\n- polish particles\n' }],
  ]);

  const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '') || '/';

  window.Neutralino = {
    init() { },
    events: { on: (_n, cb) => setTimeout(cb, 0) },
    app: { exit: async () => console.log('[shim] app.exit') },
    window: {
      minimize: async () => console.log('[shim] minimize'),
      maximize: async () => console.log('[shim] maximize'),
      drag: async () => console.log('[shim] drag'),
      setTitle: async () => { },
    },
    os: {
      showFolderDialog: async () => '/home/z/demo-project',
      showOpenDialog: async () => ['/home/z/demo-project/README.md'],
    },
    filesystem: {
      async readDirectory(p) {
        p = norm(p);
        if (!VFS.has(p) || VFS.get(p).type !== 'DIRECTORY') throw new Error('no such directory: ' + p);
        const seen = new Set();
        const out = [];
        for (const [path, meta] of VFS) {
          if (!path.startsWith(p + '/')) continue;
          const rest = path.slice(p.length + 1);
          const name = rest.split('/')[0];
          if (seen.has(name)) continue;
          seen.add(name);
          const isDir = VFS.get(p + '/' + name)?.type === 'DIRECTORY' || rest.includes('/');
          out.push({ entry: name, path: p + '/' + name, type: isDir ? 'DIRECTORY' : 'FILE' });
        }
        return out;
      },
      async readFile(p) {
        const e = VFS.get(norm(p));
        if (!e || e.type !== 'FILE') throw new Error('no such file: ' + p);
        return e.data;
      },
      async writeFile(p, data) {
        VFS.set(norm(p), { type: 'FILE', data: String(data) });
      },
      async createDirectory(p) {
        VFS.set(norm(p), { type: 'DIRECTORY' });
      },
      async getStats(p) {
        const e = VFS.get(norm(p));
        if (!e) throw new Error('no stats: ' + p);
        return { size: (e.data || '').length, isDir: e.type === 'DIRECTORY' };
      },
    },
  };
  console.log('[shim] Neutralino mocked, virtual workspace at /home/z/demo-project');
})();

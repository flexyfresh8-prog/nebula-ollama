/* Mock Ollama server for headless QA — emulates the endpoints Nebula uses. */
import http from 'http';

const PORT = 11434;

const MODELS = [
  { name: 'qwen3:8b', model: 'qwen3:8b', size: 5.2e9, details: { family: 'qwen2', parameter_size: '8.2B', quantization_level: 'Q4_K_M' } },
  { name: 'llama3.2:3b', model: 'llama3.2:3b', size: 2.0e9, details: { family: 'llama', parameter_size: '3.2B', quantization_level: 'Q4_K_M' } },
  { name: 'qwen2.5-coder:7b', model: 'qwen2.5-coder:7b', size: 4.7e9, details: { family: 'qwen2', parameter_size: '7.6B', quantization_level: 'Q4_K_M' } },
  { name: 'deepseek-r1:7b', model: 'deepseek-r1:7b', size: 4.7e9, details: { family: 'qwen2', parameter_size: '7.2B', quantization_level: 'Q4_K_M' } },
  { name: 'gemma3:4b', model: 'gemma3:4b', size: 3.3e9, details: { family: 'gemma3', parameter_size: '4.3B', quantization_level: 'Q4_K_M' } },
];
const CAPS = {
  'qwen3:8b': ['completion', 'tools', 'thinking'],
  'llama3.2:3b': ['completion', 'tools'],
  'qwen2.5-coder:7b': ['completion', 'tools'],
  'deepseek-r1:7b': ['completion', 'thinking'],
  'gemma3:4b': ['completion'],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const VFS = {
  '/home/z/demo-project/README.md': '# Demo Project\nA tiny mock workspace for QA.\n',
  '/home/z/demo-project/src/main.py': 'import utils\n\ndef run():\n    print(utils.greet("nebula"))\n\n# TODO: add CLI args\nrun()\n',
  '/home/z/demo-project/src/utils.js': 'export const greet = (name) => `hello, ${name}!`;\n// TODO: unit tests\n',
  '/home/z/demo-project/notes/todo.md': '- ship nebula\n- polish particles\n',
};

const server = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const sendJSON = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bodyRaw = Buffer.concat(chunks).toString('utf8');
  let body = {};
  try { body = JSON.parse(bodyRaw || '{}'); } catch { }

  const url = new URL(req.url, 'http://x');
  console.log('[mock]', req.method, url.pathname);

  if (url.pathname === '/api/tags') return sendJSON({ models: MODELS });

  if (url.pathname === '/api/ps') {
    return sendJSON({
      models: [{
        name: 'qwen3:8b', model: 'qwen3:8b', size: 5.2e9, size_vram: 5.2e9,
        expires_at: new Date(Date.now() + 3600e3).toISOString(),
      }],
    });
  }

  if (url.pathname === '/api/show') {
    const name = body.model || '';
    return sendJSON({ license: {}, capabilities: CAPS[name] || ['completion'], details: { family: 'mock', parameter_size: '1B' } });
  }

  if (url.pathname === '/api/generate') {
    await sleep(600); /* simulate pulling weights into memory */
    return sendJSON({ model: body.model, done: true, done_reason: 'load' });
  }

  if (url.pathname === '/api/chat') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', ...cors });
    const send = obj => res.write(JSON.stringify(obj) + '\n');
    const lastUser = [...(body.messages || [])].reverse().find(m => m.role === 'user');
    const text = (lastUser?.content || '') + ' ' + (body.messages || []).filter(m => m.role === 'tool').map(m => m.content).join(' ');

    /* tool calls? (only on the first round — once tool results exist, answer) */
    const hasToolMsg = (body.messages || []).some(m => m.role === 'tool');
    if (body.tools && !hasToolMsg && /list|show|what.s in|files|workspace|todo|write|create|add/i.test(text)) {
      await sleep(400);
      send({ model: body.model, message: { role: 'assistant', content: '' }, done: false });
      if (/todo/i.test(text)) {
        send({ model: body.model, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_files', arguments: { query: 'TODO' } } }] }, done: false });
      } else if (/write|create|add/i.test(text)) {
        send({ model: body.model, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: 'notes/nebula.txt', content: 'written by the mock AI' } } }] }, done: false });
      } else {
        send({ model: body.model, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'list_files', arguments: { path: '' } } }] }, done: false });
      }
      send({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 12, eval_duration: 1.2e9, total_duration: 1.3e9 });
      return res.end();
    }

    /* thinking then content */
    if (body.think) {
      const think = 'The user asked something simple. I will answer directly and briefly. ';
      for (const w of think.split(' ')) { send({ model: body.model, message: { role: 'assistant', thinking: w + ' ' }, done: false }); await sleep(24); }
    }
    const reply = `**mock reply** to: “${(lastUser?.content || '…').slice(0, 80)}”\n\n\`\`\`python\nprint("hello from the mock ollama server")\n\`\`\`\nEverything below this line proves streaming works — particles, markdown, meta stats.\n\n- streaming ✅\n- markdown ✅\n- effort slider ✅\n`;
    for (const ch of reply.match(/.{1,7}/gs) || []) { send({ model: body.model, message: { role: 'assistant', content: ch }, done: false }); await sleep(26); }
    send({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: reply.length / 3 | 0, eval_duration: 2.4e9, total_duration: 3.1e9 });
    return res.end();
  }

  sendJSON({ error: 'not found' }, 404);
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock ollama on http://127.0.0.1:${PORT}`));

/* ============================================================
   NEBULA · md.js — tiny safe markdown → HTML renderer.
   Escape-first: all source text is escaped before any tags are
   generated, so model output can never inject markup.
   Supports: fenced code, inline code, bold/italic, strike,
   headings, links, lists, blockquotes, hr, tables (loose).
   ============================================================ */
(() => {
  'use strict';

  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const safeUrl = u => {
    const t = String(u).trim();
    return /^(https?:\/\/|mailto:)/i.test(t) ? t : '#';
  };

  /* inline pass — operates on already-escaped text */
  const inline = t => {
    let out = '';
    let rest = t;
    const stash = [];
    /* stash inline code first so other rules never touch it */
    rest = rest.replace(/`([^`\n]+)`/g, (_, code) => {
      stash.push('<code>' + code + '</code>');
      return '\u0000' + (stash.length - 1) + '\u0000';
    });
    out = rest
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?'"]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?'"]|$)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
        `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${label}</a>`)
      .replace(/ {2,}\n/g, '<br/>\n');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  };

  const render = src => {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    const flushList = (tag, items) => {
      if (items.length) out.push(`<${tag}>` + items.map(x => `<li>${x}</li>`).join('') + `</${tag}>`);
    };

    while (i < lines.length) {
      const line = lines[i];

      /* fenced code */
      const fence = line.match(/^\s*```(\w*)\s*$/);
      if (fence) {
        const lang = fence[1] || 'text';
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
        i++; /* closing fence (or EOF) */
        out.push(
          '<pre><div class="code-head"><span>' + esc(lang) + '</span>' +
          '<button class="code-copy" type="button">copy</button></div>' +
          '<code>' + esc(body.join('\n')) + '</code></pre>'
        );
        continue;
      }

      /* blank */
      if (!line.trim()) { i++; continue; }

      /* hr */
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push('<hr/>'); i++; continue; }

      /* headings */
      const h = line.match(/^\s{0,3}(#{1,4})\s+(.*)$/);
      if (h) { const n = h[1].length; out.push(`<h${n}>${inline(esc(h[2].trim()))}</h${n}>`); i++; continue; }

      /* blockquote */
      if (/^\s{0,3}>\s?/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
          body.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + render(body.join('\n')) + '</blockquote>');
        continue;
      }

      /* unordered list */
      if (/^\s{0,4}[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s{0,4}[-*+]\s+/.test(lines[i])) {
          items.push(inline(esc(lines[i].replace(/^\s{0,4}[-*+]\s+/, ''))));
          i++;
        }
        flushList('ul', items);
        continue;
      }

      /* ordered list */
      if (/^\s{0,4}\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s{0,4}\d+[.)]\s+/.test(lines[i])) {
          items.push(inline(esc(lines[i].replace(/^\s{0,4}\d+[.)]\s+/, ''))));
          i++;
        }
        flushList('ol', items);
        continue;
      }

      /* loose table: header row, |---|---| separator */
      if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push('<table><thead><tr>' + head.map(c => `<th>${inline(esc(c))}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => `<td>${inline(esc(c))}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }

      /* paragraph — gather until blank / block start */
      const para = [line];
      i++;
      while (
        i < lines.length && lines[i].trim() &&
        !/^\s*```/.test(lines[i]) && !/^\s{0,3}#{1,4}\s/.test(lines[i]) &&
        !/^\s{0,3}>\s?/.test(lines[i]) && !/^\s{0,4}[-*+]\s+/.test(lines[i]) &&
        !/^\s{0,4}\d+[.)]\s+/.test(lines[i]) && !/^\s*\|.+\|\s*$/.test(lines[i])
      ) { para.push(lines[i]); i++; }
      out.push('<p>' + inline(esc(para.join('\n').replace(/\n/g, ' ⏎ ').replace(/ ⏎ /g, ' '))).replace(/ ⏎ /g, ' ') + '</p>');
    }

    return out.join('\n');
  };

  window.NebulaMD = { render };
})();

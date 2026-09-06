// The smallest DOM helper that makes the rest of the UI readable. No framework:
// this app has one state object and redraws from it, so a builder plus
// replaceChildren is the whole story.

export function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function fill(node, ...children) {
  node.replaceChildren(...children.flat(4).filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

/** Deliberately tiny: headings, lists, code, bold, tables. Enough for a report. */
export function renderMarkdown(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  const out = [];
  const lines = md.split('\n');
  let i = 0;
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // A markdown table becomes a real table so the validation view can style it.
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      closeList();
      const cells = (l) =>
        l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(cells(lines[i++]));
      out.push('<table class="tbl"><thead><tr>');
      head.forEach((c) => out.push(`<th>${inline(c)}</th>`));
      out.push('</tr></thead><tbody>');
      for (const row of body) {
        const txt = row.join(' ').toLowerCase();
        const cls = /\bpass\b|✅|✔/.test(txt) ? 'pass' : /\bfail\b|❌|✗/.test(txt) ? 'fail' : '';
        out.push(`<tr class="${cls}">`);
        row.forEach((c) => {
          const num = /^[-+]?[\d.]+%?$/.test(c);
          out.push(`<td class="${num ? 'num' : ''}">${inline(c)}</td>`);
        });
        out.push('</tr>');
      }
      out.push('</tbody></table>');
      continue;
    }

    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      closeList();
      out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`);
      i += 1;
      continue;
    }
    const lm = line.match(/^\s*[-*]\s+(.*)$/);
    if (lm) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(lm[1])}</li>`);
      i += 1;
      continue;
    }
    if (!line.trim()) {
      closeList();
      i += 1;
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
    i += 1;
  }
  closeList();
  return out.join('');
}

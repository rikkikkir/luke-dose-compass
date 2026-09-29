/* Luke's Dose Compass — a very small markdown renderer.

   Deliberately tiny: it handles exactly the subset this app emits, and nothing
   else. A document meant to be read by a vet, or by someone standing in for
   Rikki at short notice, cannot show asterisks and hashes. */

/* A very small renderer for exactly the markdown this file emits. The document
   is meant to be read by a vet, and asterisks on screen do not read as a
   document. The copy button still hands over the markdown, which is what a
   message or a chat wants. */
export function toHtml(md) {
  const inline = (t) => t
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>');

  const out = [];
  let list = false;
  const closeList = () => { if (list) { out.push('</ul>'); list = false; } };

  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line) { closeList(); continue; }
    if (line === '---') { closeList(); out.push('<hr>'); continue; }
    if (line.startsWith('## ')) { closeList(); out.push(`<h3>${inline(line.slice(3))}</h3>`); continue; }
    if (line.startsWith('# ')) { closeList(); out.push(`<h2>${inline(line.slice(2))}</h2>`); continue; }
    if (line.startsWith('- ')) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    // A line that only continues the one above it (two-space markdown break).
    if (/^\s{2,}/.test(raw) && list) { out.push(`<li class="cont">${inline(line.trim())}</li>`); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}


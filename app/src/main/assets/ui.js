'use strict'
/* ============================================================================
   OpenCode Unofficial — UI toolkit (v1.0)
   Pure helpers used by app.js: icons, safe Markdown, code highlighting, list
   choreography, ripple, haptics, clipboard, composer and sheet behaviour.
   Nothing in here talks to the network or touches credentials.
   ========================================================================== */

/* ── Escaping & small utilities ─────────────────────────────────────────── */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ESC_MAP[ch]) }
function icon(name, cls = '') { return `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>` }

function relTime(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60e3) return 'Just now'
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}m ago`
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h ago`
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)}d ago`
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function dayLabel(ms) {
  if (!ms) return 'Earlier'
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const day = 86400e3
  if (ms >= start.getTime()) return 'Today'
  if (ms >= start.getTime() - day) return 'Yesterday'
  if (ms >= start.getTime() - 6 * day) return 'This week'
  return 'Earlier'
}

function monogram(name) {
  const text = String(name || '?').trim()
  const parts = text.split(/[\s_-]+/).filter(Boolean)
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase()
  const camel = text.slice(1).search(/[A-Z]/)
  return (camel >= 0 ? text[0] + text[camel + 1] : text.slice(0, 2)).toUpperCase()
}

function hueOf(text) {
  let hash = 0
  for (const ch of String(text)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return 170 + (hash % 170) // teal → violet → pink, matching the brand palette
}

/* ── Placeholders ───────────────────────────────────────────────────────── */
function skeletons(count = 3) { return '<div class="skeleton"></div>'.repeat(count) }

function emptyState({ ic = 'sparkle', title = '', text = '', action = '' } = {}) {
  return `<div class="empty"><div class="empty-ico">${icon(ic)}</div>${title ? `<strong>${esc(title)}</strong>` : ''}${text ? `<span>${esc(text)}</span>` : ''}${action}</div>`
}

/* Replace a list's content. `animate` decides whether the children replay the
   staggered entrance (true after navigation/loads, false for in-place updates
   such as typing in search or changing the selected model). */
function setList(el, html, animate = true) {
  if (!el) return
  el.dataset.anim = animate ? '1' : '0'
  if (el.__html !== html) {
    el.__html = html
    el.innerHTML = html
  }
  Array.from(el.children).forEach((child, index) => child.style.setProperty('--i', Math.min(index, 9)))
}

/* ── Haptics & clipboard ────────────────────────────────────────────────── */
function tap() { try { if (window.AndroidDevice && typeof window.AndroidDevice.tap === 'function') window.AndroidDevice.tap() } catch (_) {} }

function copyText(text) {
  const legacy = () => {
    const area = document.createElement('textarea')
    area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;top:0;opacity:0'
    document.body.appendChild(area); area.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch (_) {}
    area.remove()
    return ok
  }
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true).catch(legacy)
  return Promise.resolve(legacy())
}

/* ── Syntax highlighting (small, dependency-free) ───────────────────────── */
const words = (list) => new Set(list.split(/\s+/))
const KEYWORDS = {
  c: words('abstract as async await boolean break byte case catch char class const continue debugger default defer delete do double else enum export extends false final finally float fn for from func function get go if impl implements import in instanceof int interface let long loop match mod move mut namespace new null of override package private protected pub public readonly ref return select self set short static struct super switch this throw throws trait true try type typeof undefined unsafe use using val var virtual void volatile where while with yield'),
  py: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return self try while with yield True False print'),
  sh: words('if then else elif fi for while until do done case esac in function return export local echo cd exit set unset source alias sudo'),
  hash: words('true false null nil yes no on off'),
  sql: words('select from where insert into values update set delete create table alter drop join left right inner outer on group by order limit having as and or not null distinct union index primary key foreign references case when then else end asc desc like in is between exists'),
  json: words('true false null'),
}
const FAMILIES = {
  c: { comment: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/, kw: KEYWORDS.c, fn: true, types: true },
  py: { comment: /#[^\n]*/, kw: KEYWORDS.py, fn: true, types: true },
  sh: { comment: /#[^\n]*/, kw: KEYWORDS.sh },
  hash: { comment: /#[^\n]*/, kw: KEYWORDS.hash, key: true },
  sql: { comment: /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/, kw: KEYWORDS.sql, ci: true },
  json: { comment: null, kw: KEYWORDS.json, key: true },
  css: { comment: /\/\*[\s\S]*?(?:\*\/|$)/, kw: new Set(), prop: true, word: /-?[A-Za-z_][\w-]*/ },
  xml: { comment: /<!--[\s\S]*?(?:-->|$)/, kw: new Set() },
}
const LANGUAGE_FAMILY = {}
;[
  ['c', 'js jsx ts tsx javascript typescript mjs cjs java c h cpp cc hpp c++ cs csharp go rust rs kotlin kt swift php dart scala'],
  ['py', 'py python'], ['sh', 'sh bash shell zsh console'], ['hash', 'yaml yml toml ini conf dockerfile rb ruby'],
  ['sql', 'sql'], ['json', 'json jsonc'], ['css', 'css scss less'], ['xml', 'html xml svg vue'],
].forEach(([family, names]) => names.split(' ').forEach((name) => { LANGUAGE_FAMILY[name] = family }))

const R_STRING = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/.source
const R_NUMBER = /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/.source
const tokenizers = {}

function tokenizerFor(name) {
  if (!tokenizers[name]) {
    const family = FAMILIES[name]
    const comment = family.comment ? family.comment.source : '(?!)'
    const word = (family.word || /[A-Za-z_$][\w$]*/).source
    tokenizers[name] = new RegExp(`(${comment})|(${R_STRING})|(${R_NUMBER})|(${word})`, 'g')
  }
  tokenizers[name].lastIndex = 0
  return tokenizers[name]
}

function highlightCode(code, lang) {
  const familyName = LANGUAGE_FAMILY[String(lang || '').toLowerCase()]
  if (!familyName || code.length > 40000) return esc(code)
  const family = FAMILIES[familyName]
  const re = tokenizerFor(familyName)
  let out = ''
  let last = 0
  let match
  while ((match = re.exec(code))) {
    out += esc(code.slice(last, match.index))
    const token = match[0]
    const next = code.slice(re.lastIndex).match(/^\s*(:)?/)
    if (match[1]) out += `<span class="tk-c">${esc(token)}</span>`
    else if (match[2]) out += `<span class="${family.key && next && next[1] ? 'tk-k' : 'tk-s'}">${esc(token)}</span>`
    else if (match[3]) out += `<span class="tk-n">${esc(token)}</span>`
    else {
      const probe = family.ci ? token.toLowerCase() : token
      if (family.kw.has(probe)) out += `<span class="tk-kw">${esc(token)}</span>`
      else if (family.prop && next && next[1] && code[re.lastIndex] !== ':') out += `<span class="tk-k">${esc(token)}</span>`
      else if (family.types && /^[A-Z][a-z]/.test(token)) out += `<span class="tk-t">${esc(token)}</span>`
      else if (family.fn && code[re.lastIndex] === '(') out += `<span class="tk-f">${esc(token)}</span>`
      else out += esc(token)
    }
    last = re.lastIndex
  }
  return out + esc(code.slice(last))
}

function highlightDiff(code) {
  return code.split('\n').map((line) => {
    const kind = line.startsWith('+') && !line.startsWith('+++') ? ' add' : line.startsWith('-') && !line.startsWith('---') ? ' del' : line.startsWith('@@') ? ' hunk' : ''
    return `<span class="df${kind}">${esc(line) || ' '}</span>`
  }).join('')
}

/* ── Markdown (escape-first, so model output can never inject markup) ──── */
const RX_FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/
const RX_HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/
const RX_HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const RX_LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
const RX_QUOTE = /^\s*>\s?/
const RX_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/

function emphasis(text) {
  return text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
}

function inlineMarkdown(raw) {
  const stash = []
  const keep = (html) => `\u0001${stash.push(html) - 1}\u0001`
  let text = String(raw).replace(/[\u0000\u0001]/g, '')
  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code) => keep(`<code class="inline">${esc(code)}</code>`))
  text = esc(text)
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => keep(`<a class="md-link" href="#" data-href="${url}">${emphasis(label)}</a>`))
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,;:!?])/g, (_, lead, url) => `${lead}${keep(`<a class="md-link" href="#" data-href="${url}">${url}</a>`)}`)
  text = emphasis(text)
  return text.replace(/\u0001(\d+)\u0001/g, (_, index) => stash[Number(index)])
}

const LANG_LABELS = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', console: 'shell', yml: 'yaml', md: 'markdown', rs: 'rust', kt: 'kotlin', rb: 'ruby', cs: 'c#', cpp: 'c++', cc: 'c++', hpp: 'c++', ps1: 'powershell' }
const WRAP_KEY = 'opencode.remote.wrap.v1'

function prettyLang(lang) {
  const key = String(lang || '').toLowerCase()
  return LANG_LABELS[key] || key || 'text'
}

function wrapEnabled() { try { return localStorage.getItem(WRAP_KEY) === '1' } catch (_) { return false } }
function applyWrap() {
  const on = wrapEnabled()
  document.documentElement.classList.toggle('wrap-code', on)
  document.querySelectorAll('[data-wrap]').forEach((button) => button.setAttribute('aria-pressed', on ? 'true' : 'false'))
}
function toggleWrap() {
  try { localStorage.setItem(WRAP_KEY, wrapEnabled() ? '0' : '1') } catch (_) {}
  applyWrap()
}

function codeBlockHtml(code, lang, closed, opts = {}) {
  const key = String(lang || '').toLowerCase()
  const label = opts.label || prettyLang(lang)
  const body = key === 'diff' || key === 'patch' ? highlightDiff(code) : highlightCode(code, key)
  const wrap = `<button class="code-wrap" type="button" data-wrap aria-label="Wrap long lines" aria-pressed="${wrapEnabled()}">${icon('wrap')}</button>`
  return `<div class="code-block${closed ? '' : ' streaming'}"><div class="code-head"><span class="code-lang">${esc(label)}</span><span class="code-tools">${wrap}<button class="code-copy" type="button" data-copy>${icon('copy')}<span>Copy</span></button></span></div><pre><code>${body}</code></pre></div>`
}

function listHtml(items) {
  let html = ''
  const stack = []
  for (const item of items) {
    const tag = item.ordered ? 'ol' : 'ul'
    while (stack.length && item.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`
    const top = stack[stack.length - 1]
    if (!top || item.indent > top.indent) {
      html += `<${tag}${tag === 'ol' && item.start > 1 ? ` start="${item.start}"` : ''}>`
      stack.push({ indent: item.indent, tag })
    } else html += '</li>'
    let body = inlineMarkdown(item.text)
    const task = item.text.match(/^\[( |x|X)\]\s+/)
    if (task) body = `<span class="task${task[1] === ' ' ? '' : ' on'}"></span>${inlineMarkdown(item.text.slice(task[0].length))}`
    html += `<li>${body}`
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`
  return html
}

function tableHtml(head, aligns, rows) {
  const cell = (tag, text, index) => `<${tag}${aligns[index] ? ` class="ta-${aligns[index]}"` : ''}>${inlineMarkdown(text)}</${tag}>`
  return `<div class="table-wrap"><table><thead><tr>${head.map((text, i) => cell('th', text, i)).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${head.map((_, i) => cell('td', row[i] || '', i)).join('')}</tr>`).join('')}</tbody></table></div>`
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())

function startsBlock(lines, i) {
  const line = lines[i]
  return RX_FENCE.test(line) || RX_HEADING.test(line) || RX_HR.test(line) || RX_QUOTE.test(line) || RX_LIST.test(line) ||
    (line.includes('|') && i + 1 < lines.length && RX_TABLE_SEP.test(lines[i + 1]))
}

function renderMarkdown(source, options = {}) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    let m = line.match(RX_FENCE)
    if (m) {
      const fence = m[1]
      const buffer = []
      let closed = false
      i += 1
      while (i < lines.length) {
        if (new RegExp(`^\\s*\\${fence[0]}{${fence.length},}\\s*$`).test(lines[i])) { closed = true; i += 1; break }
        buffer.push(lines[i]); i += 1
      }
      out.push(codeBlockHtml(buffer.join('\n'), m[2], closed))
      continue
    }
    if (/^\s*$/.test(line)) { i += 1; continue }
    if (RX_HR.test(line)) { out.push('<hr>'); i += 1; continue }
    if ((m = line.match(RX_HEADING))) {
      const level = Math.min(m[1].length + 2, 6)
      out.push(`<h${level}>${inlineMarkdown(m[2])}</h${level}>`); i += 1
      continue
    }
    if (RX_QUOTE.test(line)) {
      const buffer = []
      while (i < lines.length && RX_QUOTE.test(lines[i])) { buffer.push(lines[i].replace(RX_QUOTE, '')); i += 1 }
      out.push(`<blockquote>${renderMarkdown(buffer.join('\n'))}</blockquote>`)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && RX_TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line)
      const aligns = splitRow(lines[i + 1]).map((cell) => (/^:-+:$/.test(cell) ? 'c' : /-:$/.test(cell) ? 'r' : ''))
      const rows = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i += 1 }
      out.push(tableHtml(head, aligns, rows))
      continue
    }
    if (RX_LIST.test(line)) {
      const items = []
      while (i < lines.length) {
        const item = lines[i].match(RX_LIST)
        if (item) {
          const indent = item[1].replace(/\t/g, '    ').length
          // A different list type at the outermost level starts a new list.
          if (items.length && indent <= items[0].indent && /\d/.test(item[2]) !== items[0].ordered) break
          items.push({ indent: item[1].replace(/\t/g, '    ').length, ordered: /\d/.test(item[2]), start: parseInt(item[2], 10) || 1, text: item[3] })
          i += 1
        } else if (items.length && /^\s{2,}\S/.test(lines[i]) && !RX_FENCE.test(lines[i])) {
          items[items.length - 1].text += ` ${lines[i].trim()}`; i += 1
        } else if (items.length && /^\s*$/.test(lines[i]) && i + 1 < lines.length && RX_LIST.test(lines[i + 1])) i += 1
        else break
      }
      out.push(listHtml(items))
      continue
    }
    const paragraph = [line]
    i += 1
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines, i)) { paragraph.push(lines[i]); i += 1 }
    out.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  let html = out.join('')
  if (options.caret) {
    const caret = '<span class="caret"></span>'
    if (/<\/(?:p|h[3-6])>$/.test(html)) html = html.replace(/(<\/(?:p|h[3-6])>)$/, `${caret}$1`)
    else if (/<\/li><\/(?:ul|ol)>$/.test(html)) html = html.replace(/(<\/li><\/(?:ul|ol)>)$/, `${caret}$1`)
    else html += caret
  }
  return html
}

/* ── Tool-call chips ────────────────────────────────────────────────────── */
const TOOL_ICONS = { bash: 'terminal', shell: 'terminal', read: 'file', write: 'edit', edit: 'edit', patch: 'edit', multiedit: 'edit', grep: 'search', glob: 'search', list: 'folder', ls: 'folder', webfetch: 'globe', websearch: 'globe', todowrite: 'list', todoread: 'list', task: 'sparkle', apply_patch: 'edit' }

function toolSummary(part) {
  const state = part.state || {}
  const input = state.input || {}
  const pick = state.title || input.description || input.command || input.filePath || input.path || input.pattern || input.url || input.query || ''
  return String(pick).split('\n')[0].slice(0, 140)
}

const ANSI_RE = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g

function clip(text, max) {
  const clean = String(text ?? '').replace(ANSI_RE, '')
  return clean.length > max ? { text: clean.slice(0, max), more: clean.length - max } : { text: clean, more: 0 }
}

function extLang(path) {
  const match = String(path || '').match(/\.([A-Za-z0-9+#]+)$/)
  return match ? match[1].toLowerCase() : ''
}

function textBlock(label, text, lang = '', max = 12000) {
  const part = clip(text, max)
  if (!part.text.trim()) return ''
  const more = part.more ? `<small class="tool-more">… ${part.more.toLocaleString()} more characters not shown</small>` : ''
  return `<div class="tool-section">${codeBlockHtml(part.text, lang, true, { label })}${more}</div>`
}

/* ── Diffs ──────────────────────────────────────────────────────────────── */
function unifiedRows(text) {
  const rows = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    let m
    if ((m = line.match(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/))) { rows.push({ t: 'file', text: m[1] }); inHunk = true; continue }
    if (/^\*\*\* (?:Begin|End) Patch/.test(line)) continue
    if ((m = line.match(/^diff --git a\/(.+?) b\/(.+)$/))) { rows.push({ t: 'file', text: m[2] }); inHunk = false; continue }
    if (/^Index: /.test(line)) { rows.push({ t: 'file', text: line.slice(7).trim() }); inHunk = false; continue }
    if ((m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/))) { oldNo = Number(m[1]); newNo = Number(m[2]); inHunk = true; rows.push({ t: 'hunk', text: line }); continue }
    if (line.startsWith('@@')) { inHunk = true; oldNo = 0; newNo = 0; rows.push({ t: 'hunk', text: line }); continue }
    if (!inHunk) continue
    if (line.startsWith('\\')) continue
    const numbered = oldNo > 0 || newNo > 0
    if (line.startsWith('+')) { rows.push({ t: 'add', text: line.slice(1), no: numbered ? newNo : undefined }); if (numbered) newNo += 1 }
    else if (line.startsWith('-')) { rows.push({ t: 'del', text: line.slice(1), no: numbered ? oldNo : undefined }); if (numbered) oldNo += 1 }
    else if (line.startsWith(' ')) { rows.push({ t: 'ctx', text: line.slice(1), no: numbered ? newNo : undefined }); if (numbered) { oldNo += 1; newNo += 1 } }
  }
  while (rows.length && rows[rows.length - 1].t === 'ctx' && rows[rows.length - 1].text === '') rows.pop()
  return rows
}

function lineDiffRows(before, after) {
  const a = String(before ?? '').replace(/\r\n?/g, '\n').split('\n')
  const b = String(after ?? '').replace(/\r\n?/g, '\n').split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const rows = a.slice(0, head).map((text) => ({ t: 'ctx', text }))
  if (midA.length * midB.length > 160000) {
    midA.forEach((text) => rows.push({ t: 'del', text }))
    midB.forEach((text) => rows.push({ t: 'add', text }))
  } else {
    const width = midB.length + 1
    const table = new Uint16Array((midA.length + 1) * width)
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * width + j] = midA[i] === midB[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) { rows.push({ t: 'ctx', text: midA[i] }); i += 1; j += 1 }
      else if (j < midB.length && (i === midA.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) { rows.push({ t: 'add', text: midB[j] }); j += 1 }
      else { rows.push({ t: 'del', text: midA[i] }); i += 1 }
    }
  }
  a.slice(a.length - tail).forEach((text) => rows.push({ t: 'ctx', text }))
  return rows
}

function collapseRows(rows, keep = 3) {
  const show = new Array(rows.length).fill(false)
  rows.forEach((row, index) => {
    if (row.t === 'ctx') return
    for (let k = Math.max(0, index - keep); k <= Math.min(rows.length - 1, index + keep); k++) show[k] = true
  })
  const out = []
  let hidden = 0
  rows.forEach((row, index) => {
    if (show[index] || row.t !== 'ctx') {
      if (hidden) { out.push({ t: 'gap', text: `⋯ ${hidden} unchanged line${hidden === 1 ? '' : 's'}` }); hidden = 0 }
      out.push(row)
    } else hidden += 1
  })
  if (hidden && out.length) out.push({ t: 'gap', text: `⋯ ${hidden} unchanged line${hidden === 1 ? '' : 's'}` })
  return out
}

function diffViewHtml(path, rows) {
  const add = rows.filter((row) => row.t === 'add').length
  const del = rows.filter((row) => row.t === 'del').length
  const MAX_ROWS = 600
  const shown = rows.slice(0, MAX_ROWS)
  const body = shown.map((row) => {
    if (row.t === 'hunk') return `<div class="dr hunk"><code>${esc(row.text)}</code></div>`
    if (row.t === 'gap') return `<div class="dr gap"><code>${esc(row.text)}</code></div>`
    if (row.t === 'file') return `<div class="dr file"><code>${esc(row.text)}</code></div>`
    const mark = row.t === 'add' ? '+' : row.t === 'del' ? '−' : ' '
    return `<div class="dr ${row.t}"><i class="dn">${row.no ?? ''}</i><i class="dm">${mark}</i><code>${esc(row.text) || ' '}</code></div>`
  }).join('')
  const more = rows.length > MAX_ROWS ? `<div class="dr gap"><code>⋯ ${rows.length - MAX_ROWS} more lines not shown</code></div>` : ''
  return `<div class="diff-view"><div class="diff-head">${icon('file')}<span class="diff-path">${esc(path || 'Changes')}</span><span class="diff-stat"><b class="a">+${add}</b><b class="d">−${del}</b></span><button class="code-copy" type="button" data-copy-diff>${icon('copy')}<span>Copy</span></button></div><div class="diff-scroll"><div class="diff-lines">${body}${more}</div></div></div>`
}

function toolDiffs(part) {
  const state = part.state || {}
  const input = state.input || {}
  const meta = state.metadata || {}
  const tool = String(part.tool || '').toLowerCase()
  const path = input.filePath || input.path || ''
  const out = []
  if (Array.isArray(meta.files)) meta.files.forEach((file) => { if (file && typeof file.diff === 'string' && file.diff.trim()) out.push({ path: file.relativePath || file.filePath || file.path || '', rows: unifiedRows(file.diff) }) })
  if (!out.length && typeof meta.diff === 'string' && meta.diff.trim()) out.push({ path, rows: unifiedRows(meta.diff) })
  if (!out.length && meta.filediff && typeof meta.filediff === 'object' && meta.filediff.before !== undefined && meta.filediff.after !== undefined) out.push({ path: meta.filediff.file || path, rows: collapseRows(lineDiffRows(meta.filediff.before, meta.filediff.after)) })
  if (!out.length) {
    if (typeof input.oldString === 'string' && typeof input.newString === 'string') out.push({ path, rows: collapseRows(lineDiffRows(input.oldString, input.newString)) })
    else if (Array.isArray(input.edits)) input.edits.forEach((edit) => { if (edit && typeof edit.oldString === 'string') out.push({ path: edit.filePath || path, rows: collapseRows(lineDiffRows(edit.oldString, edit.newString ?? '')) }) })
    else if (tool === 'write' && typeof input.content === 'string') out.push({ path, rows: input.content.split('\n').map((text) => ({ t: 'add', text })) })
    else if (typeof input.patchText === 'string' && input.patchText.trim()) out.push({ path: '', rows: unifiedRows(input.patchText) })
  }
  return out.filter((diff) => diff.rows.length)
}

function toolDetailsHtml(part) {
  const state = part.state || {}
  const input = state.input || {}
  const meta = state.metadata || {}
  const tool = String(part.tool || '').toLowerCase()
  const path = input.filePath || input.path || ''
  const diffs = toolDiffs(part)
  let html = ''
  if (tool === 'bash' || tool === 'shell') {
    if (input.description) html += `<p class="tool-desc">${esc(input.description)}</p>`
    html += textBlock('command', input.command, 'sh', 6000)
    html += textBlock('output', state.output ?? meta.output, '', 12000)
  } else if (diffs.length) {
    html += diffs.map((diff) => diffViewHtml(diff.path, diff.rows)).join('')
  } else if (tool === 'todowrite' && Array.isArray(input.todos)) {
    html += `<ul class="tool-todos">${input.todos.map((todo) => `<li class="${esc(todo.status || '')}"><span class="task${todo.status === 'completed' ? ' on' : ''}"></span>${esc(todo.content || '')}</li>`).join('')}</ul>`
  } else {
    const facts = Object.entries(input).filter(([, value]) => typeof value === 'string' && value.length < 300 && !value.includes('\n')).map(([key, value]) => `<div class="tool-fact"><span>${esc(key)}</span><code>${esc(value)}</code></div>`).join('')
    if (facts) html += `<div class="tool-section"><div class="tool-label">input</div><div class="tool-facts">${facts}</div></div>`
    const longInputs = Object.entries(input).filter(([, value]) => typeof value === 'string' && (value.length >= 300 || value.includes('\n')))
    longInputs.forEach(([key, value]) => { html += textBlock(key, value, extLang(path), 6000) })
    if (!facts && !longInputs.length && Object.keys(input).length) html += textBlock('input', JSON.stringify(input, null, 2), 'json', 4000)
    html += textBlock('output', state.output, tool === 'read' ? extLang(path) : '', 12000)
  }
  if (state.error) html += `<div class="tool-section tool-error">${codeBlockHtml(clip(state.error, 4000).text, '', true, { label: 'error' })}</div>`
  const time = state.time || {}
  const facts = []
  if (typeof time.start === 'number' && typeof time.end === 'number' && time.end - time.start >= 100) facts.push(`${((time.end - time.start) / 1000).toFixed(1)}s`)
  if (typeof meta.exit === 'number') facts.push(`exit ${meta.exit}`)
  if (path && !diffs.length) facts.push(path)
  if (facts.length && html) html += `<div class="tool-foot">${facts.map((fact) => `<span>${esc(fact)}</span>`).join('')}</div>`
  return html || '<p class="tool-empty">No details reported yet.</p>'
}

function toolSig(part) {
  const state = part.state || {}
  const meta = state.metadata || {}
  return `${state.status}|${toolSummary(part)}|${String(state.output ?? meta.output ?? '').length}|${state.error ? 1 : 0}|${String(meta.diff || '').length}`
}

function toolSearchText(part) {
  const state = part.state || {}
  const input = state.input || {}
  const strings = Object.values(input).filter((value) => typeof value === 'string')
  return [part.tool, state.title, ...strings, state.output, state.error].filter(Boolean).join('\n').replace(ANSI_RE, '').slice(0, 40000).toLowerCase()
}

function toolChipHtml(part, open = false, fresh = false) {
  const name = String(part.tool || 'task')
  const status = String(part.state?.status || 'running')
  const stateIcon = status === 'completed' ? icon('check') : status === 'error' ? icon('x') : '<span class="spinner"></span>'
  const summary = toolSummary(part)
  const head = `<div class="tool-head" role="button" tabindex="0" aria-expanded="${open}" aria-label="${esc(name)} details" data-tool-toggle><span class="tool-ico">${icon(TOOL_ICONS[name.toLowerCase()] || 'cpu')}</span><div><b>${esc(name)}</b>${summary ? `<small>${esc(summary)}</small>` : ''}</div><span class="tool-state">${stateIcon}</span><span class="tool-chev">${icon('chev-d')}</span></div>`
  return `<div class="tool-chip${open ? ' open' : ''}" data-status="${esc(status)}">${head}${open ? `<div class="tool-body${fresh ? ' fresh' : ''}">${toolDetailsHtml(part)}</div>` : ''}</div>`
}

/* ── Usage formatting ───────────────────────────────────────────────────── */
function fmtTokens(count) {
  const n = Number(count) || 0
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1e6).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}M`
}
function fmtCost(value) {
  const n = Number(value) || 0
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`
}

/* ── Behaviour wiring ───────────────────────────────────────────────────── */
function syncSeg(seg) {
  if (!seg) return
  const buttons = Array.from(seg.querySelectorAll(':scope > button'))
  seg.style.setProperty('--n', buttons.length)
  seg.style.setProperty('--seg', Math.max(0, buttons.findIndex((button) => button.classList.contains('active'))))
}

function updateComposer() {
  const input = document.querySelector('#promptInput')
  const send = document.querySelector('#sendButton')
  if (!input || !send) return
  input.style.height = 'auto'
  if (input.scrollHeight > 0) input.style.height = `${Math.min(input.scrollHeight, 132)}px`
  send.classList.toggle('ready', input.value.trim().length > 0)
}

function wireUi() {
  const rippleTargets = '.primary,.secondary,.danger,.icon-btn,.send,.model-pill,.provider-action,#tabbar button,.profile,.session-item,.project-item,.model-item,.seg button,.profile-menu'
  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest(rippleTargets)
    if (!target || target.disabled || getComputedStyle(target).overflow !== 'hidden') return
    const box = target.getBoundingClientRect()
    const size = Math.max(box.width, box.height) * 2.2
    const wave = document.createElement('span')
    wave.className = 'ripple'
    wave.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - box.left - size / 2}px;top:${event.clientY - box.top - size / 2}px`
    target.appendChild(wave)
    wave.addEventListener('animationend', () => wave.remove(), { once: true })
    setTimeout(() => wave.remove(), 900)
  }, { passive: true })

  document.addEventListener('click', (event) => {
    const wrap = event.target.closest('[data-wrap]')
    if (wrap) { toggleWrap(); tap(); return }
    const copyDiff = event.target.closest('[data-copy-diff]')
    if (copyDiff) {
      const view = copyDiff.closest('.diff-view')
      const text = Array.from(view.querySelectorAll('.dr')).map((row) => {
        const code = row.querySelector('code')?.textContent || ''
        if (row.classList.contains('add')) return `+${code}`
        if (row.classList.contains('del')) return `-${code}`
        if (row.classList.contains('ctx')) return ` ${code}`
        return code
      }).join('\n')
      copyText(text).then((ok) => {
        copyDiff.classList.toggle('done', ok)
        copyDiff.querySelector('span').textContent = ok ? 'Copied' : 'Press & hold to copy'
        setTimeout(() => { copyDiff.classList.remove('done'); copyDiff.querySelector('span').textContent = 'Copy' }, 1700)
      })
      return
    }
    const copy = event.target.closest('[data-copy]')
    if (copy) {
      const block = copy.closest('.code-block')
      const lines = block.querySelectorAll('.df')
      const text = lines.length ? Array.from(lines).map((line) => line.textContent).join('\n') : block.querySelector('pre').textContent
      copyText(text).then((ok) => {
        copy.classList.toggle('done', ok)
        copy.querySelector('span').textContent = ok ? 'Copied' : 'Press & hold to copy'
        setTimeout(() => { copy.classList.remove('done'); copy.querySelector('span').textContent = 'Copy' }, 1700)
      })
      return
    }
    const link = event.target.closest('a.md-link')
    if (link) {
      event.preventDefault()
      const url = link.dataset.href
      if (window.AndroidDevice && typeof window.AndroidDevice.openUrl === 'function') window.AndroidDevice.openUrl(url)
      else copyText(url).then(() => { if (typeof notify === 'function') notify('Link copied') })
    }
  })

  document.querySelectorAll('.guide').forEach((sheet) => sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.hidden = true }))
  document.querySelectorAll('.seg').forEach(syncSeg)
  applyWrap()

  const input = document.querySelector('#promptInput')
  if (input) input.addEventListener('input', updateComposer)
  const dock = document.querySelector('#dock')
  if (dock && 'ResizeObserver' in window) {
    new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`)).observe(dock)
  }
  updateComposer()
}

if (typeof document !== 'undefined') wireUi()

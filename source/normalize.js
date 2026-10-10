/*
 * Repairs Lexical JSON (from Super or from this editor) so it always loads.
 * Super notes can contain structures the editor rejects (for example list items
 * inside links, or images directly under the root), which is what makes a note
 * open blank. Here, invalid nesting is flattened and unknown node types are
 * unwrapped to their text instead of failing.
 */

const BLOCKS = new Set(['paragraph', 'heading', 'quote', 'list', 'code', 'table', 'horizontalrule', 'collapsible-container', 'inline-file', 'snfile'])
const BLOCK_LEAVES = new Set(['horizontalrule', 'inline-file', 'snfile'])
const SAFE_SRC = /^(https?:|data:image\/)/i
const INLINE_ELEMENTS = new Set(['link', 'autolink'])
const INLINE_LEAVES = new Set(['text', 'linebreak', 'tab', 'unencrypted-image', 'code-highlight'])
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

const el = (type, extra = {}) => ({ type, version: 1, direction: 'ltr', format: '', indent: 0, children: [], ...extra })
export const textNode = (text, format = 0) => ({ type: 'text', version: 1, text, format, detail: 0, mode: 'normal', style: '' })
const paragraph = (children = []) => el('paragraph', { children, textFormat: 0, textStyle: '' })

const isObj = (n) => n && typeof n === 'object'
const kids = (n) => (Array.isArray(n.children) ? n.children.filter(isObj) : [])

function elementBase(n) {
  return {
    ...n,
    version: n.version || 1,
    direction: n.direction === 'rtl' ? 'rtl' : n.direction === null ? null : 'ltr',
    format: typeof n.format === 'string' ? n.format : '',
    indent: Number.isInteger(n.indent) && n.indent >= 0 ? n.indent : 0,
  }
}

function leaf(n) {
  switch (n.type) {
    case 'text':
      return textNode(String(n.text ?? ''), Number.isInteger(n.format) ? n.format : 0)
    case 'code-highlight':
      return textNode(String(n.text ?? ''))
    case 'linebreak':
      return { type: 'linebreak', version: 1 }
    case 'tab':
      return { ...textNode('\t'), type: 'tab', mode: 'normal' }
    case 'unencrypted-image': {
      const img = { type: 'unencrypted-image', version: 1, src: String(n.src || ''), alt: String(n.alt || '') }
      if (Number.isFinite(n.width)) img.width = n.width
      return img
    }
    default:
      return null
  }
}

/* Inline content only: text, line breaks, images, and links containing those. */
function inline(nodes) {
  const out = []
  nodes.forEach((n, i) => {
    if (INLINE_LEAVES.has(n.type)) {
      const l = leaf(n)
      if (l) out.push(l)
    } else if (n.type === 'inline-file') {
      // An embedded image somewhere only text can go: keep it as an inline image
      if (SAFE_SRC.test(n.src || '')) out.push({ type: 'unencrypted-image', version: 1, src: String(n.src), alt: String(n.fileName || '') })
    } else if (n.type === 'snfile') {
      out.push(textNode('[File stored in Standard Notes Files]'))
    } else if (INLINE_ELEMENTS.has(n.type)) {
      const children = inline(kids(n))
      if (n.url && children.length) {
        out.push({ ...elementBase(n), type: n.type, url: String(n.url), rel: n.rel ?? null, target: n.target ?? null, title: n.title ?? null, children })
      } else out.push(...children)
    } else if (Array.isArray(n.children)) {
      // A block or unknown wrapper inside inline content: keep its text, separate lines.
      const children = inline(kids(n))
      if (children.length && out.length && (BLOCKS.has(n.type) || n.type === 'listitem')) out.push({ type: 'linebreak', version: 1 })
      out.push(...children)
    } else if (typeof n.text === 'string' && n.text) {
      out.push(textNode(n.text))
    }
  })
  return out
}

function listItem(n) {
  const children = []
  for (const c of kids(n)) {
    if (c.type === 'list') children.push(...block(c))
    else children.push(...inline([c]))
  }
  const item = { ...elementBase(n), type: 'listitem', value: Number.isInteger(n.value) ? n.value : 1, children }
  if (typeof n.checked === 'boolean') item.checked = n.checked
  else delete item.checked
  return item
}

function list(n) {
  const listType = ['bullet', 'number', 'check'].includes(n.listType) ? n.listType : 'bullet'
  const children = kids(n).map((c) => (c.type === 'listitem' ? listItem(c) : listItem({ type: 'listitem', children: [c] })))
  if (!children.length) return []
  return [{ ...elementBase(n), type: 'list', listType, start: Number.isInteger(n.start) ? n.start : 1, tag: listType === 'number' ? 'ol' : 'ul', children }]
}

function table(n) {
  const rows = kids(n)
  const valid = rows.length && rows.every((r) => r.type === 'tablerow' && kids(r).length && kids(r).every((c) => c.type === 'tablecell'))
  if (!valid) return blocks(rows.flatMap((r) => kids(r)))
  return [{
    ...elementBase(n),
    type: 'table',
    children: rows.map((r) => ({
      ...elementBase(r),
      type: 'tablerow',
      children: kids(r).map((c) => {
        const content = blocks(kids(c))
        return {
          ...elementBase(c),
          type: 'tablecell',
          headerState: Number.isInteger(c.headerState) ? c.headerState : 0,
          colSpan: Number.isInteger(c.colSpan) ? c.colSpan : 1,
          rowSpan: Number.isInteger(c.rowSpan) ? c.rowSpan : 1,
          children: content.length ? content : [paragraph()],
        }
      }),
    })),
  }]
}

/* A paragraph holding an image block or file: split it so those sit on their own lines. */
function splitParagraph(n) {
  const out = []
  let pending = []
  const make = (children) => ({ ...elementBase(n), type: 'paragraph', textFormat: n.textFormat || 0, textStyle: n.textStyle || '', children: inline(children) })
  for (const c of kids(n)) {
    if (BLOCK_LEAVES.has(c.type)) {
      if (pending.length) out.push(make(pending))
      pending = []
      out.push(...(block(c) || []))
    } else pending.push(c)
  }
  if (pending.length || !out.length) out.push(make(pending))
  return out
}

function block(n) {
  switch (n.type) {
    case 'paragraph':
      if (kids(n).some((c) => BLOCK_LEAVES.has(c.type))) return splitParagraph(n)
      return [{ ...elementBase(n), type: 'paragraph', textFormat: n.textFormat || 0, textStyle: n.textStyle || '', children: inline(kids(n)) }]
    case 'heading':
      return [{ ...elementBase(n), type: 'heading', tag: HEADING_TAGS.has(n.tag) ? n.tag : 'h2', children: inline(kids(n)) }]
    case 'quote':
      return [{ ...elementBase(n), type: 'quote', children: inline(kids(n)) }]
    case 'code': {
      const children = []
      for (const c of inline(kids(n))) {
        if (c.type === 'text' || c.type === 'linebreak' || c.type === 'tab') children.push(c.type === 'text' ? textNode(c.text) : c)
        else if (c.type === 'link' || c.type === 'autolink') children.push(...c.children.filter((x) => x.type === 'text').map((x) => textNode(x.text)))
      }
      return [{ ...elementBase(n), type: 'code', language: typeof n.language === 'string' ? n.language : null, children }]
    }
    case 'list':
      return list(n)
    case 'table':
      return table(n)
    case 'horizontalrule':
      return [{ type: 'horizontalrule', version: 1 }]
    case 'inline-file': {
      if (!SAFE_SRC.test(n.src || '')) return []
      const img = {
        type: 'inline-file', version: 1, src: String(n.src), mimeType: String(n.mimeType || 'image/png'),
        fileName: n.fileName ? String(n.fileName) : undefined, format: typeof n.format === 'string' ? n.format : '',
      }
      if (Number.isFinite(n.width)) img.width = n.width
      return [img]
    }
    case 'snfile':
      return [{
        type: 'snfile', version: 1, fileUuid: String(n.fileUuid || ''),
        zoomLevel: Number.isFinite(n.zoomLevel) ? n.zoomLevel : 100, format: typeof n.format === 'string' ? n.format : '',
      }]
    case 'collapsible-container': {
      const parts = kids(n)
      const title = parts.find((c) => c.type === 'collapsible-title')
      const content = parts.find((c) => c.type === 'collapsible-content')
      if (!title || !content || parts.length !== 2 || parts[0] !== title) return blocks(parts)
      const body = blocks(kids(content))
      return [{
        ...elementBase(n),
        type: 'collapsible-container',
        open: n.open !== false,
        children: [
          { ...elementBase(title), type: 'collapsible-title', children: inline(kids(title)) },
          { ...elementBase(content), type: 'collapsible-content', children: body.length ? body : [paragraph()] },
        ],
      }]
    }
    default:
      return null
  }
}

/* A sequence of block-level nodes; stray inline content gets wrapped in paragraphs. */
function blocks(nodes) {
  const out = []
  let pending = []
  const flush = () => {
    if (pending.length) out.push(paragraph(inline(pending)))
    pending = []
  }
  for (const n of nodes) {
    if (BLOCKS.has(n.type)) {
      flush()
      out.push(...(block(n) || []))
    } else if (INLINE_LEAVES.has(n.type) || INLINE_ELEMENTS.has(n.type)) {
      pending.push(n)
    } else if (n.type === 'listitem') {
      flush()
      out.push(...list({ type: 'list', listType: 'bullet', children: [n] }))
    } else if (Array.isArray(n.children)) {
      // Unknown container (collapsible section, etc.): keep its contents.
      flush()
      out.push(...blocks(kids(n)))
    } else if (typeof n.text === 'string' && n.text) {
      pending.push(textNode(n.text))
    }
  }
  flush()
  return out
}

export function normalizeState(state) {
  const root = isObj(state) && isObj(state.root) ? state.root : null
  if (!root) throw new Error('Not a Lexical document')
  const children = blocks(kids(root))
  return {
    root: {
      type: 'root', version: 1, direction: 'ltr', format: '', indent: 0,
      children: children.length ? children : [paragraph()],
    },
  }
}

export const looksLikeLexical = (data) => isObj(data) && isObj(data.root) && data.root.type === 'root'

/* Plain text from any Lexical JSON, for previews and last-resort recovery. */
export function stateToLines(state) {
  const lines = []
  let line = ''
  const walk = (n) => {
    if (!isObj(n)) return
    if (typeof n.text === 'string') line += n.text
    if (n.type === 'linebreak') { lines.push(line); line = '' }
    kids(n).forEach(walk)
    if (BLOCKS.has(n.type) || n.type === 'listitem' || n.type === 'tablecell' || n.type === 'collapsible-title') {
      if (line) lines.push(line)
      line = ''
    }
  }
  walk(state && state.root)
  if (line) lines.push(line)
  return lines
}

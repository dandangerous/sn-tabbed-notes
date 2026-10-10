import { DecoratorNode, ElementNode, $applyNodeReplacement, $createParagraphNode, $isElementNode } from 'lexical'

const SAFE_SRC = /^(https?:|data:image\/)/i

/* Shared image view: the picture plus a resize handle. Width is a percentage of the line, or natural size. */
export function buildImageView(src, alt, width) {
  const box = document.createElement('span')
  box.className = width ? 'iv sized' : 'iv'
  if (width) box.style.width = `${width}%`
  const img = document.createElement('img')
  img.src = src
  img.alt = alt || ''
  img.draggable = false
  img.loading = 'lazy'
  const grip = document.createElement('span')
  grip.className = 'iv-resize'
  grip.title = 'Drag to resize'
  box.append(img, grip)
  return box
}

const clampWidth = (w) => (Number.isFinite(w) && w > 0 ? Math.max(5, Math.min(100, Math.round(w))) : null)
const ALIGNS = new Set(['left', 'center', 'right', 'start', 'end', 'justify', ''])

/* Remote image, inline in text. Same JSON type as Super ("unencrypted-image"). */
export class ImageNode extends DecoratorNode {
  static getType() { return 'unencrypted-image' }
  static clone(node) { return new ImageNode(node.__src, node.__alt, node.__width, node.__key) }

  constructor(src = '', alt = '', width = null, key) {
    super(key)
    this.__src = SAFE_SRC.test(src) ? src : ''
    this.__alt = alt || ''
    this.__width = clampWidth(width)
  }

  static importJSON(json) { return $createImageNode(json.src, json.alt, json.width) }
  exportJSON() {
    const out = { type: 'unencrypted-image', version: 1, src: this.__src, alt: this.__alt }
    if (this.__width) out.width = this.__width
    return out
  }

  static importDOM() {
    return {
      img: () => ({
        conversion: (el) => {
          const src = el.getAttribute('src') || ''
          return { node: SAFE_SRC.test(src) ? $createImageNode(src, el.getAttribute('alt') || '') : null }
        },
        priority: 0,
      }),
    }
  }

  exportDOM() {
    const img = document.createElement('img')
    img.src = this.__src
    img.alt = this.__alt
    return { element: img }
  }

  createDOM() {
    const span = document.createElement('span')
    span.className = 'img'
    return span
  }

  updateDOM() { return false }
  isInline() { return true }
  getTextContent() { return '' }
  getWidth() { return this.getLatest().__width }
  setWidth(width) { this.getWritable().__width = clampWidth(width) }

  decorate() {
    if (!this.__src) return null
    return buildImageView(this.__src, this.__alt, this.__width)
  }
}

export function $createImageNode(src, alt, width) {
  return $applyNodeReplacement(new ImageNode(src, alt, width))
}
export const $isImageNode = (n) => n instanceof ImageNode

/* Image embedded in the note, on its own line. Same JSON type as Super ("inline-file"). */
export class InlineFileNode extends DecoratorNode {
  static getType() { return 'inline-file' }
  static clone(node) {
    return new InlineFileNode(node.__src, node.__mimeType, node.__fileName, node.__format, node.__width, node.__key)
  }

  constructor(src = '', mimeType = 'image/png', fileName, format = '', width = null, key) {
    super(key)
    this.__src = SAFE_SRC.test(src) ? src : ''
    this.__mimeType = mimeType || 'image/png'
    this.__fileName = fileName || undefined
    this.__format = ALIGNS.has(format) ? format : ''
    this.__width = clampWidth(width)
  }

  static importJSON(json) {
    return $createInlineFileNode(json.src, json.mimeType, json.fileName, json.format, json.width)
  }
  exportJSON() {
    const out = { type: 'inline-file', version: 1, format: this.__format, src: this.__src, mimeType: this.__mimeType, fileName: this.__fileName }
    if (this.__width) out.width = this.__width
    return out
  }
  exportDOM() {
    const img = document.createElement('img')
    img.src = this.__src
    img.alt = this.__fileName || ''
    return { element: img }
  }

  createDOM() {
    const div = document.createElement('div')
    div.className = 'image-block'
    div.style.textAlign = this.__format || 'left'
    return div
  }
  updateDOM(prev, dom) {
    if (prev.__format !== this.__format) dom.style.textAlign = this.__format || 'left'
    return false
  }
  isInline() { return false }
  getTextContent() { return '\n' }
  getWidth() { return this.getLatest().__width }
  setWidth(width) { this.getWritable().__width = clampWidth(width) }
  getFormat() { return this.getLatest().__format }
  setFormat(format) { this.getWritable().__format = ALIGNS.has(format) ? format : '' }

  decorate() {
    if (!this.__src) return null
    return buildImageView(this.__src, this.__fileName, this.__width)
  }
}

export function $createInlineFileNode(src, mimeType, fileName, format, width) {
  return $applyNodeReplacement(new InlineFileNode(src, mimeType, fileName, format, width))
}
export const $isInlineFileNode = (n) => n instanceof InlineFileNode

/*
 * An image Super uploaded to Standard Notes Files ("snfile"). Plugins can't read Files,
 * so this shows a placeholder and keeps the file reference exactly as it was, so the
 * image comes back if the note is opened in Super again.
 */
export class SuperFileNode extends DecoratorNode {
  static getType() { return 'snfile' }
  static clone(node) { return new SuperFileNode(node.__fileUuid, node.__zoomLevel, node.__format, node.__key) }
  constructor(fileUuid = '', zoomLevel = 100, format = '', key) {
    super(key)
    this.__fileUuid = String(fileUuid || '')
    this.__zoomLevel = Number.isFinite(zoomLevel) ? zoomLevel : 100
    this.__format = typeof format === 'string' ? format : ''
  }
  static importJSON(json) { return new SuperFileNode(json.fileUuid, json.zoomLevel, json.format) }
  exportJSON() {
    return { type: 'snfile', version: 1, format: this.__format, fileUuid: this.__fileUuid, zoomLevel: this.__zoomLevel }
  }
  exportDOM() { return { element: document.createElement('span') } }
  createDOM() {
    const div = document.createElement('div')
    div.className = 'snfile-block'
    return div
  }
  updateDOM() { return false }
  isInline() { return false }
  getTextContent() { return '\n' }
  decorate() {
    const card = document.createElement('div')
    card.className = 'snfile-card'
    card.contentEditable = 'false'
    const title = document.createElement('strong')
    title.textContent = 'File stored in Standard Notes Files'
    const body = document.createElement('span')
    body.textContent = "Plugins can't display uploaded files. Open this note in Super to see it. The link to the file is kept."
    card.append(title, body)
    return card
  }
}
export const $isSuperFileNode = (n) => n instanceof SuperFileNode

/* Divider. Same JSON type name as Super ("horizontalrule"). */
export class HorizontalRuleNode extends DecoratorNode {
  static getType() { return 'horizontalrule' }
  static clone(node) { return new HorizontalRuleNode(node.__key) }
  static importJSON() { return $createHorizontalRuleNode() }
  exportJSON() { return { type: 'horizontalrule', version: 1 } }
  static importDOM() {
    return { hr: () => ({ conversion: () => ({ node: $createHorizontalRuleNode() }), priority: 0 }) }
  }
  exportDOM() { return { element: document.createElement('hr') } }
  createDOM() {
    const div = document.createElement('div')
    div.className = 'hr'
    div.contentEditable = 'false'
    return div
  }
  updateDOM() { return false }
  isInline() { return false }
  getTextContent() { return '\n' }
  decorate() { return null }
}

export function $createHorizontalRuleNode() {
  return $applyNodeReplacement(new HorizontalRuleNode())
}
export const $isHorizontalRuleNode = (n) => n instanceof HorizontalRuleNode

export const HR_TRANSFORMER = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '***' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const line = $createHorizontalRuleNode()
    if (isImport || parentNode.getNextSibling() != null) parentNode.replace(line)
    else parentNode.insertBefore(line)
    line.selectNext()
  },
  type: 'element',
}

/* ---------- Collapsible sections (same JSON types as Super) ---------- */

const fromJSON = (node, json) => (typeof node.updateFromJSON === 'function' ? node.updateFromJSON(json) : node)

export class CollapsibleContainerNode extends ElementNode {
  static getType() { return 'collapsible-container' }
  static clone(node) { return new CollapsibleContainerNode(node.__open, node.__key) }
  constructor(open = true, key) {
    super(key)
    this.__open = open !== false
  }
  static importJSON(json) { return fromJSON($createCollapsibleContainerNode(json.open !== false), json) }
  exportJSON() { return { ...super.exportJSON(), type: 'collapsible-container', open: this.__open } }
  static importDOM() {
    return { details: () => ({ conversion: (el) => ({ node: $createCollapsibleContainerNode(el.hasAttribute('open')) }), priority: 1 }) }
  }
  exportDOM() {
    const el = document.createElement('details')
    if (this.__open) el.setAttribute('open', '')
    return { element: el }
  }
  createDOM() {
    const el = document.createElement('div')
    el.className = 'Collapsible__container'
    if (!this.__open) el.classList.add('Collapsible__collapsed')
    return el
  }
  updateDOM(prev, dom) {
    if (prev.__open !== this.__open) dom.classList.toggle('Collapsible__collapsed', !this.__open)
    return false
  }
  getOpen() { return this.getLatest().__open }
  setOpen(open) { this.getWritable().__open = open }
  toggleOpen() { this.setOpen(!this.getOpen()) }
}
export function $createCollapsibleContainerNode(open = true) { return $applyNodeReplacement(new CollapsibleContainerNode(open)) }
export const $isCollapsibleContainerNode = (n) => n instanceof CollapsibleContainerNode

export class CollapsibleTitleNode extends ElementNode {
  static getType() { return 'collapsible-title' }
  static clone(node) { return new CollapsibleTitleNode(node.__key) }
  static importJSON(json) { return fromJSON($createCollapsibleTitleNode(), json) }
  exportJSON() { return { ...super.exportJSON(), type: 'collapsible-title' } }
  static importDOM() {
    return { summary: () => ({ conversion: () => ({ node: $createCollapsibleTitleNode() }), priority: 1 }) }
  }
  exportDOM() { return { element: document.createElement('summary') } }
  createDOM() {
    const el = document.createElement('div')
    el.className = 'Collapsible__title'
    return el
  }
  updateDOM() { return false }

  /* Enter in the title: go into the section if it's open, otherwise to a new line after it. */
  insertNewAfter(_selection, restoreSelection = true) {
    const container = this.getParent()
    if (!$isCollapsibleContainerNode(container)) return null
    if (container.getOpen()) {
      const content = this.getNextSibling()
      const first = content && content.getFirstChild()
      if ($isElementNode(first)) return first
      const p = $createParagraphNode()
      if (content) content.append(p)
      return p
    }
    const p = $createParagraphNode()
    container.insertAfter(p, restoreSelection)
    return p
  }

  /* Backspace at the start of the title turns the section back into normal blocks. */
  collapseAtStart() {
    const container = this.getParent()
    if (!$isCollapsibleContainerNode(container)) return false
    const content = this.getNextSibling()
    const p = $createParagraphNode()
    this.getChildren().forEach((c) => p.append(c))
    container.insertBefore(p)
    if (content) content.getChildren().forEach((c) => container.insertBefore(c))
    container.remove()
    p.selectStart()
    return true
  }
}
export function $createCollapsibleTitleNode() { return $applyNodeReplacement(new CollapsibleTitleNode()) }
export const $isCollapsibleTitleNode = (n) => n instanceof CollapsibleTitleNode

export class CollapsibleContentNode extends ElementNode {
  static getType() { return 'collapsible-content' }
  static clone(node) { return new CollapsibleContentNode(node.__key) }
  static importJSON(json) { return fromJSON($createCollapsibleContentNode(), json) }
  exportJSON() { return { ...super.exportJSON(), type: 'collapsible-content' } }
  static importDOM() { return null }
  exportDOM() { return { element: document.createElement('div') } }
  createDOM() {
    const el = document.createElement('div')
    el.className = 'Collapsible__content'
    return el
  }
  updateDOM() { return false }
  isShadowRoot() { return true }
}
export function $createCollapsibleContentNode() { return $applyNodeReplacement(new CollapsibleContentNode()) }
export const $isCollapsibleContentNode = (n) => n instanceof CollapsibleContentNode

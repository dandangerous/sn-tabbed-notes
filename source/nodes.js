import { DecoratorNode, ElementNode, $applyNodeReplacement, $createParagraphNode, $isElementNode } from 'lexical'

const SAFE_SRC = /^(https?:|data:image\/)/i

/* Remote image. Uses the same JSON type name as Super ("unencrypted-image"). */
export class ImageNode extends DecoratorNode {
  static getType() { return 'unencrypted-image' }
  static clone(node) { return new ImageNode(node.__src, node.__alt, node.__key) }

  constructor(src = '', alt = '', key) {
    super(key)
    this.__src = SAFE_SRC.test(src) ? src : ''
    this.__alt = alt || ''
  }

  static importJSON(json) { return $createImageNode(json.src, json.alt) }
  exportJSON() { return { type: 'unencrypted-image', version: 1, src: this.__src, alt: this.__alt } }

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

  decorate() {
    if (!this.__src) return null
    const img = document.createElement('img')
    img.src = this.__src
    img.alt = this.__alt
    img.draggable = false
    img.loading = 'lazy'
    return img
  }
}

export function $createImageNode(src, alt) {
  return $applyNodeReplacement(new ImageNode(src, alt))
}
export const $isImageNode = (n) => n instanceof ImageNode

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

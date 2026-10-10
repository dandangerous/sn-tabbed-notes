import ComponentRelay from '@standardnotes/component-relay'
import {
  createEditor, $getRoot, $getSelection, $setSelection, $isRangeSelection, $createParagraphNode, $insertNodes,
  $isTextNode, $isRootOrShadowRoot, $getNodeByKey, $createTextNode, $getNearestNodeFromDOMNode,
  FORMAT_TEXT_COMMAND, FORMAT_ELEMENT_COMMAND, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND,
  UNDO_COMMAND, REDO_COMMAND, CAN_UNDO_COMMAND, CAN_REDO_COMMAND, SELECTION_CHANGE_COMMAND,
  KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND, KEY_TAB_COMMAND,
  COMMAND_PRIORITY_EDITOR, COMMAND_PRIORITY_LOW, COMMAND_PRIORITY_CRITICAL,
} from 'lexical'
import { registerRichText, HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from '@lexical/rich-text'
import {
  registerList, registerCheckList, ListNode, ListItemNode, $isListNode,
  INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_CHECK_LIST_COMMAND, REMOVE_LIST_COMMAND,
} from '@lexical/list'
import { LinkNode, AutoLinkNode, $isLinkNode, $toggleLink, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { CodeNode, CodeHighlightNode, $createCodeNode, $isCodeNode } from '@lexical/code'
import {
  TableNode, TableRowNode, TableCellNode, registerTablePlugin, registerTableSelectionObserver, INSERT_TABLE_COMMAND,
  $insertTableRowAtSelection, $insertTableColumnAtSelection, $deleteTableRowAtSelection, $deleteTableColumnAtSelection,
  $isTableNode, $isTableCellNode,
} from '@lexical/table'
import { registerHistory, createEmptyHistoryState } from '@lexical/history'
import { registerMarkdownShortcuts, TRANSFORMERS, CHECK_LIST, $convertFromMarkdownString } from '@lexical/markdown'
import { $setBlocksType } from '@lexical/selection'
import { mergeRegister, $findMatchingParent, $getNearestNodeOfType, $insertNodeToNearestRoot } from '@lexical/utils'
import { $generateNodesFromDOM } from '@lexical/html'
import {
  ImageNode, $createImageNode, HorizontalRuleNode, $createHorizontalRuleNode, HR_TRANSFORMER, InlineFileNode, SuperFileNode,
  CollapsibleContainerNode, CollapsibleTitleNode, CollapsibleContentNode,
  $createCollapsibleContainerNode, $createCollapsibleTitleNode, $createCollapsibleContentNode,
  $isCollapsibleContainerNode, $isCollapsibleTitleNode, $isCollapsibleContentNode,
} from './nodes.js'
import { normalizeState, looksLikeLexical, stateToLines } from './normalize.js'
import { ICONS } from './icons.js'
import { createSearch } from './search.js'
import { createImages } from './images.js'

const FORMAT = 'sn-tabbed-notes'
const COLORS = [
  { id: 'blue', name: 'Blue', hex: '#3d6fb4' },
  { id: 'teal', name: 'Teal', hex: '#23877e' },
  { id: 'green', name: 'Green', hex: '#4f8a34' },
  { id: 'gold', name: 'Gold', hex: '#b98a1c' },
  { id: 'red', name: 'Red', hex: '#b8453c' },
  { id: 'pink', name: 'Pink', hex: '#b04a7c' },
  { id: 'purple', name: 'Purple', hex: '#6d52ad' },
  { id: 'gray', name: 'Gray', hex: '#69707a' },
]
const MD_TRANSFORMERS = [CHECK_LIST, HR_TRANSFORMER, ...TRANSFORMERS]

const $ = (sel) => document.querySelector(sel)
const tablist = $('#tabs')
const page = $('#page')
const toolbar = $('#toolbar')
const tabMenu = $('#menu')
const dropdown = $('#dropdown')
const slashMenu = $('#slash')
const ask = $('#ask')
const placeholder = $('#placeholder')
const notice = $('#notice')

let doc = null
let note = null
let relay = null
let lastSaved = null
let locked = false
let loadingTab = false
let menuTabId = null
let dragId = null
let unregisterHistory = null
const histories = new Map()
let slash = null
let dropdownOwner = null
let search = null
let images = null

/* ================= editor ================= */

const theme = {
  paragraph: 'p',
  quote: 'quote',
  heading: { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6' },
  list: {
    ul: 'ul', ol: 'ol', olDepth: ['ol1', 'ol2', 'ol3', 'ol4', 'ol5'], listitem: 'li', checklist: 'checklist',
    listitemChecked: 'li-checked', listitemUnchecked: 'li-unchecked',
    nested: { listitem: 'li-nested' },
  },
  link: 'link',
  code: 'code-block',
  table: 'table', tableRow: 'tr', tableCell: 'td', tableCellHeader: 'th', tableSelection: 'table-selection',
  text: {
    bold: 't-bold', italic: 't-italic', underline: 't-underline', strikethrough: 't-strike',
    underlineStrikethrough: 't-ustrike', code: 't-code', highlight: 't-mark',
    subscript: 't-sub', superscript: 't-sup',
  },
}

const NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, CodeHighlightNode,
  TableNode, TableRowNode, TableCellNode, ImageNode, InlineFileNode, SuperFileNode, HorizontalRuleNode,
  CollapsibleContainerNode, CollapsibleTitleNode, CollapsibleContentNode]

const editor = createEditor({
  namespace: 'tabbed-notes',
  theme,
  nodes: NODES,
  onError: (error) => console.error('[Tabbed Notes]', error),
})

// A second, invisible editor used to convert tabs that haven't been opened yet (for search).
const converter = createEditor({ namespace: 'tabbed-notes-convert', theme, nodes: NODES, onError: () => {} })
editor.setRootElement(page)

mergeRegister(
  registerRichText(editor),
  registerList(editor),
  registerCheckList(editor),
  registerTablePlugin(editor),
  registerTableSelectionObserver(editor),
  registerMarkdownShortcuts(editor, MD_TRANSFORMERS),
  editor.registerCommand(TOGGLE_LINK_COMMAND, (url) => { $toggleLink(url); return true }, COMMAND_PRIORITY_EDITOR),
  editor.registerCommand(KEY_TAB_COMMAND, (event) => {
    if (slash) return false
    event.preventDefault()
    return editor.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined)
  }, COMMAND_PRIORITY_EDITOR),
  editor.registerDecoratorListener((decorators) => {
    for (const [key, dom] of Object.entries(decorators)) {
      const host = editor.getElementByKey(key)
      if (host && dom && host.firstChild !== dom) host.replaceChildren(dom)
    }
  }),
  editor.registerCommand(SELECTION_CHANGE_COMMAND, () => { updateToolbar(); return false }, COMMAND_PRIORITY_LOW),
  editor.registerCommand(CAN_UNDO_COMMAND, (v) => { $('[data-cmd="undo"]').disabled = !v; return false }, COMMAND_PRIORITY_LOW),
  editor.registerCommand(CAN_REDO_COMMAND, (v) => { $('[data-cmd="redo"]').disabled = !v; return false }, COMMAND_PRIORITY_LOW),
  editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
    updateToolbar()
    updatePlaceholder()
    if (loadingTab || tags.has('tab-load')) return
    checkSlash()
    if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
    if (search) search.onEditorUpdate()
    if (locked || !doc) return
    const tab = activeTab()
    tab.state = editorState.toJSON()
    delete tab.source
    save()
  }),
)

/* ================= data ================= */

const uid = () => Math.random().toString(36).slice(2, 10)
const newTab = (title, color, extra = {}) => ({ id: uid(), title, color: color || COLORS[0].id, ...extra })

function newDoc(extra) {
  const first = newTab('Tab 1', COLORS[0].id, extra)
  return { activeId: first.id, tabs: [first] }
}

function parseText(text) {
  if (!text || !text.trim()) return newDoc()
  let data = null
  try { data = JSON.parse(text) } catch (e) { /* not JSON */ }
  if (data && data.format === FORMAT && Array.isArray(data.tabs) && data.tabs.length) {
    const tabs = data.tabs.map((t, i) => {
      const tab = {
        id: String(t.id || uid()),
        title: String(t.title || `Tab ${i + 1}`).slice(0, 60),
        color: COLORS.some((c) => c.id === t.color) ? t.color : COLORS[0].id,
      }
      if (looksLikeLexical(t.state)) tab.state = t.state
      else if (typeof t.html === 'string') tab.source = { kind: 'html', value: t.html } // version 1 tabs
      else if (typeof t.markdown === 'string') tab.source = { kind: 'markdown', value: t.markdown }
      return tab
    })
    const activeId = tabs.some((t) => t.id === data.activeId) ? data.activeId : tabs[0].id
    return { activeId, tabs }
  }
  // A Super note (Lexical JSON): bring it in as the first tab.
  if (looksLikeLexical(data)) return newDoc({ state: data })
  // Anything else (plain text or Markdown from another editor) goes into the first tab.
  return newDoc({ source: { kind: 'markdown', value: text } })
}

function serialize() {
  return JSON.stringify({
    format: FORMAT,
    version: 2,
    activeId: doc.activeId,
    tabs: doc.tabs.map((t) => {
      const base = { id: t.id, title: t.title, color: t.color }
      if (t.state) return { ...base, state: t.state }
      if (t.source && t.source.kind === 'html') return { ...base, html: t.source.value }
      return { ...base, markdown: t.source ? t.source.value : '' }
    }),
  })
}

const activeTab = () => doc.tabs.find((t) => t.id === doc.activeId) || doc.tabs[0]
const colorHex = (id) => (COLORS.find((c) => c.id === id) || COLORS[0]).hex

function tabText(tab) {
  if (tab.state) return stateToLines(tab.state).join(' ')
  if (!tab.source) return ''
  if (tab.source.kind === 'html') return new DOMParser().parseFromString(tab.source.value, 'text/html').body.textContent || ''
  return tab.source.value
}

function preview() {
  const names = doc.tabs.map((t) => t.title).join(' | ')
  const body = tabText(doc.tabs[0]).replace(/\s+/g, ' ').trim().slice(0, 160)
  return body ? `${names} — ${body}` : names
}

/* ================= saving ================= */

function save() {
  if (!relay || !note || locked) return
  const target = note
  relay.saveItemWithPresave(target, () => {
    const text = serialize()
    lastSaved = text
    target.content.text = text
    target.content.preview_plain = preview()
    target.content.preview_html = null
  })
}

/* ================= loading a tab into the editor ================= */

function $fillFromLines(lines) {
  const root = $getRoot()
  root.clear()
  for (const line of lines.length ? lines : ['']) {
    const p = $createParagraphNode()
    if (line) p.append($createTextNode(line))
    root.append(p)
  }
}

function $fillFromSource(source, target = editor) {
  const root = $getRoot()
  root.clear()
  if (source.kind === 'html') {
    const dom = new DOMParser().parseFromString(source.value || '', 'text/html')
    const nodes = $generateNodesFromDOM(target, dom)
    let para = null
    for (const node of nodes) {
      if (node.isInline && node.isInline()) {
        if (!para) { para = $createParagraphNode(); root.append(para) }
        para.append(node)
      } else {
        para = null
        root.append(node)
      }
    }
  } else {
    $convertFromMarkdownString(source.value || '', MD_TRANSFORMERS, undefined, true)
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode())
}

function loadActiveTab() {
  const tab = activeTab()
  if (unregisterHistory) unregisterHistory()
  unregisterHistory = null
  closeSlash()
  hideHandle()
  loadingTab = true
  try {
    let loaded = false
    if (tab.state) {
      try {
        editor.setEditorState(editor.parseEditorState(normalizeState(tab.state)), { tag: 'tab-load' })
        loaded = true
      } catch (error) {
        console.warn('[Tabbed Notes] Could not load tab content, showing it as plain text instead.', error)
        const lines = stateToLines(tab.state)
        editor.update(() => $fillFromLines(lines), { tag: 'tab-load', discrete: true })
        loaded = true
      }
    }
    if (!loaded) {
      editor.update(() => $fillFromSource(tab.source || { kind: 'markdown', value: '' }), { tag: 'tab-load', discrete: true })
      // Keep the converted version in memory; it's written to the note on the next edit.
      tab.state = editor.getEditorState().toJSON()
    }
  } finally {
    loadingTab = false
  }
  if (!histories.has(tab.id)) histories.set(tab.id, createEmptyHistoryState())
  unregisterHistory = registerHistory(editor, histories.get(tab.id), 400)
  $('[data-cmd="undo"]').disabled = histories.get(tab.id).undoStack.length === 0
  $('[data-cmd="redo"]').disabled = histories.get(tab.id).redoStack.length === 0
  updatePlaceholder()
  updateToolbar()
  if (search) search.onTabLoaded()
}

/* Give every tab a saved editor state, converting old-format tabs without opening them. */
function ensureStates() {
  if (!doc) return
  for (const tab of doc.tabs) {
    if (tab.state || !tab.source) continue
    try {
      converter.update(() => $fillFromSource(tab.source, converter), { discrete: true })
      tab.state = converter.getEditorState().toJSON()
    } catch (e) {
      console.warn('[Tabbed Notes] Could not convert a tab for searching', e)
    }
  }
}

/* ================= tabs UI ================= */

function renderTabs() {
  tablist.innerHTML = ''
  doc.tabs.forEach((tab) => {
    const active = tab.id === doc.activeId
    const el = document.createElement('button')
    el.className = 'tab'
    el.type = 'button'
    el.setAttribute('role', 'tab')
    el.id = `tab-${tab.id}`
    el.dataset.id = tab.id
    el.setAttribute('aria-selected', String(active))
    el.setAttribute('aria-controls', 'page')
    el.tabIndex = active ? 0 : -1
    el.style.setProperty('--tab', colorHex(tab.color))
    el.draggable = !locked
    el.title = locked ? tab.title : `${tab.title} — double-click to rename, right-click for options`
    const label = document.createElement('span')
    label.className = 'tab-label'
    label.textContent = tab.title
    el.append(label)
    const hits = search ? search.countFor(tab.id) : 0
    if (hits) {
      const badge = document.createElement('span')
      badge.className = 'tab-badge'
      badge.textContent = hits > 99 ? '99+' : String(hits)
      badge.setAttribute('aria-label', `${hits} ${hits === 1 ? 'match' : 'matches'}`)
      el.append(badge)
    }
    tablist.append(el)
  })
  document.body.style.setProperty('--active', colorHex(activeTab().color))
  page.setAttribute('aria-labelledby', `tab-${doc.activeId}`)
  $('#add').hidden = locked
}

function applyLock() {
  editor.setEditable(!locked)
  document.body.classList.toggle('locked', locked)
  page.contentEditable = String(!locked)
  toolbar.hidden = locked
}

function renderAll() {
  renderTabs()
  applyLock()
  loadActiveTab()
}

function selectTab(id, focusTab = false) {
  if (!doc.tabs.some((t) => t.id === id) || id === doc.activeId) return
  doc.activeId = id
  renderTabs()
  loadActiveTab()
  if (focusTab) $(`#tab-${id}`)?.focus()
  save()
}

function addTab() {
  const tab = newTab(`Tab ${doc.tabs.length + 1}`, COLORS[doc.tabs.length % COLORS.length].id, { source: { kind: 'markdown', value: '' } })
  doc.tabs.push(tab)
  doc.activeId = tab.id
  renderTabs()
  loadActiveTab()
  save()
  startRename(tab.id)
}

function startRename(id) {
  if (locked) return
  const tab = doc.tabs.find((t) => t.id === id)
  const el = $(`#tab-${id}`)
  if (!tab || !el) return
  const input = document.createElement('input')
  input.className = 'tab-rename'
  input.value = tab.title
  input.setAttribute('aria-label', 'Tab name')
  input.size = Math.max(4, tab.title.length)
  el.replaceChildren(input)
  input.focus()
  input.select()
  let done = false
  const finish = (keep) => {
    if (done) return
    done = true
    const value = input.value.trim()
    if (keep && value && value !== tab.title) {
      tab.title = value.slice(0, 60)
      save()
    }
    renderTabs()
    $(`#tab-${id}`)?.focus()
  }
  input.addEventListener('input', () => { input.size = Math.max(4, input.value.length) })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') finish(true)
    if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
  input.addEventListener('click', (e) => e.stopPropagation())
}

function moveTab(id, delta) {
  const i = doc.tabs.findIndex((t) => t.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= doc.tabs.length) return
  const [tab] = doc.tabs.splice(i, 1)
  doc.tabs.splice(j, 0, tab)
  renderTabs()
  save()
}

function deleteTab(id) {
  if (doc.tabs.length === 1) return
  const i = doc.tabs.findIndex((t) => t.id === id)
  doc.tabs.splice(i, 1)
  histories.delete(id)
  if (doc.activeId === id) {
    doc.activeId = doc.tabs[Math.max(0, i - 1)].id
    renderTabs()
    loadActiveTab()
  } else renderTabs()
  save()
}

/* ---------- tab menu ---------- */

function openTabMenu(id, x, y) {
  if (locked) return
  closeDropdown()
  menuTabId = id
  const tab = doc.tabs.find((t) => t.id === id)
  const i = doc.tabs.indexOf(tab)
  tabMenu.querySelector('[data-act="left"]').disabled = i === 0
  tabMenu.querySelector('[data-act="right"]').disabled = i === doc.tabs.length - 1
  const del = tabMenu.querySelector('[data-act="delete"]')
  del.disabled = doc.tabs.length === 1
  del.textContent = 'Delete tab'
  delete del.dataset.armed
  tabMenu.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s.dataset.color === tab.color)))
  placeAt(tabMenu, x, y)
  tabMenu.querySelector('button:not(:disabled)').focus()
}

function closeTabMenu(refocus = true) {
  if (tabMenu.hidden) return
  tabMenu.hidden = true
  if (refocus && menuTabId) $(`#tab-${menuTabId}`)?.focus()
  menuTabId = null
}

function buildTabMenu() {
  const swatches = tabMenu.querySelector('.swatches')
  COLORS.forEach((c) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch'
    b.setAttribute('role', 'menuitemradio')
    b.dataset.color = c.id
    b.title = c.name
    b.setAttribute('aria-label', c.name)
    b.style.setProperty('--swatch', c.hex)
    swatches.append(b)
  })
  tabMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn || !menuTabId) return
    const id = menuTabId
    if (btn.dataset.color) {
      doc.tabs.find((t) => t.id === id).color = btn.dataset.color
      closeTabMenu()
      renderTabs()
      save()
      return
    }
    const act = btn.dataset.act
    if (act === 'delete') {
      const tab = doc.tabs.find((t) => t.id === id)
      const empty = !tabText(tab).trim()
      if (!empty && !btn.dataset.armed) {
        btn.dataset.armed = '1'
        btn.textContent = 'Click again to delete'
        return
      }
      closeTabMenu(false)
      deleteTab(id)
      return
    }
    closeTabMenu(act !== 'rename')
    if (act === 'rename') startRename(id)
    if (act === 'left') moveTab(id, -1)
    if (act === 'right') moveTab(id, 1)
  })
  tabMenu.addEventListener('keydown', (e) => menuKeys(e, tabMenu, () => closeTabMenu()))
}

function menuKeys(e, menu, close) {
  const items = [...menu.querySelectorAll('button:not(:disabled)')]
  const i = items.indexOf(document.activeElement)
  if (e.key === 'Escape') { e.preventDefault(); close() }
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); items[(i + 1) % items.length].focus() }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus() }
}

function placeAt(menu, x, y) {
  menu.hidden = false
  const r = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`
}

function bindTabs() {
  tablist.addEventListener('click', (e) => {
    const el = e.target.closest('.tab')
    if (el && el.dataset.id !== doc.activeId) selectTab(el.dataset.id)
  })
  tablist.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.tab')
    if (el) startRename(el.dataset.id)
  })
  tablist.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.tab')
    if (!el || locked) return
    e.preventDefault()
    openTabMenu(el.dataset.id, e.clientX, e.clientY)
  })
  tablist.addEventListener('keydown', (e) => {
    const el = e.target.closest('.tab')
    if (!el || e.target.tagName === 'INPUT') return
    const i = doc.tabs.findIndex((t) => t.id === el.dataset.id)
    const go = (j) => { e.preventDefault(); selectTab(doc.tabs[(j + doc.tabs.length) % doc.tabs.length].id, true) }
    if (e.key === 'ArrowRight') go(i + 1)
    if (e.key === 'ArrowLeft') go(i - 1)
    if (e.key === 'Home') go(0)
    if (e.key === 'End') go(doc.tabs.length - 1)
    if (e.key === 'F2') { e.preventDefault(); startRename(el.dataset.id) }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      openTabMenu(el.dataset.id, r.left, r.bottom + 4)
    }
  })
  let pressTimer = null
  tablist.addEventListener('touchstart', (e) => {
    const el = e.target.closest('.tab')
    if (!el) return
    const t = e.touches[0]
    pressTimer = setTimeout(() => openTabMenu(el.dataset.id, t.clientX, t.clientY), 550)
  }, { passive: true })
  const cancel = () => clearTimeout(pressTimer)
  tablist.addEventListener('touchend', cancel)
  tablist.addEventListener('touchmove', cancel, { passive: true })

  tablist.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.tab')
    if (!el) return
    dragId = el.dataset.id
    el.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', el.dataset.id)
  })
  tablist.addEventListener('dragover', (e) => {
    if (!dragId) return
    e.preventDefault()
    const over = e.target.closest('.tab')
    if (!over || over.dataset.id === dragId) return
    const from = doc.tabs.findIndex((t) => t.id === dragId)
    const to = doc.tabs.findIndex((t) => t.id === over.dataset.id)
    const [tab] = doc.tabs.splice(from, 1)
    doc.tabs.splice(to, 0, tab)
    renderTabs()
    $(`#tab-${dragId}`)?.classList.add('dragging')
  })
  const endDrag = () => {
    if (!dragId) return
    dragId = null
    renderTabs()
    save()
  }
  tablist.addEventListener('drop', (e) => { e.preventDefault(); endDrag() })
  tablist.addEventListener('dragend', endDrag)
  $('#add').addEventListener('click', addTab)
}

/* ================= formatting ================= */

const BLOCK_LABELS = {
  paragraph: 'Normal text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
  bullet: 'Bulleted list', number: 'Numbered list', check: 'Checklist', quote: 'Quote', code: 'Code block',
}

function $currentBlock() {
  const sel = $getSelection()
  if (!$isRangeSelection(sel)) return null
  const anchor = sel.anchor.getNode()
  let top = anchor.getKey() === 'root' ? anchor : $findMatchingParent(anchor, (e) => {
    const parent = e.getParent()
    return parent !== null && $isRootOrShadowRoot(parent)
  })
  if (!top) top = anchor.getTopLevelElement()
  return { anchor, top }
}

function $blockType() {
  const cur = $currentBlock()
  if (!cur || !cur.top) return 'paragraph'
  const { anchor, top } = cur
  if ($isListNode(top)) {
    const nearest = $getNearestNodeOfType(anchor, ListNode)
    return (nearest || top).getListType()
  }
  if ($isHeadingNode(top)) return top.getTag()
  if ($isQuoteNode(top)) return 'quote'
  if ($isCodeNode(top)) return 'code'
  return 'paragraph'
}

function setBlock(type) {
  const current = editor.getEditorState().read($blockType)
  const lists = { bullet: INSERT_UNORDERED_LIST_COMMAND, number: INSERT_ORDERED_LIST_COMMAND, check: INSERT_CHECK_LIST_COMMAND }
  if (lists[type]) {
    editor.dispatchCommand(current === type ? REMOVE_LIST_COMMAND : lists[type], undefined)
    editor.focus()
    return
  }
  editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel)) return
    const target = current === type ? 'paragraph' : type
    if (target === 'paragraph') $setBlocksType(sel, () => $createParagraphNode())
    else if (/^h[1-6]$/.test(target)) $setBlocksType(sel, () => $createHeadingNode(target))
    else if (target === 'quote') $setBlocksType(sel, () => $createQuoteNode())
    else if (target === 'code') $setBlocksType(sel, () => $createCodeNode())
  })
  editor.focus()
}

let selectNewTable = false
function insertTable() {
  selectNewTable = true
  editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '3', columns: '3', includeHeaders: { rows: true, columns: false } })
}

// Put the cursor in the first cell of a newly inserted table, like Super does
editor.registerMutationListener(TableNode, (mutations) => {
  if (!selectNewTable) return
  for (const [key, type] of mutations) {
    if (type !== 'created') continue
    selectNewTable = false
    editor.update(() => {
      const table = $getNodeByKey(key)
      // Drop the empty line the table was inserted from
      const prev = table && table.getPreviousSibling()
      if (prev && prev.getType() === 'paragraph' && prev.getTextContentSize() === 0 && prev.getChildrenSize() === 0) prev.remove()
      const cell = table && table.getFirstChild() && table.getFirstChild().getFirstChild()
      const para = cell && cell.getFirstChild()
      if (para) para.selectStart()
    })
    editor.focus()
  }
}, { skipInitialization: true })

function insertDivider() {
  editor.update(() => { $insertNodeToNearestRoot($createHorizontalRuleNode()) })
}

/* ---------- collapsible sections ---------- */

function $unwrapToParagraph(title) {
  const p = $createParagraphNode()
  title.getChildren().forEach((c) => p.append(c))
  return p
}

mergeRegister(
  // Keep every section shaped as [title, content]; anything else is turned back into normal blocks.
  editor.registerNodeTransform(CollapsibleContainerNode, (node) => {
    const children = node.getChildren()
    const valid = children.length === 2 && $isCollapsibleTitleNode(children[0]) && $isCollapsibleContentNode(children[1])
    if (!valid) {
      for (const child of children) {
        if ($isCollapsibleTitleNode(child)) node.insertBefore($unwrapToParagraph(child))
        else if ($isCollapsibleContentNode(child)) child.getChildren().forEach((c) => node.insertBefore(c))
        else if (child.isInline()) node.insertBefore($createParagraphNode().append(child))
        else node.insertBefore(child)
      }
      node.remove()
      return
    }
    // Always leave a line after a section so the cursor can get out of it
    if (!node.getNextSibling()) node.insertAfter($createParagraphNode())
  }),
  editor.registerNodeTransform(CollapsibleTitleNode, (node) => {
    if (!$isCollapsibleContainerNode(node.getParent())) node.replace($unwrapToParagraph(node))
  }),
  editor.registerNodeTransform(CollapsibleContentNode, (node) => {
    if ($isCollapsibleContainerNode(node.getParent())) return
    node.getChildren().forEach((c) => node.insertBefore(c))
    node.remove()
  }),
)

function insertCollapsible() {
  editor.update(() => {
    const title = $createCollapsibleTitleNode()
    const container = $createCollapsibleContainerNode(true).append(
      title,
      $createCollapsibleContentNode().append($createParagraphNode()),
    )
    const sel = $getSelection()
    const anchor = $isRangeSelection(sel) ? sel.anchor.getNode() : null
    const block = anchor && (anchor.getType() === 'paragraph' ? anchor : anchor.getParent())
    if (block && block.getType() === 'paragraph' && block.getTextContentSize() === 0 && $isRootOrShadowRoot(block.getParent())) {
      block.replace(container)
    } else {
      $insertNodeToNearestRoot(container)
    }
    title.select()
  })
  editor.focus()
}

// Clicking the arrow at the left of a section title opens or closes it
page.addEventListener('pointerdown', (e) => {
  const title = e.target.closest && e.target.closest('.Collapsible__title')
  if (!title || e.button !== 0) return
  const rect = title.getBoundingClientRect()
  if (e.clientX - rect.left > 22) return
  e.preventDefault()
  editor.update(() => {
    const node = $getNearestNodeFromDOMNode(title)
    const container = node && $findMatchingParent(node, $isCollapsibleContainerNode)
    if (container) container.toggleOpen()
  })
}, true)

function tableAction(act) {
  editor.update(() => {
    if (act === 'row') $insertTableRowAtSelection(true)
    if (act === 'col') $insertTableColumnAtSelection(true)
    if (act === 'delrow') $deleteTableRowAtSelection()
    if (act === 'delcol') $deleteTableColumnAtSelection()
    if (act === 'deltable') {
      const sel = $getSelection()
      const node = sel && sel.getNodes()[0]
      const tableNode = node && $findMatchingParent(node, $isTableNode)
      if (tableNode) tableNode.remove()
    }
  })
}

/* Ask for a URL in a small inline box (browser prompts can be blocked inside Standard Notes). */
function askUrl(label, onSubmit) {
  const saved = editor.getEditorState().read(() => {
    const s = $getSelection()
    return s ? s.clone() : null
  })
  const input = ask.querySelector('input')
  ask.querySelector('label').textContent = label
  input.value = ''
  const r = toolbar.getBoundingClientRect()
  placeAt(ask, r.left + 10, r.bottom + 4)
  input.focus()
  const close = () => { ask.hidden = true; cleanup() }
  const submit = () => {
    let url = input.value.trim()
    if (url && !/^[a-z]+:/i.test(url)) url = `https://${url}`
    close()
    if (!url || !/^(https?:|mailto:)/i.test(url)) return
    editor.update(() => {
      if (saved) $setSelection(saved.clone())
      onSubmit(url)
    })
    editor.focus()
  }
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    if (e.key === 'Escape') { e.preventDefault(); close(); editor.focus() }
  }
  const onClick = (e) => {
    const act = e.target.closest('button')?.dataset.ask
    if (act === 'ok') submit()
    if (act === 'cancel') { close(); editor.focus() }
  }
  const cleanup = () => {
    input.removeEventListener('keydown', onKey)
    ask.removeEventListener('click', onClick)
  }
  input.addEventListener('keydown', onKey)
  ask.addEventListener('click', onClick)
}

function toggleLink() {
  const inLink = editor.getEditorState().read(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel)) return false
    return !!$findMatchingParent(sel.anchor.getNode(), $isLinkNode)
  })
  if (inLink) {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    return
  }
  askUrl('Link address', (url) => $toggleLink(url))
}

function insertImage() {
  askUrl('Image address', (url) => $insertNodes([$createImageNode(url, '')]))
}

/* Everything the "/" menu and the Insert menu can do. */
const ACTIONS = [
  { id: 'paragraph', label: 'Normal text', icon: 'text', keys: 'paragraph text', run: () => setBlock('paragraph') },
  { id: 'h1', label: 'Heading 1', icon: 'h1', keys: 'title big', run: () => setBlock('h1') },
  { id: 'h2', label: 'Heading 2', icon: 'h2', keys: 'subtitle', run: () => setBlock('h2') },
  { id: 'h3', label: 'Heading 3', icon: 'h3', keys: 'small', run: () => setBlock('h3') },
  { id: 'bullet', label: 'Bulleted list', icon: 'bullet', keys: 'unordered ul', run: () => setBlock('bullet') },
  { id: 'number', label: 'Numbered list', icon: 'number', keys: 'ordered ol', run: () => setBlock('number') },
  { id: 'check', label: 'Checklist', icon: 'check', keys: 'todo task checkbox', run: () => setBlock('check') },
  { id: 'quote', label: 'Quote', icon: 'quote', keys: 'blockquote', run: () => setBlock('quote') },
  { id: 'code', label: 'Code block', icon: 'codeblock', keys: 'pre snippet', run: () => setBlock('code') },
  { id: 'table', label: 'Table', icon: 'table', keys: 'grid rows columns', run: insertTable },
  { id: 'collapsible', label: 'Collapsible section', icon: 'collapsible', keys: 'toggle details fold expand hide', run: insertCollapsible },
  { id: 'divider', label: 'Divider', icon: 'divider', keys: 'line hr rule separator', run: insertDivider },
  { id: 'upload', label: 'Image from device', icon: 'image', keys: 'picture photo screenshot upload file', run: () => images && images.chooseFromDevice() },
  { id: 'image', label: 'Image from URL', icon: 'link', keys: 'picture photo web address', run: insertImage },
]

/* ---------- dropdowns ---------- */


function openDropdown(owner, items) {
  closeTabMenu(false)
  if (dropdownOwner === owner && !dropdown.hidden) { closeDropdown(); return }
  dropdown.replaceChildren(...items.map((item) => {
    if (item === '-') return document.createElement('hr')
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'menuitem')
    if (item.active) b.classList.add('on')
    b.innerHTML = `${item.icon ? ICONS[item.icon] : ''}<span></span>`
    b.querySelector('span').textContent = item.label
    b.addEventListener('click', () => { closeDropdown(); item.run() })
    return b
  }))
  dropdownOwner = owner
  owner.setAttribute('aria-expanded', 'true')
  const r = owner.getBoundingClientRect()
  placeAt(dropdown, r.left, r.bottom + 4)
}

function closeDropdown() {
  if (dropdown.hidden) return
  dropdown.hidden = true
  if (dropdownOwner) dropdownOwner.setAttribute('aria-expanded', 'false')
  dropdownOwner = null
}

function bindToolbar() {
  const keepSelection = (e) => { if (!e.target.closest('input')) e.preventDefault() }
  toolbar.addEventListener('mousedown', keepSelection)
  dropdown.addEventListener('mousedown', keepSelection)
  slashMenu.addEventListener('mousedown', keepSelection)
  dropdown.addEventListener('keydown', (e) => menuKeys(e, dropdown, () => { const o = dropdownOwner; closeDropdown(); o?.focus() }))

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn || locked) return
    const cmd = btn.dataset.cmd
    const block = editor.getEditorState().read($blockType)
    switch (cmd) {
      case 'block':
        openDropdown(btn, ACTIONS.slice(0, 9).map((a) => ({ ...a, active: a.id === block })))
        break
      case 'bold': case 'italic': case 'underline': case 'strikethrough': case 'code': case 'highlight':
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, cmd)
        break
      case 'link': toggleLink(); break
      case 'bullet': case 'number': case 'check': setBlock(cmd); break
      case 'align':
        openDropdown(btn, [
          { label: 'Align left', icon: 'alignLeft', run: () => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left') },
          { label: 'Align center', icon: 'alignCenter', run: () => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center') },
          { label: 'Align right', icon: 'alignRight', run: () => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right') },
          { label: 'Justify', icon: 'alignJustify', run: () => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'justify') },
        ])
        break
      case 'outdent': editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined); break
      case 'indent': editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined); break
      case 'insert': openDropdown(btn, ACTIONS.slice(9)); break
      case 'table':
        openDropdown(btn, [
          { label: 'Add row below', run: () => tableAction('row') },
          { label: 'Add column right', run: () => tableAction('col') },
          '-',
          { label: 'Delete row', run: () => tableAction('delrow') },
          { label: 'Delete column', run: () => tableAction('delcol') },
          { label: 'Delete table', run: () => tableAction('deltable') },
        ])
        break
      case 'search': search.open(); break
      case 'undo': editor.dispatchCommand(UNDO_COMMAND, undefined); break
      case 'redo': editor.dispatchCommand(REDO_COMMAND, undefined); break
    }
  })

  document.addEventListener('mousedown', (e) => {
    if (!tabMenu.contains(e.target)) closeTabMenu(false)
    if (!dropdown.contains(e.target) && !e.target.closest('[aria-haspopup]')) closeDropdown()
    if (!slashMenu.contains(e.target)) closeSlash()
    if (!ask.hidden && !ask.contains(e.target)) ask.hidden = true
  })
}

function updateToolbar() {
  editor.getEditorState().read(() => {
    const sel = $getSelection()
    const block = $blockType()
    $('#block-label').textContent = BLOCK_LABELS[block] || 'Normal text'
    const formats = ['bold', 'italic', 'underline', 'strikethrough', 'code', 'highlight']
    let inLink = false
    let inTable = false
    if ($isRangeSelection(sel)) {
      formats.forEach((f) => toolbar.querySelector(`[data-cmd="${f}"]`).setAttribute('aria-pressed', String(sel.hasFormat(f))))
      const node = sel.anchor.getNode()
      inLink = !!$findMatchingParent(node, $isLinkNode)
      inTable = !!$findMatchingParent(node, $isTableCellNode)
    } else {
      formats.forEach((f) => toolbar.querySelector(`[data-cmd="${f}"]`).setAttribute('aria-pressed', 'false'))
    }
    ;['bullet', 'number', 'check'].forEach((t) => toolbar.querySelector(`[data-cmd="${t}"]`).setAttribute('aria-pressed', String(block === t)))
    toolbar.querySelector('[data-cmd="link"]').setAttribute('aria-pressed', String(inLink))
    toolbar.querySelector('[data-cmd="table"]').hidden = !inTable
  })
}

function updatePlaceholder() {
  const empty = editor.getEditorState().read(() => {
    const root = $getRoot()
    if (root.getChildrenSize() !== 1) return false
    const first = root.getFirstChild()
    return first.getType() === 'paragraph' && first.getTextContentSize() === 0
  })
  placeholder.hidden = !empty || locked
}

/* ================= "/" command menu ================= */


function checkSlash() {
  if (locked) return closeSlash()
  const match = editor.getEditorState().read(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return null
    const node = sel.anchor.getNode()
    if (!$isTextNode(node) || $findMatchingParent(node, $isCodeNode)) return null
    const before = node.getTextContent().slice(0, sel.anchor.offset)
    const m = /(?:^|\s)\/([a-z0-9]*(?: [a-z0-9]+)?)$/i.exec(before)
    return m ? { key: node.getKey(), offset: sel.anchor.offset, query: m[1].toLowerCase() } : null
  })
  if (!match) return closeSlash()
  const items = ACTIONS.filter((a) => `${a.label} ${a.keys}`.toLowerCase().includes(match.query))
  if (!items.length) return closeSlash()
  const sameQuery = slash && slash.query === match.query
  slash = { ...match, items, index: sameQuery ? Math.min(slash.index, items.length - 1) : 0 }
  renderSlash()
}

function renderSlash() {
  slashMenu.replaceChildren(...slash.items.map((item, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'option')
    b.setAttribute('aria-selected', String(i === slash.index))
    b.innerHTML = `${ICONS[item.icon]}<span></span>`
    b.querySelector('span').textContent = item.label
    b.addEventListener('click', () => chooseSlash(i))
    return b
  }))
  const sel = window.getSelection()
  let rect = null
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0).cloneRange()
    rect = range.getClientRects()[0] || range.getBoundingClientRect()
    if (!rect || (rect.top === 0 && rect.left === 0)) rect = sel.anchorNode?.parentElement?.getBoundingClientRect()
  }
  rect = rect || page.getBoundingClientRect()
  slashMenu.hidden = false
  const h = slashMenu.offsetHeight
  const below = rect.bottom + 6
  const top = below + h > innerHeight - 4 ? Math.max(4, rect.top - h - 6) : below
  slashMenu.style.top = `${top}px`
  slashMenu.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - slashMenu.offsetWidth - 4))}px`
  slashMenu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
}

function closeSlash() {
  slash = null
  slashMenu.hidden = true
}

function chooseSlash(i) {
  if (!slash) return
  const item = slash.items[i]
  const { key, offset, query } = slash
  closeSlash()
  editor.update(() => {
    const node = $getNodeByKey(key)
    if ($isTextNode(node)) {
      const len = query.length + 1
      const start = Math.max(0, offset - len)
      node.spliceText(start, len, '', true)
    }
  }, { discrete: true })
  item.run()
}

editor.registerCommand(KEY_ARROW_DOWN_COMMAND, (e) => {
  if (!slash) return false
  e.preventDefault()
  slash.index = (slash.index + 1) % slash.items.length
  renderSlash()
  return true
}, COMMAND_PRIORITY_CRITICAL)
editor.registerCommand(KEY_ARROW_UP_COMMAND, (e) => {
  if (!slash) return false
  e.preventDefault()
  slash.index = (slash.index - 1 + slash.items.length) % slash.items.length
  renderSlash()
  return true
}, COMMAND_PRIORITY_CRITICAL)
const choose = (e) => {
  if (!slash) return false
  if (e) e.preventDefault()
  chooseSlash(slash.index)
  return true
}
editor.registerCommand(KEY_ENTER_COMMAND, choose, COMMAND_PRIORITY_CRITICAL)
editor.registerCommand(KEY_TAB_COMMAND, choose, COMMAND_PRIORITY_CRITICAL)
editor.registerCommand(KEY_ESCAPE_COMMAND, () => {
  if (!slash) return false
  closeSlash()
  return true
}, COMMAND_PRIORITY_CRITICAL)

/* Ctrl/Cmd+click opens links */
page.addEventListener('click', (e) => {
  const a = e.target.closest('a')
  if (a && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    window.open(a.href, '_blank', 'noopener')
  }
})

/* ================= drag handles for reordering blocks ================= */

const wrap = $('.editor-wrap')
const handle = $('#drag-handle')
const dropLine = $('#drop-line')
let hoverKey = null
let dragKey = null
let dropAt = null

function topBlockAt(y) {
  const keys = editor.getEditorState().read(() => $getRoot().getChildrenKeys())
  let last = null
  for (const key of keys) {
    const el = editor.getElementByKey(key)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (rect.height === 0) continue
    last = { key, el, rect }
    if (y < rect.bottom + 3) return last
  }
  return last
}

function hideHandle() {
  handle.classList.remove('visible')
  hoverKey = null
}

function showHandle(block) {
  const wrapRect = wrap.getBoundingClientRect()
  const style = getComputedStyle(block.el)
  let lineHeight = parseFloat(style.lineHeight)
  if (Number.isNaN(lineHeight)) lineHeight = parseFloat(style.fontSize) * 1.5
  const offset = Math.max(0, (Math.min(lineHeight, block.rect.height) - handle.offsetHeight) / 2) + parseFloat(style.paddingTop || 0)
  handle.style.top = `${block.rect.top - wrapRect.top + wrap.scrollTop + offset}px`
  handle.classList.add('visible')
  hoverKey = block.key
}

wrap.addEventListener('mousemove', (e) => {
  if (locked || dragKey || handle.contains(e.target)) return
  const pageRect = page.getBoundingClientRect()
  if (e.clientY < pageRect.top) return hideHandle()
  const block = topBlockAt(e.clientY)
  if (!block || e.clientY > block.rect.bottom + 8) return hideHandle()
  showHandle(block)
})
wrap.addEventListener('mouseleave', () => { if (!dragKey) hideHandle() })
page.addEventListener('keydown', () => { if (!dragKey) hideHandle() })

handle.addEventListener('dragstart', (e) => {
  if (!hoverKey || locked) { e.preventDefault(); return }
  dragKey = hoverKey
  const el = editor.getElementByKey(dragKey)
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/x-tabbed-notes-block', dragKey)
  if (el) e.dataTransfer.setDragImage(el, 0, 0)
  closeSlash()
})

function endBlockDrag() {
  dragKey = null
  dropAt = null
  dropLine.hidden = true
  hideHandle()
}

wrap.addEventListener('dragover', (e) => {
  if (!dragKey) return
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  const block = topBlockAt(e.clientY)
  if (!block) return
  const before = e.clientY < block.rect.top + block.rect.height / 2
  dropAt = { key: block.key, before }
  const wrapRect = wrap.getBoundingClientRect()
  const pageRect = page.getBoundingClientRect()
  const padLeft = parseFloat(getComputedStyle(page).paddingLeft)
  const padRight = parseFloat(getComputedStyle(page).paddingRight)
  const y = before ? block.rect.top : block.rect.bottom
  dropLine.style.top = `${y - wrapRect.top + wrap.scrollTop - 2}px`
  dropLine.style.left = `${pageRect.left - wrapRect.left + padLeft}px`
  dropLine.style.width = `${pageRect.width - padLeft - padRight}px`
  dropLine.hidden = false
}, true)

wrap.addEventListener('drop', (e) => {
  if (!dragKey) return
  e.preventDefault()
  e.stopPropagation()
  const from = dragKey
  const target = dropAt
  endBlockDrag()
  if (!target || target.key === from) return
  editor.update(() => {
    const moving = $getNodeByKey(from)
    const anchorNode = $getNodeByKey(target.key)
    if (!moving || !anchorNode) return
    if (target.before) anchorNode.insertBefore(moving)
    else anchorNode.insertAfter(moving)
  })
}, true)

handle.addEventListener('dragend', endBlockDrag)

/* ================= text size (matches Super's defaults) ================= */

function applyTextSize() {
  // Super's defaults: 15px on desktop, 16px on tablet-sized screens, 18px on phones.
  const mobileApp = relay && relay.isRunningInMobileApplication()
  const width = mobileApp ? Math.min(window.screen.width, window.screen.height) : window.screen.width
  let size = 'var(--sn-stylekit-font-size-editor, 0.9375rem)'
  if (width < 768) size = '1.125rem'
  else if (width < 1024 || mobileApp) size = '1rem'
  document.documentElement.style.setProperty('--size', size)
}

/* ================= search ================= */

search = createSearch({
  editor,
  getDoc: () => doc,
  selectTab: (id) => selectTab(id),
  renderTabs: () => { if (doc) renderTabs() },
  isLocked: () => locked,
  ensureStates,
  scrollContainer: wrap,
})

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    search.open()
  }
}, true)

/* ================= images and messages ================= */

let toastTimer = null
function toast(message, kind = 'info') {
  const el = $('#toast')
  el.textContent = message
  el.className = `toast ${kind}`
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, kind === 'error' ? 8000 : 6000)
}
$('#toast').addEventListener('click', () => { $('#toast').hidden = true })

images = createImages({
  editor,
  page,
  wrap,
  isLocked: () => locked,
  toast,
  noteSize: () => (doc ? serialize().length : 0),
  topBlockAt,
})

/* ================= Standard Notes bridge ================= */

function isLocked(n) {
  const sn = n && n.content && n.content.appData && n.content.appData['org.standardnotes.sn']
  return !!(sn && sn.locked)
}

/*
 * Standard Notes' Android and iOS apps now run the web app inside a WebView at a file:// address.
 * The plugin library still sends messages the old mobile way (as JSON text to the exact parent
 * origin), which the current apps ignore, so the editor never receives its note. This sends plain
 * message objects instead, and uses "*" only when the parent has no usable origin (file://).
 */
function patchRelayForMobile(r) {
  r.postMessage = function postMessage(action, data, callback) {
    if (!this.component.sessionKey) {
      this.messageQueue.push({ action, data, api: 'component', callback })
      return
    }
    const message = { action, data, messageId: this.generateUUID(), sessionKey: this.component.sessionKey, api: 'component' }
    const record = JSON.parse(JSON.stringify(message))
    record.callback = callback
    this.sentMessages.push(record)
    const origin = this.component.origin
    const opaque = !origin || origin === 'null' || origin.startsWith('file:')
    this.contentWindow.parent.postMessage(message, opaque ? '*' : origin)
  }
}

function connect() {
  relay = new ComponentRelay({
    targetWindow: window,
    options: { coallesedSaving: true, coallesedSavingDelay: 400 },
    onReady: applyTextSize,
  })
  patchRelayForMobile(relay)
  relay.streamContextItem((incoming) => {
    const switched = !note || incoming.uuid !== note.uuid
    note = incoming
    const wasLocked = locked
    locked = isLocked(incoming)
    page.spellcheck = incoming.content.spellcheck !== false
    const text = incoming.content.text || ''
    if (!switched && (incoming.isMetadataUpdate || text === lastSaved)) {
      if (wasLocked !== locked) { renderTabs(); applyLock(); updatePlaceholder() }
      return
    }
    const keepId = !switched && doc ? doc.activeId : null
    if (switched) {
      histories.clear()
      // The relay keeps already-flushed items from the previous note in its queue; drop them
      // so they aren't saved again along with this note.
      if (Array.isArray(relay.pendingSaveItems)) relay.pendingSaveItems = []
    }
    doc = parseText(text)
    if (keepId && doc.tabs.some((t) => t.id === keepId)) doc.activeId = keepId
    lastSaved = text
    renderAll()
  })
}

function demo() {
  notice.hidden = false
  const md = (s) => ({ source: { kind: 'markdown', value: s } })
  doc = {
    activeId: 'a',
    tabs: [
      { id: 'a', title: 'Overview', color: 'blue', ...md('# Trip planning\nEach tab is its own page inside this one note. Type **/** for blocks, or use Markdown like `#`, `-`, `[ ]` and `>`. Hover over a line and drag the handle on the left to move it.\n\n- [x] Flights booked\n- [ ] Hotel deposit\n\n> Leave by 7am on Friday.') },
      { id: 'b', title: 'Packing list', color: 'green', ...md('- Rain jacket\n- Adapters\n- Chargers') },
      { id: 'c', title: 'Budget', color: 'gold', ...md('Lodging $640, food $300.') },
    ],
  }
  renderAll()
}

document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', ICONS[el.dataset.icon]))
applyTextSize()
buildTabMenu()
bindTabs()
bindToolbar()
if (window.parent !== window) connect()
else demo()

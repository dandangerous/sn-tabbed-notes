# Tabbed Notes for Standard Notes

OneNote-style tabs inside a single [Standard Notes](https://standardnotes.com) note. Each tab is its own rich-text page that looks and works like a Super note, with its own name and color.

![Tabbed Notes editor showing colored tabs, a checklist, a collapsible section, and a table](screenshot.png)

## Features

**Tabs**
- Add as many tabs as you like to a single note
- Rename tabs, give each one a color, and drag them into any order
- Each tab keeps its own undo history

**Super-style editing on every tab**
- Type `/` for a block menu: headings, lists, checklists, quotes, code blocks, tables, collapsible sections, dividers, and images
- Markdown shortcuts as you type
- Drag handles to move blocks up and down
- Collapsible sections
- Tables with header rows
- Super's default font, text size, and line spacing
- Follows your Standard Notes theme, including dark themes

**Works with your existing notes**
- Open a Super note in Tabbed Notes and its content goes into the first tab, including checklists, tables, links, and collapsible sections
- Malformed Super content (the kind that can make a Super note open blank) is repaired rather than failing
- Plain text and Markdown notes are converted on the way in
- Nothing is saved until you make an edit

## Compatibility

| Platform | Status |
| --- | --- |
| Web app (app.standardnotes.com) | ✅ Works once installed |
| Desktop app (Windows, macOS, Linux) | ✅ Works |
| Android app | ✅ Works (from plugin version 2.2.0) |
| iOS app | ⚠️ Not yet tested; expected to work the same as Android |

Tested with Standard Notes 3.202.9.

## Installation

> [!IMPORTANT]
> As of Standard Notes **3.202.9**, custom plugins can't be installed from the current apps. The web app blocks plugin downloads from most addresses, and fails with *"Error downloading package details"* even for allowed ones. The workaround below uses an older desktop app once, just to install the plugin. After that, the plugin works in current versions of every app.

### 1. Back up your notes

In Standard Notes, open **Preferences → Backups** and download a backup. Make sure your notes have finished syncing.

### 2. Install the older desktop app

Download and install Standard Notes desktop **3.191.4** from the [Standard Notes releases page](https://github.com/standardnotes/app/releases). Search the page for `desktop@3.191.4` to find it, and choose the installer for your system. Sign in to your account.

### 3. Install the plugin

In the older app, open **Preferences → Plugins**, choose **Install Custom Plugin**, and paste:

```
https://dandangerous.github.io/sn-tabbed-notes/ext.json
```

### 4. Update the desktop app

Update the desktop app to the latest version, or reinstall it from [standardnotes.com](https://standardnotes.com/download). Installed plugins are saved to your account, so Tabbed Notes stays installed and also appears in the web and mobile apps.

### 5. Start using it

Create a new note, open the note type menu, and choose **Tabbed Notes**.

## Usage

### Tabs

| Action | How |
| --- | --- |
| Add a tab | Click **+** next to the tabs |
| Rename a tab | Double-click it, or focus it and press `F2` |
| Change color, move, or delete | Right-click the tab (long-press on touch screens) |
| Reorder | Drag a tab left or right |
| Switch tabs from the keyboard | Focus a tab, then use `←` `→` `Home` `End` |

Deleting a tab that has content asks you to click a second time to confirm.

### Blocks and formatting

Type `/` anywhere to open the block menu. Keep typing to filter it, use `↑` `↓` to choose, and press `Enter`.

Hover over any block and drag the handle that appears on its left to move it. Drag handles aren't available on touch screens.

To add a collapsible section, type `/collapsible`. Click the arrow next to its title to open or close it. Press `Enter` in the title to move into the section. Press `Backspace` at the start of the title to turn it back into normal text.

Click inside a table to show the table button in the toolbar, for adding or deleting rows and columns.

### Markdown shortcuts

| Type | To get |
| --- | --- |
| `# ` to `###### ` | Headings 1 to 6 |
| `- ` or `* ` | Bulleted list |
| `1. ` | Numbered list |
| `[] ` or `[x] ` | Checklist |
| `> ` | Quote |
| ```` ``` ```` | Code block |
| `---` | Divider |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `==highlight==` | Inline formatting |

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd + B`, `I`, `U` | Bold, italic, underline |
| `Tab` / `Shift + Tab` | Indent / outdent (in tables: next / previous cell) |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + click` | Open a link |

## How your data is stored

Tabs are saved as JSON in the note's text, so they sync, stay end-to-end encrypted, appear in note history, and are included in backups like any other note. Each tab's content uses the same format as Super.

If you switch a tabbed note to a different editor, you'll see the raw JSON. Your content is still there; switch back to Tabbed Notes to see the tabs again.

The editor makes no network requests of its own. It only loads images you insert from web addresses.

## Limitations

- **Images** are added from a web address. Plugins can't upload image files.
- **Code blocks** don't color-highlight by programming language.
- **Find and replace** isn't available inside the editor.
- **Text size and line spacing** follow Super's defaults. Plugins can't read the font size or line height you've set in Standard Notes preferences.

## Troubleshooting

**"Error downloading package details" when installing.** This is the Standard Notes issue described under [Installation](#installation). Use the older desktop app to install.

**The editor still looks like an older version.** GitHub Pages caches files for up to 10 minutes. Wait, then restart Standard Notes.

**An empty note with no tabs on Android.** Update to plugin version 2.2.0 or later.

## Building from source

The `source` folder contains the code. You need [Node.js](https://nodejs.org).

```bash
cd source
npm install
npm run build
```

This rewrites `index.html` in the repository root. Bump `version` in `ext.json` when you publish a change.

The editor is built on [Lexical](https://lexical.dev), the same editing engine Super uses, and talks to Standard Notes through [`@standardnotes/component-relay`](https://github.com/standardnotes/component-relay).

## Changelog

- **2.2.0** — Fixes the Android app showing an empty note with no tabs.
- **2.1.0** — Super's typography, drag handles for moving blocks, and collapsible sections.
- **2.0.0** — Super-style editing on each tab, built on Lexical. Opens Super notes and repairs malformed ones.
- **1.0.0** — First release: tabs with rich-text pages.

## License

[AGPL-3.0](LICENSE). This project bundles `@standardnotes/component-relay`, which is licensed under AGPL-3.0. Lexical is licensed under MIT.

Not affiliated with or endorsed by Standard Notes.

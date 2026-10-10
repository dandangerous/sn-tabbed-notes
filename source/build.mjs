import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
const out = await build({ entryPoints: ['./app.js'], bundle: true, minify: true, format: 'iife', target: 'es2019', write: false, legalComments: 'inline' })
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = readFileSync('template.html', 'utf8').replace('<script>/*APP*/</script>', () => `<script>${js}</script>`)

writeFileSync('../index.html', html)
console.log('built', (html.length/1024).toFixed(1), 'KB')

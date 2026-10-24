/**
 * Concatenate client/parts/*.js into the single client.js DSH's module loader reads.
 * Edit the parts, then run: node scripts/build-client.mjs
 * `node scripts/build-client.mjs --check` exits 1 when client.js is out of date.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const partsDir = path.join(root, 'client', 'parts')
const target = path.join(root, 'client.js')

const files = readdirSync(partsDir).filter((name) => name.endsWith('.js')).sort()
if (files.length === 0) {
  console.error('client/parts is empty')
  process.exit(1)
}

const newline = readFileSync(path.join(partsDir, files[0]), 'utf8').includes('\r\n') ? '\r\n' : '\n'
const body = files.map((name) => readFileSync(path.join(partsDir, name), 'utf8').replace(/\r?\n$/, '')).join(newline) + newline

if (!body.includes('window.__ModuleLoader__.load') || !body.includes('function GitWorkbenchPanel')) {
  console.error('assembled client.js is missing the loader entry or the panel')
  process.exit(1)
}

const next = createHash('sha256').update(body).digest('hex')
const check = process.argv.includes('--check')
if (check) {
  let current = ''
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    console.error('client.js is missing; run node scripts/build-client.mjs')
    process.exit(1)
  }
  const prev = createHash('sha256').update(current).digest('hex')
  if (prev !== next) {
    console.error('client.js does not match client/parts; run node scripts/build-client.mjs')
    process.exit(1)
  }
  console.log(`client.js matches ${files.length} parts`)
  process.exit(0)
}

writeFileSync(target, body)
console.log(`wrote client.js from ${files.length} parts`)

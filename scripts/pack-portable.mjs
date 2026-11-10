/**
 * Assemble dist/GitWorkbench: a folder you can zip and run on another Windows PC.
 * Downloads node.exe and MinGit into that folder. Does not run installers or touch
 * the registry. Re-running keeps workspaces.txt and data/state.json if they exist.
 *
 *   node scripts/pack-portable.mjs
 */
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { cp, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist', 'GitWorkbench')
const nodeUrl = 'https://nodejs.org/dist/v22.21.0/win-x64/node.exe'
const nodeMirror = 'https://npmmirror.com/mirrors/node/v22.21.0/win-x64/node.exe'
const gitUrls = [
  'https://registry.npmmirror.com/-/binary/git-for-windows/v2.51.0.windows.1/MinGit-2.51.0-64-bit.zip',
  'https://cdn.npmmirror.com/binaries/git-for-windows/v2.51.0.windows.1/MinGit-2.51.0-64-bit.zip',
  'https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.1/MinGit-2.51.0-64-bit.zip',
]

async function download(url, file) {
  console.log(`下载 ${url}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  let response
  try {
    response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status} ${url}`)
  await pipeline(response.body, createWriteStream(file))
}

async function downloadFirst(urls, file) {
  let last
  for (const url of urls) {
    try {
      await download(url, file)
      return
    } catch (error) {
      last = error
      console.error(String((error && error.message) || error))
    }
  }
  throw last
}

async function flattenGit(dir) {
  if (existsSync(path.join(dir, 'cmd', 'git.exe'))) return
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs = entries.filter((entry) => entry.isDirectory())
  if (dirs.length !== 1 || entries.some((entry) => !entry.isDirectory())) return
  const nested = path.join(dir, dirs[0].name)
  if (!existsSync(path.join(nested, 'cmd', 'git.exe'))) return
  const temp = await mkdtemp(path.join(tmpdir(), 'mingit-'))
  await rename(nested, path.join(temp, 'git'))
  await rm(dir, { recursive: true, force: true })
  await rename(path.join(temp, 'git'), dir)
  await rm(temp, { recursive: true, force: true })
}

async function ensureGit(gitDir) {
  if (existsSync(path.join(gitDir, 'cmd', 'git.exe'))) {
    console.log('git\\ 已在，跳过下载')
    return
  }
  mkdirSync(path.dirname(gitDir), { recursive: true })
  const zip = path.join(path.dirname(gitDir), 'MinGit.zip')
  await downloadFirst(gitUrls, zip)
  mkdirSync(gitDir, { recursive: true })
  const extracted = spawnSync('tar', ['-xf', zip, '-C', gitDir], { stdio: 'inherit' })
  if (extracted.status !== 0) throw new Error('解压 MinGit 失败。Windows 10 自带 tar，请确认 tar 可用。')
  await rm(zip, { force: true })
  await flattenGit(gitDir)
  if (!existsSync(path.join(gitDir, 'cmd', 'git.exe'))) {
    throw new Error('解压后的 git\\cmd\\git.exe 不存在')
  }
}

async function main() {
  mkdirSync(path.join(out, 'app'), { recursive: true })
  mkdirSync(path.join(out, 'runtime'), { recursive: true })
  mkdirSync(path.join(out, 'data'), { recursive: true })

  await cp(path.join(root, 'host'), path.join(out, 'app', 'host'), { recursive: true })
  await cp(path.join(root, 'portable', 'server.mjs'), path.join(out, 'app', 'server.mjs'))
  await cp(path.join(root, 'portable', 'www'), path.join(out, 'app', 'www'), { recursive: true })
  await cp(path.join(root, 'client.js'), path.join(out, 'app', 'www', 'client.js'))
  await cp(path.join(root, 'portable', '打开.bat'), path.join(out, '打开.bat'))
  await cp(path.join(root, 'portable', '使用说明.txt'), path.join(out, '使用说明.txt'))
  writeFileSync(path.join(out, 'app', 'package.json'), '{"type":"module"}\n')

  const workspaces = path.join(out, 'workspaces.txt')
  if (!existsSync(workspaces)) {
    await cp(path.join(root, 'portable', 'workspaces.txt'), workspaces)
  }

  const nodeExe = path.join(out, 'runtime', 'node.exe')
  if (!existsSync(nodeExe)) await downloadFirst([nodeUrl, nodeMirror], nodeExe)
  else console.log('runtime\\node.exe 已在，跳过下载')

  await ensureGit(path.join(out, 'git'))

  const keep = path.join(out, 'data', '.gitkeep')
  if (!existsSync(keep) && !existsSync(path.join(out, 'data', 'state.json'))) writeFileSync(keep, '')

  console.log(`绿色包已放在 ${out}`)
  console.log('把这个文件夹打成 zip 拷走。对方解压后双击 打开.bat。')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

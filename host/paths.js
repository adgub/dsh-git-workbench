/** Repository-relative paths and the identity used to lock one repo at a time. */
import path from 'node:path'

export function safeRelativePath(value) {
  if (typeof value !== 'string' || !value) return null
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null
  if (normalized.split('/').includes('..')) return null
  return normalized
}

/** Case-insensitive path identity on Windows, exact elsewhere. */
export function pathKey(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function samePath(a, b) {
  return pathKey(a) === pathKey(b)
}

export function describeFsError(error) {
  const code = error && error.code
  if (code === 'EACCES' || code === 'EPERM') return '没有读取权限（EACCES），可以手动添加有权限的路径'
  if (code === 'ENOENT') return '目录不存在'
  if (code === 'ENOTDIR') return '不是目录'
  return String((error && error.message) || error)
}

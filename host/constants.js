/** Config defaults, numeric clamps, and the limits the panel reads back. */
export const GIT_TIMEOUT_MS = 12000
export const GIT_NETWORK_TIMEOUT_MS = 60000
export const MAX_STDOUT = 8 * 1024 * 1024
export const MAX_FILE_PREVIEW = 200 * 1024
export const MAX_LISTED_FILES = 5000
export const MAX_DIR_ENTRIES = 5000
export const REPO_CACHE_MS = 8000
export const PROBE_BUDGET = 80
export const DEFAULTS = { route: '/dsh-git-workbench', repo: '', historyLimit: 80, scanDepth: 1, workspaces: [] }
export const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv',
  '.next', '.nuxt', '.output', '.turbo', '.cache', 'coverage',
])

export function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** Log length from config, and the graph length the panel shows beside it (1.5×, same cap). */
export function viewLimits(config) {
  const historyLimit = clampInt(config && config.historyLimit, 5, 300, DEFAULTS.historyLimit)
  const graphLimit = clampInt(Math.round(historyLimit * 1.5), 5, 300, 120)
  return { historyLimit, graphLimit }
}

export function normalizeRoute(value) {
  const route = typeof value === 'string' && value.startsWith('/') ? value : DEFAULTS.route
  return route.replace(/\/+$/, '')
}

/** Split a comma/semicolon/newline separated config value into trimmed paths. */
export function splitPathList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
  if (typeof value !== 'string') return []
  return value.split(/[\n;,]/).map((item) => item.trim()).filter(Boolean)
}

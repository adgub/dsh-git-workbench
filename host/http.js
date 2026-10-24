/** Prefix route that forwards query and JSON bodies into `handleOp`. */
import { DEFAULTS, normalizeRoute } from './constants.js'
import { handleOp } from './ops.js'

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 32768) {
        fail(new Error('请求体过大'))
        try { req.destroy() } catch { /* ignore */ }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('请求体必须是 JSON 对象'))
          return
        }
        resolve(parsed)
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', fail)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export const inject = ['webServer']

export function apply(ctx, config) {
  const route = normalizeRoute(config && config.route)
  const defaultRepo = (config && typeof config.repo === 'string' && config.repo) || ''
  const effective = {
    ...DEFAULTS,
    ...(config && typeof config === 'object' ? config : {}),
    route,
    repo: defaultRepo,
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: route,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url || '/', 'http://127.0.0.1')
            const params = Object.fromEntries(url.searchParams.entries())
            if (req.method === 'POST') {
              let body
              try {
                body = await readJsonBody(req)
              } catch (error) {
                sendJson(res, 400, { error: String((error && error.message) || error) })
                return
              }
              Object.assign(params, body)
            } else if (req.method !== 'GET' && req.method !== 'HEAD') {
              sendJson(res, 405, { error: '只支持 GET 和 POST' })
              return
            }
            if (!params.repo) params.repo = defaultRepo
            const op = params.op || 'status'
            const result = await handleOp(op, params, { ctx, config: effective, headers: req.headers })
            sendJson(res, result.status, result.body)
          } catch (error) {
            if (!res.writableEnded) {
              sendJson(res, 500, { error: String((error && error.message) || error) })
            }
          }
        },
      }),
    'dsh-git-workbench: git api route',
  )
}

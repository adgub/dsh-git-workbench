/** Porcelain, log, branch, and graph text in, plain objects out. */

/**
 * Porcelain quotes paths that contain non-ASCII or special characters:
 * `"portable/\344\275\277..."`. The bytes inside are the real path.
 * Leaving the quotes on makes `git add` look for a file that does not exist.
 */
export function unquoteGitPath(value) {
  const text = String(value || '')
  if (text.length < 2 || text[0] !== '"' || text[text.length - 1] !== '"') return text
  const body = text.slice(1, -1)
  const bytes = []
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char !== '\\') {
      const code = body.charCodeAt(index)
      if (code > 255) return text
      bytes.push(code)
      continue
    }
    index += 1
    const next = body[index]
    if (next === undefined) return text
    if (next === 'n') bytes.push(10)
    else if (next === 't') bytes.push(9)
    else if (next === 'b') bytes.push(8)
    else if (next === 'f') bytes.push(12)
    else if (next === 'r') bytes.push(13)
    else if (next === '"' || next === '\\') bytes.push(next.charCodeAt(0))
    else if (next >= '0' && next <= '7') {
      let octal = next
      let count = 1
      while (count < 3 && body[index + 1] >= '0' && body[index + 1] <= '7') {
        index += 1
        octal += body[index]
        count += 1
      }
      bytes.push(Number.parseInt(octal, 8))
    } else bytes.push(next.charCodeAt(0))
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Split an XY porcelain v2 code into the two sides that Git tracks. */
function classify(xy) {
  if (xy === '??') return { untracked: true, staged: false, unstaged: false, ignored: false }
  if (xy === '!!') return { untracked: false, staged: false, unstaged: false, ignored: true }
  const x = xy[0]
  const y = xy[1]
  return {
    untracked: false,
    ignored: false,
    staged: x !== '.' && x !== ' ',
    unstaged: y !== '.' && y !== ' ',
  }
}

function takePrefix(line, prefix) {
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null
}

export function parseStatus(out) {
  const status = { branch: null, oid: null, unborn: false, upstream: null, ahead: 0, behind: 0, files: [] }
  for (const line of out.split('\n')) {
    if (!line) continue
    const head = takePrefix(line, '# branch.head ')
    if (head !== null) {
      status.branch = head
      continue
    }
    const oid = takePrefix(line, '# branch.oid ')
    if (oid !== null) {
      status.oid = oid
      if (oid === '(initial)') status.unborn = true
      continue
    }
    const upstream = takePrefix(line, '# branch.upstream ')
    if (upstream !== null) {
      status.upstream = upstream
      continue
    }
    const aheadBehind = takePrefix(line, '# branch.ab ')
    if (aheadBehind !== null) {
      const match = aheadBehind.match(/\+(\d+)\s+-(\d+)/)
      if (match) {
        status.ahead = Number(match[1])
        status.behind = Number(match[2])
      }
      continue
    }
    let match = line.match(/^1 (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/)
    if (match) {
      status.files.push({ path: unquoteGitPath(match[8]), xy: match[1], kind: 'changed', ...classify(match[1]) })
      continue
    }
    match = line.match(/^2 (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/)
    if (match) {
      const rest = match[9]
      const tab = rest.indexOf('\t')
      status.files.push({
        path: unquoteGitPath(tab === -1 ? rest : rest.slice(0, tab)),
        from: tab === -1 ? '' : unquoteGitPath(rest.slice(tab + 1)),
        xy: match[1],
        kind: 'renamed',
        ...classify(match[1]),
      })
      continue
    }
    match = line.match(/^u (\S\S) (.*)$/)
    if (match) {
      // Remainder is `<sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`.
      const parts = match[2].split(' ')
      status.files.push({ path: unquoteGitPath(parts.slice(8).join(' ')), xy: match[1], kind: 'conflict', staged: true, unstaged: true })
      continue
    }
    if (line.startsWith('? ')) {
      status.files.push({ path: unquoteGitPath(line.slice(2)), xy: '??', kind: 'untracked', ...classify('??') })
      continue
    }
    if (line.startsWith('! ')) {
      status.files.push({ path: unquoteGitPath(line.slice(2)), xy: '!!', kind: 'ignored', ...classify('!!') })
    }
  }
  return status
}

/** Compact per-repository counters derived from a porcelain v2 status. */
export function summarizeStatus(status) {
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const file of status.files) {
    if (file.ignored) continue
    if (file.untracked) { untracked += 1; continue }
    if (file.staged) staged += 1
    if (file.unstaged) unstaged += 1
  }
  return { staged, unstaged, untracked, files: staged + unstaged + untracked }
}

export function parseLog(out) {
  return out
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, short, author, date, subject] = record.split('\x1f')
      return { sha, short, author, date, subject }
    })
}

export function parseBranches(out) {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, sha, date, upstream, head] = line.split('\t')
      return { name, sha, date, upstream, current: head === '*' }
    })
}

/**
 * `git log --graph` lines look like `* | abc1234 (HEAD -> main) subject`.
 * Split the drawing prefix from the commit so the browser can colour the
 * graph and still make the row clickable.
 */
export function parseGraph(out) {
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^([^0-9a-f]*?)([0-9a-f]{4,40})(.*)$/)
      if (!match) return { graph: line, sha: null, text: '' }
      return { graph: match[1], sha: match[2], text: match[3] }
    })
}

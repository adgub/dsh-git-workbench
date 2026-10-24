// @part 04-helpers.js

    function readStore() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function writeStore(patch) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), ...patch }))
      } catch {
        /* localStorage may be unavailable; the panel still works without persistence */
      }
    }

    function normalizeKey(value) {
      const text = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
      return /^[a-zA-Z]:/.test(text) ? text.toLowerCase() : text
    }

    function baseName(value) {
      const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean)
      return parts.length ? parts[parts.length - 1] : String(value || '')
    }

    function absolutePath(repo, rel) {
      const windows = /^[a-zA-Z]:/.test(String(repo || ''))
      const base = String(repo || '').replace(/[\\/]+$/, '')
      const tail = String(rel || '').replace(/^[\\/]+/, '')
      if (!tail) return windows ? base.replace(/\//g, '\\') : base
      const joined = `${base}/${tail}`
      return windows ? joined.replace(/\//g, '\\') : joined
    }

    function extensionOf(value) {
      const name = baseName(value)
      const dot = name.lastIndexOf('.')
      return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
    }

    function extLabel(value) {
      const ext = extensionOf(value)
      return ext ? ext.slice(0, 2).toUpperCase() : '·'
    }

    function extColor(value) {
      const ext = extensionOf(value)
      if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'var(--dsw-alias-brand-primary)'
      if (['json', 'yml', 'yaml', 'toml'].includes(ext)) return 'var(--dsw-alias-state-warn-primary)'
      if (['css', 'scss', 'less', 'html'].includes(ext)) return 'var(--dsw-alias-state-success-primary)'
      return 'var(--dsw-alias-label-secondary)'
    }

    /**
     * SVN / IntelliJ / git-bash style status colours:
     * untracked (not added yet) red, added green, modified blue, deleted grey,
     * renamed purple, conflict orange.
     */
    function colorForStatus(xy) {
      const code = String(xy || '')
      if (!code) return 'var(--dsw-alias-label-secondary)'
      if (code === '??') return 'var(--dsw-alias-state-error-primary)'
      if (code.includes('U')) return '#d29922'
      if (code.includes('R') || code.includes('C')) return '#a371f7'
      if (code.includes('D')) return 'var(--dsw-alias-label-secondary)'
      if (code.includes('A')) return 'var(--dsw-alias-state-success-primary)'
      if (code.includes('M')) return 'var(--dsw-alias-brand-primary)'
      return 'var(--dsw-alias-state-warn-primary)'
    }

    function statusLabel(xy) {
      const code = String(xy || '')
      if (code === '??') return '未跟踪（还没 add）'
      if (code.includes('U')) return '冲突'
      if (code.includes('R')) return '重命名'
      if (code.includes('C')) return '复制'
      if (code.includes('D')) return '删除'
      if (code.includes('A')) return '已暂存的新增'
      if (code.includes('T')) return '类型变更'
      if (code.includes('M')) return '修改'
      return '改动'
    }

    function isDeleted(entry) {
      return !!entry && String(entry.xy || '').includes('D')
    }

    /** Porcelain v2 uses `.` for "unchanged"; the tree only needs the letter. */
    function displayXY(entry) {
      const code = String((entry && entry.xy) || '')
      if (!code) return '·'
      if (code === '??' || code === '!!') return code
      if (code.includes('U')) return 'UU'
      const compact = code.replace(/\./g, '').trim()
      return compact || code
    }

    /** Stable hash so a project keeps its colour between sessions. */
    function hashString(value) {
      const text = String(value || '')
      let hash = 0
      for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0
      return hash
    }

    function projectColorFor(path, overrides) {
      const key = normalizeKey(path)
      if (overrides && typeof overrides[key] === 'string' && overrides[key]) return overrides[key]
      if (!key) return PROJECT_COLORS[0]
      return PROJECT_COLORS[hashString(key) % PROJECT_COLORS.length]
    }

    function emptyCounts() {
      return { staged: 0, unstaged: 0, untracked: 0, total: 0 }
    }

    /** Build the module/folder tree the sidebar shows for the changed files. */
    function buildTree(entries) {
      const root = { key: '', name: '', dirs: [], files: [], counts: emptyCounts() }
      const index = new Map([['', root]])
      for (const entry of entries) {
        const parts = String(entry.path || '').split('/').filter(Boolean)
        if (!parts.length) continue
        let node = root
        let prefix = ''
        for (let i = 0; i < parts.length - 1; i += 1) {
          prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]
          let child = index.get(prefix)
          if (!child) {
            child = { key: prefix, name: parts[i], dirs: [], files: [], counts: emptyCounts() }
            index.set(prefix, child)
            node.dirs.push(child)
          }
          node = child
        }
        node.files.push(entry)
      }
      const aggregate = (node) => {
        const counts = emptyCounts()
        for (const file of node.files) {
          if (file.untracked) counts.untracked += 1
          if (file.staged) counts.staged += 1
          if (file.unstaged) counts.unstaged += 1
          counts.total += 1
        }
        for (const dir of node.dirs) {
          const child = aggregate(dir)
          counts.staged += child.staged
          counts.unstaged += child.unstaged
          counts.untracked += child.untracked
          counts.total += child.total
        }
        node.counts = counts
        dirsSort(node.dirs)
        node.files.sort((a, b) => String(a.path).localeCompare(String(b.path), 'zh-Hans-CN'))
        return counts
      }
      aggregate(root)
      return root
    }

    function dirsSort(dirs) {
      dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    }

    function dirsOf(node) {
      return node.dirs || []
    }

    function statusDots(counts) {
      const dots = []
      if (counts.staged > 0) dots.push(h('span', { key: 's', style: { ...styles.dot, background: 'var(--dsw-alias-state-success-primary)' }, title: `${counts.staged} 个已暂存` }))
      if (counts.unstaged > 0) dots.push(h('span', { key: 'u', style: { ...styles.dot, background: 'var(--dsw-alias-brand-primary)' }, title: `${counts.unstaged} 个未暂存` }))
      if (counts.untracked > 0) dots.push(h('span', { key: 'n', style: { ...styles.dot, background: 'var(--dsw-alias-state-error-primary)' }, title: `${counts.untracked} 个未跟踪` }))
      return dots
    }

    /** The colour key the tree shows under its summary. */
    function statusLegend() {
      const items = [
        ['??', '未跟踪'],
        ['A', '新增'],
        ['M', '修改'],
        ['D', '删除'],
        ['R', '重命名'],
        ['U', '冲突'],
      ]
      return h('div', { style: styles.legend },
        items.map(([code, label]) => h('span', { key: code, style: styles.legendItem },
          h('span', { style: { ...styles.legendDot, background: colorForStatus(code) } }),
          label,
        )),
      )
    }

    const SOURCE_KEYWORDS = new Set(
      'const let var function return if else for while class import export from async await new this try catch throw switch case break continue default typeof instanceof of in null undefined true false interface type extends implements package func struct map range defer select go chan public private protected static void int string bool elif fi then do done esac'.split(' '),
    )

    function sourceLang(ext) {
      if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'cs', 'kt'].includes(ext)) return 'c'
      if (['py', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'rb', 'toml'].includes(ext)) return 'hash'
      if (['css', 'scss', 'less'].includes(ext)) return 'css'
      if (ext === 'json') return 'json'
      if (['md', 'markdown'].includes(ext)) return 'md'
      if (['html', 'htm', 'xml', 'svg', 'vue'].includes(ext)) return 'html'
      if (ext === 'sql') return 'sql'
      return ''
    }

    /** One-line scan: comments, strings, numbers, keywords. No nested languages. */
    function highlightParts(line, lang) {
      const text = String(line || '')
      if (!lang || !text) return [{ text: text || ' ', color: '' }]
      if (lang === 'md' && /^#{1,6}\s/.test(text)) return [{ text, color: '#79c0ff' }]
      const parts = []
      let i = 0
      const push = (slice, color) => {
        if (slice) parts.push({ text: slice, color: color || '' })
      }
      while (i < text.length) {
        if ((lang === 'c' || lang === 'css' || lang === 'sql') && text.startsWith('//', i)) {
          push(text.slice(i), '#8b98a8')
          break
        }
        if (lang === 'hash' && text[i] === '#') {
          push(text.slice(i), '#8b98a8')
          break
        }
        if ((lang === 'c' || lang === 'css' || lang === 'sql') && text.startsWith('/*', i)) {
          const end = text.indexOf('*/', i + 2)
          const stop = end === -1 ? text.length : end + 2
          push(text.slice(i, stop), '#8b98a8')
          i = stop
          continue
        }
        if (lang === 'html' && text.startsWith('<!--', i)) {
          const end = text.indexOf('-->', i + 4)
          const stop = end === -1 ? text.length : end + 3
          push(text.slice(i, stop), '#8b98a8')
          i = stop
          continue
        }
        const quote = text[i]
        if (quote === '"' || quote === "'" || quote === '`') {
          let j = i + 1
          while (j < text.length) {
            if (text[j] === '\\') { j += 2; continue }
            if (text[j] === quote) { j += 1; break }
            j += 1
          }
          push(text.slice(i, j), '#a5d6ff')
          i = j
          continue
        }
        if (/[0-9]/.test(text[i]) && (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]))) {
          let j = i + 1
          while (j < text.length && /[0-9.xXa-fA-F_]/.test(text[j])) j += 1
          push(text.slice(i, j), '#79c0ff')
          i = j
          continue
        }
        if (/[A-Za-z_]/.test(text[i])) {
          let j = i + 1
          while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1
          const word = text.slice(i, j)
          const keyword = lang !== 'md' && SOURCE_KEYWORDS.has(word)
          push(word, keyword ? '#ff8b82' : '')
          i = j
          continue
        }
        push(text[i], '')
        i += 1
      }
      return parts.length ? parts : [{ text: ' ', color: '' }]
    }

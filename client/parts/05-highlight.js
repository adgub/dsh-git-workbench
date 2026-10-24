// @part 05-highlight.js
    function renderHighlighted(line, lang) {
      return highlightParts(line, lang).map((part, index) => h('span', {
        key: index,
        style: part.color ? { color: part.color } : null,
      }, part.text))
    }

    /**
     * New-file line numbers touched by a unified diff.
     * `added` is a green row; `near` is the line that sits where content was removed.
     */
    function parseChangedLines(text) {
      const added = []
      const near = []
      const lines = String(text || '').split('\n')
      let index = 0
      while (index < lines.length) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[index])
        if (!hunk) {
          index += 1
          continue
        }
        let newLine = Number(hunk[1])
        let pending = false
        index += 1
        while (index < lines.length && !lines[index].startsWith('@@') && !lines[index].startsWith('diff ')) {
          const line = lines[index]
          if (line.startsWith('+')) {
            added.push(newLine)
            newLine += 1
            pending = false
          } else if (line.startsWith('-')) {
            pending = true
          } else if (line.startsWith('\\')) {
            /* "\ No newline at end of file" */
          } else {
            if (pending) near.push(newLine)
            pending = false
            newLine += 1
          }
          index += 1
        }
        if (pending && newLine > 1) near.push(newLine - 1)
      }
      return { added, near }
    }

    function decorateDiff(text) {
      const rows = []
      const lines = String(text || '').split('\n')
      let newLine = 0
      let inHunk = false
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
        if (hunk) {
          inHunk = true
          newLine = Number(hunk[1])
          rows.push({ kind: 'hunk', text: line, marker: '', no: '' })
          continue
        }
        if (!inHunk || line.startsWith('diff ') || line.startsWith('# ')) {
          if (line.startsWith('diff ') || line.startsWith('# ')) inHunk = false
          rows.push({ kind: 'meta', text: line, marker: '', no: '' })
          continue
        }
        if (line.startsWith('+')) {
          rows.push({ kind: 'add', text: line.slice(1), marker: '+', no: String(newLine) })
          newLine += 1
        } else if (line.startsWith('-')) {
          rows.push({ kind: 'del', text: line.slice(1), marker: '-', no: '' })
        } else if (line.startsWith('\\')) {
          rows.push({ kind: 'meta', text: line, marker: '', no: '' })
        } else {
          rows.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line, marker: '', no: String(newLine) })
          newLine += 1
        }
      }
      return rows
    }

    const DIFF_ROW = {
      add: { background: 'rgba(63, 185, 80, 0.22)', color: '#7ee787', marker: '#7ee787' },
      del: { background: 'rgba(248, 81, 73, 0.20)', color: '#ff9b94', marker: '#ff9b94' },
      hunk: { background: 'rgba(88, 166, 255, 0.14)', color: '#9ecbff', marker: '#9ecbff' },
      ctx: { background: 'transparent', color: CODE_FG, marker: '#7d8794' },
      meta: { background: 'transparent', color: '#8b98a8', marker: '#7d8794' },
    }

    function DiffBody({ text, lang }) {
      const rows = React.useMemo(() => decorateDiff(text), [text])
      const shown = rows.slice(0, 6000)
      return h('div', { style: { padding: '8px 0 16px' } },
        shown.map((row, index) => {
          const tone = DIFF_ROW[row.kind] || DIFF_ROW.meta
          const body = row.kind === 'add' || row.kind === 'del' || row.kind === 'ctx'
            ? renderHighlighted(row.text || ' ', lang)
            : row.text || ' '
          return h('div', {
            key: index,
            style: { ...styles.codeRow, background: tone.background, color: tone.color },
          },
            h('span', { style: { ...styles.lineNo, color: tone.marker } }, `${row.marker} ${row.no}`.trim() || ' '),
            h('span', { style: { ...styles.codeText, color: tone.color } }, body),
          )
        }),
        rows.length > shown.length
          ? h('div', { style: { ...styles.empty, padding: '8px 12px', color: '#8b98a8' } }, `差异较大，只显示前 ${shown.length} 行（共 ${rows.length} 行）。`)
          : null,
      )
    }

    function FileBody({ text, truncated, size, lang, added, near }) {
      const lines = React.useMemo(() => String(text || '').split('\n'), [text])
      const addedSet = React.useMemo(() => new Set(added || []), [added])
      const nearSet = React.useMemo(() => new Set(near || []), [near])
      const shown = lines.slice(0, 6000)
      return h('div', { style: { padding: '8px 0 16px' } },
        shown.map((line, index) => {
          const lineNo = index + 1
          const isAdd = addedSet.has(lineNo)
          const isNear = !isAdd && nearSet.has(lineNo)
          const background = isAdd ? 'rgba(63, 185, 80, 0.22)' : isNear ? 'rgba(248, 81, 73, 0.18)' : 'transparent'
          const marker = isAdd ? '+' : isNear ? '·' : ''
          return h('div', { key: index, style: { ...styles.codeRow, background } },
            h('span', { style: { ...styles.lineNo, color: isAdd ? '#7ee787' : isNear ? '#ff9b94' : '#7d8794' } }, `${marker} ${lineNo}`.trim()),
            h('span', { style: styles.codeText }, renderHighlighted(line === '' ? ' ' : line, lang)),
          )
        }),
        truncated || lines.length > shown.length
          ? h('div', { style: { ...styles.empty, padding: '8px 12px', color: '#8b98a8' } },
              `文件较大，只显示前 ${Math.min(shown.length, 6000)} 行${size ? `（共 ${Math.round(size / 1024)} KB）` : ''}。`)
          : null,
      )
    }

    /** Colour each graph column so a branch reads as its own line. */
    function graphGlyphs(text) {
      const glyphs = []
      const source = String(text || '')
      for (let index = 0; index < source.length; index += 1) {
        const ch = source[index]
        if (ch === ' ' || ch === '\t') {
          glyphs.push({ ch, color: '', bold: false })
          continue
        }
        const lane = Math.floor(index / 2) % GRAPH_LANE_COLORS.length
        glyphs.push({ ch, color: GRAPH_LANE_COLORS[lane], bold: ch === '*' })
      }
      return glyphs
    }

    /**
     * One draggable vertical divider. The owner supplies clamping and persists
     * the committed width; this component owns only pointer/keyboard gesture.
     */
    function PaneSplitter({ value, min, max, defaultValue, clamp, onResize, onCommit, color, label, title }) {
      const [drag, setDrag] = React.useState(null)
      const [hover, setHover] = React.useState(false)
      const valueRef = React.useRef(value)
      React.useEffect(() => { valueRef.current = value }, [value])
      React.useEffect(() => {
        if (!drag) return undefined
        const onMove = (event) => onResize(clamp(drag.width + event.clientX - drag.x))
        const finish = () => {
          setDrag(null)
          onCommit()
        }
        const previousCursor = document.body.style.cursor
        const previousSelect = document.body.style.userSelect
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
        window.addEventListener('blur', finish)
        return () => {
          document.body.style.cursor = previousCursor
          document.body.style.userSelect = previousSelect
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          window.removeEventListener('blur', finish)
        }
      }, [drag, clamp, onResize, onCommit])
      const active = !!drag || hover
      return h('div', {
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': label,
        'aria-valuemin': min,
        'aria-valuemax': max,
        'aria-valuenow': value,
        tabIndex: 0,
        title,
        style: styles.splitter,
        onPointerDown: (event) => {
          if (event.button !== 0) return
          event.preventDefault()
          try { event.currentTarget.focus({ preventScroll: true }) } catch { /* older engines */ }
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* optional */ }
          setDrag({ x: event.clientX, width: valueRef.current })
        },
        onDoubleClick: () => {
          onResize(clamp(defaultValue))
          onCommit()
        },
        onKeyDown: (event) => {
          const step = event.shiftKey ? 48 : 16
          let next
          if (event.key === 'ArrowLeft') next = valueRef.current - step
          else if (event.key === 'ArrowRight') next = valueRef.current + step
          else if (event.key === 'Home') next = defaultValue
          else if (event.key === 'End') next = max
          else return
          event.preventDefault()
          onResize(clamp(next))
          onCommit()
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onFocus: () => setHover(true),
        onBlur: () => setHover(false),
      },
        h('div', { style: { ...styles.splitterLine, ...(active ? { width: 2, background: color } : {}) } }),
        active ? h('div', { style: { ...styles.splitterGrip, background: color } }) : null,
      )
    }

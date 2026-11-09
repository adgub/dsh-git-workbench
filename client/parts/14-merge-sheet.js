// @part 14-merge-sheet.js

    const MERGE_ZONE = {
      ours: { background: 'rgba(63, 185, 80, 0.24)', color: '#7ee787' },
      'ours-mark': { background: 'rgba(63, 185, 80, 0.5)', color: '#7ee787' },
      theirs: { background: 'rgba(88, 166, 255, 0.22)', color: '#9ecbff' },
      'theirs-mark': { background: 'rgba(88, 166, 255, 0.48)', color: '#9ecbff' },
      split: { background: 'rgba(210, 153, 34, 0.62)', color: '#ffe08a' },
      out: { background: 'transparent', color: CODE_FG },
    }

    function mergeActionLabel(relation) {
      if (relation === 'ff') return '快进合并'
      if (relation === 'local-unborn') return '取下这段历史'
      return '合并两边'
    }

    function canStartMerge(sheet) {
      return !!sheet && !sheet.merging && !sheet.blocked && ['ff', 'merge', 'unrelated', 'local-unborn'].includes(sheet.relation)
    }

    function showMergeColumns(sheet) {
      if (!sheet || !sheet.ours) return false
      if (sheet.merging || sheet.pending) return true
      return sheet.relation === 'merge' || sheet.relation === 'unrelated'
    }

    function mergeExplain(sheet) {
      const name = (sheet.theirs && sheet.theirs.branch) || sheet.branch || '对方'
      const conflicts = sheet.conflicts || []
      if (sheet.relation === 'ff') return `${name} 比当前分支超前，可以快进，不会产生新的合并提交。`
      if (sheet.relation === 'local-unborn') return `当前分支还没有提交。会取下 ${name} 的历史。`
      if (sheet.relation === 'contained' || sheet.relation === 'push') return `${name} 没有需要合进来的提交。`
      if (sheet.relation === 'same') return '两边是同一次提交。'
      if (sheet.relation === 'empty') return '对方还没有任何提交。'
      if (conflicts.length) return `有 ${conflicts.length} 个文件冲突。中间一列用绿色标出你的，用蓝色标出对方的。`
      if (sheet.pending || sheet.relation === 'pending') return '没有文件冲突。填写日志后提交这次合并。'
      if (sheet.relation === 'merge') return `当前分支和 ${name} 都有新提交。合并后如果撞上，冲突会在中间一列标出来。`
      if (sheet.relation === 'unrelated') return `当前分支和 ${name} 没有共同祖先。冲突的文件会在中间一列标出来。`
      if (sheet.merged) return '已经快进到对方的提交。'
      return '准备合并。'
    }

    function paintConflict(text) {
      const lines = String(text || '').split('\n')
      let zone = 'out'
      let hunks = 0
      const painted = lines.map((line) => {
        if (line.startsWith('<<<<<<<')) {
          hunks += 1
          zone = 'ours'
          return { line, zone: 'ours-mark' }
        }
        if (line.startsWith('=======')) {
          zone = 'theirs'
          return { line, zone: 'split' }
        }
        if (line.startsWith('>>>>>>>')) {
          zone = 'out'
          return { line, zone: 'theirs-mark' }
        }
        return { line, zone }
      })
      return { painted, hunks }
    }

    function sideNote(kind, fileSide) {
      if (!fileSide) return ''
      if (fileSide.binary) return '二进制文件，这里不显示内容。'
      if (fileSide.missing) return kind === 'result' ? '工作区里没有这个文件。' : '这一边没有这个文件。'
      if (fileSide.error) return fileSide.error
      return ''
    }

    function MergeCode({ text, conflict }) {
      const source = conflict
        ? paintConflict(text)
        : { painted: String(text || '').split('\n').map((line) => ({ line, zone: 'out' })), hunks: 0 }
      const shown = source.painted.slice(0, 2500)
      return h('div', { style: { padding: '6px 0 12px' } },
        shown.map((row, index) => {
          const tone = MERGE_ZONE[row.zone] || MERGE_ZONE.out
          return h('div', {
            key: index,
            style: { ...styles.codeRow, background: tone.background, color: tone.color },
          },
            h('span', { style: { ...styles.lineNo, color: row.zone === 'out' ? '#7d8794' : tone.color } }, String(index + 1)),
            h('span', { style: { ...styles.codeText, color: tone.color } }, row.line === '' ? ' ' : row.line),
          )
        }),
        source.painted.length > shown.length
          ? h('div', { style: { ...styles.empty, color: '#8b98a8' } }, `只显示前 ${shown.length} 行。`)
          : null,
      )
    }

    function MergeIdentity({ kicker, person, accent }) {
      const side = person || {}
      return h('div', { style: { ...styles.mergeCard, borderTop: `3px solid ${accent}` } },
        h('div', { style: styles.mergeKicker }, kicker),
        h('div', { style: { ...styles.mergeSha, color: accent } }, side.short || '—'),
        h('div', { style: styles.mergeSubject, title: side.subject || '' }, side.subject || '没有提交备注'),
        h('div', { style: { ...styles.mergeSubject, color: 'var(--dsw-alias-label-secondary)' } }, side.branch || '未命名分支'),
      )
    }

    function mergeColumn(spec) {
      const person = spec.person || {}
      const note = spec.body ? sideNote(spec.kind, spec.body) : spec.note
      const text = spec.body && !spec.body.binary && !spec.body.missing ? spec.body.text : ''
      const head = spec.both
        ? h('div', { style: styles.mergeColHead },
            h('div', { style: styles.mergeKicker }, '合并结果'),
            h('div', { style: styles.mergeSha }, `${(spec.ours && spec.ours.short) || '—'} × ${(spec.theirs && spec.theirs.short) || '—'}`),
            h('div', { style: styles.mergeSubject, title: spec.ours && spec.ours.subject }, `你的 ${spec.ours && spec.ours.short ? spec.ours.short : '—'} · ${spec.ours && spec.ours.subject ? spec.ours.subject : '没有提交备注'}`),
            h('div', { style: styles.mergeSubject, title: spec.theirs && spec.theirs.subject }, `别人的 ${spec.theirs && spec.theirs.short ? spec.theirs.short : '—'} · ${spec.theirs && spec.theirs.subject ? spec.theirs.subject : '没有提交备注'}`),
            spec.extra ? h('div', { style: { ...styles.mergeSubject, color: '#e3b341', fontWeight: 700 } }, spec.extra) : null,
          )
        : h('div', { style: styles.mergeColHead },
            h('div', { style: styles.mergeKicker }, spec.kicker),
            h('div', { style: { ...styles.mergeSha, color: spec.accent } }, person.short || '—'),
            h('div', { style: styles.mergeSubject, title: person.subject || '' }, person.subject || '没有提交备注'),
          )
      return h('div', { style: { ...styles.mergeCol, borderTop: `3px solid ${spec.accent}` } },
        head,
        h('div', { style: styles.mergeColBody },
          note ? h('div', { style: styles.empty }, note) : h(MergeCode, { text, conflict: spec.kind === 'result' }),
          spec.body && spec.body.truncated ? h('div', { style: { ...styles.empty, color: '#8b98a8' } }, '文件较大，只显示前面一部分。') : null,
        ),
      )
    }

    function MergeSheet(props) {
      const sheet = props.sheet || {}
      const ours = sheet.ours || null
      const theirs = sheet.theirs || null
      const conflicts = sheet.conflicts || []
      const file = sheet.file
      const columns = showMergeColumns(sheet)
      const resultText = file && file.result && !file.result.binary && !file.result.missing ? file.result.text : ''
      const hunks = resultText ? paintConflict(resultText).hunks : 0
      const start = canStartMerge(sheet)
      const messageReady = !!(props.commitMessage && String(props.commitMessage).trim())
      const canCommit = !!props.headBranch && messageReady && !conflicts.length && !!sheet.pending && !props.commitBusy && !sheet.busy
      const centerNote = file
        ? ''
        : (conflicts.length
            ? (sheet.busy ? '正在读取冲突文件…' : '点上面的文件名，查看这一处冲突。')
            : (sheet.pending ? '没有文件冲突。填写日志后提交这次合并。' : mergeExplain(sheet)))

      return h('div', { style: styles.mergeSheet },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 0' } },
          h('div', { style: { flex: '1 1 auto', fontWeight: 700 } },
            sheet.merging ? `正在把 ${theirs && theirs.branch ? theirs.branch : '对方'} 合并进 ${ours && ours.branch ? ours.branch : '当前分支'}` : '合并到当前分支'),
          sheet.merging
            ? h('button', { type: 'button', style: styles.button, disabled: !!sheet.busy, onClick: props.onAbort }, '放弃合并')
            : null,
          h('button', { type: 'button', style: styles.buttonQuiet, onClick: props.onClose }, '关闭'),
        ),
        sheet.error ? h('div', { style: styles.banner }, sheet.error) : null,
        !ours
          ? h('div', { style: styles.empty }, sheet.busy ? '正在读取两边的提交…' : '还没有读到两边的提交。')
          : h('div', { style: styles.mergeTop },
              h(MergeIdentity, { kicker: '你的版本', person: ours, accent: '#3fb950' }),
              h('div', { style: styles.mergeArrow }, '→'),
              h(MergeIdentity, { kicker: '别人的版本', person: theirs, accent: '#58a6ff' }),
            ),
        conflicts.length
          ? h('div', { style: styles.mergeAlert }, `${conflicts.length} 个文件冲突。绿色是你的版本，蓝色是别人的版本，黄色分隔线是冲突边界。`)
          : null,
        conflicts.length
          ? h('div', { style: styles.mergeChips },
              conflicts.map((item) => h('button', {
                key: item,
                type: 'button',
                title: item,
                style: {
                  ...styles.mergeChip,
                  ...(item === sheet.filePath ? { borderColor: '#d29922', color: '#e3b341', fontWeight: 700 } : {}),
                },
                onClick: () => props.onSelectFile(item),
              }, item)),
            )
          : null,
        columns
          ? h('div', { style: styles.mergeCols },
              mergeColumn({ kicker: '你的版本', person: ours, accent: '#3fb950', body: file && file.ours, kind: 'ours', note: file ? '' : '合并之后，这里显示你这边的文件。' }),
              mergeColumn({
                both: true,
                ours,
                theirs,
                accent: conflicts.length ? '#d29922' : 'var(--dsw-alias-border-l1)',
                body: file && file.result,
                kind: 'result',
                extra: hunks ? `${hunks} 处冲突` : '',
                note: centerNote,
              }),
              mergeColumn({ kicker: '别人的版本', person: theirs, accent: '#58a6ff', body: file && file.theirs, kind: 'theirs', note: file ? '' : '合并之后，这里显示对方的文件。' }),
            )
          : (ours ? h('div', { style: { ...styles.empty, flex: '1 1 auto' } }, mergeExplain(sheet)) : null),
        h('div', { style: styles.mergeFoot },
          start
            ? h('button', {
                type: 'button',
                style: styles.button,
                disabled: !!sheet.busy,
                onClick: props.onConfirm,
              }, sheet.busy ? '合并中…' : mergeActionLabel(sheet.relation))
            : null,
          file && conflicts.length
            ? h(React.Fragment, null,
                h('button', {
                  type: 'button',
                  style: styles.button,
                  disabled: !!props.sideBusy || !!sheet.busy,
                  onClick: () => props.onTakeSide('ours'),
                }, '用我的版本'),
                h('button', {
                  type: 'button',
                  style: styles.button,
                  disabled: !!props.sideBusy || !!sheet.busy,
                  onClick: () => props.onTakeSide('theirs'),
                }, '用对方的版本'),
              )
            : null,
          sheet.pending && !conflicts.length
            ? h('div', { style: { flex: '1 1 240px', display: 'flex', gap: 8, alignItems: 'center' } },
                h('input', {
                  style: styles.input,
                  value: props.commitMessage || '',
                  placeholder: '填写日志，完成这次合并',
                  onChange: (event) => props.onCommitMessage(event.target.value),
                  onKeyDown: (event) => { if (event.key === 'Enter' && canCommit) props.onCommit() },
                }),
                h('button', {
                  type: 'button',
                  style: { ...styles.button, opacity: canCommit ? 1 : 0.45 },
                  disabled: !canCommit,
                  onClick: () => props.onCommit(),
                }, props.commitBusy ? '提交中…' : '提交'),
              )
            : null,
          props.commitError
            ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 } }, props.commitError)
            : null,
        ),
      )
    }

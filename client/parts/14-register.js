// @part 14-register.js

    function GitWorkbenchIcon(props) {
      const size = (props && props.size) || 16
      const active = !!(props && props.active)
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('circle', { cx: 6, cy: 5, r: 2.2 }),
        h('circle', { cx: 6, cy: 19, r: 2.2 }),
        h('circle', { cx: 18, cy: 9, r: 2.2 }),
        h('path', { d: 'M6 7.2v9.6' }),
        h('path', { d: 'M6 12h7a5 5 0 0 0 5-5' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        terminalBridge = createTerminalBridge(ctx)
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'git-workbench', order: 30, label: 'Git' }, GitWorkbenchIcon),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'git-workbench' }, GitWorkbenchPanel),
        )
      },
    }
  },
})

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

// この PC はほかのセッションで混むことがあるので、1本の待ち時間を長めに（中身の速さは変えない）
const SLOW_PC_MS = 30_000

// ペット（hooks/pet/）：いちばん上のマスコットとミニゲーム

const FILES: Record<string, string> = {
  'roles/roster.md': ['| 係名 | 立場 | 使う部門 | 役割カード |', '|---|---|---|---|', '| 市場調査係 | researcher | 仕事 | roles/市場調査係.md |'].join(
    '\n',
  ),
  'status/index.md': ['| 部門 | 1行 | 詳細 |', '|---|---|---|', '| 仕事 | | status/仕事.md |'].join('\n'),
}

const PANE = {
  plugin: 'soshiki-zu',
  component: 'Pane',
  requestId: 'soshiki',
  props: {
    title: '組織図',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SPAWN = {
  tool_use_id: 'tu1',
  prompt: '役割カード: roles/市場調査係.md\n調べて',
  description: '市場の調べもの',
  subagentType: 'researcher',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'm',
  background: true,
  fork: false,
} as const

// エンジンの代わり（下に何も無いので、使う呼び出しにここで答える）
function engine(on: On) {
  on('command.register', () => ({ value: { command: 'soshiki' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    if (key === undefined) throw new Error('no file')
    return { value: FILES[key] ?? '' }
  })
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  mock.clock(on, { now: 1_792_738_000_000 })
}

// マスコットはいちばん上の Svg。alt に「キャラの名前：一言」
const moodOf = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  String((await ui.findAll({ type: 'Svg' }))[0]?.props.alt ?? '')

test('何も動いていないと寝て、係が動くと作業、終わると喜ぶ。失敗で転ぶ', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await moodOf(ui)).toContain('すやすや')
  // 既定のキャラは「もち」
  expect(await moodOf(ui)).toContain('もち')
  await ui.unmount()

  await $.agent.spawn(SPAWN as never)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await moodOf(ui)).toContain('係 1')
  await ui.unmount()

  await $.turn.complete({ agentId: 'a1', answer: '状態: 完了', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await moodOf(ui)).toContain('市場の調べもの がおわった')
  await ui.unmount()

  await $.agent.spawn(SPAWN as never)
  await $.turn.complete({ agentId: 'a1', answer: '状態: 失敗\n取れず', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await moodOf(ui)).toContain('つまずいた')
  // 転ぶの絵は星（黄色）が出る
  expect(String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('#f2c14e')
  await ui.unmount()
})

test('並びはペット → 組織図。あそぶでゲームになり、ジャンプして、もどるで戻る（ターミナルでも描ける）', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // ターミナルは Svg が無いので一言だけ。こわれずに描け、一言は組織図より上
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const tt = (await term.findAll({ type: 'Text' })).map(x => x.text)
  expect(tt.indexOf('すやすや') >= 0 && tt.indexOf('すやすや') < tt.indexOf('秘書')).toBe(true)
  await term.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'play' })
  await ui.resize({ columns: 44, rows: 20, in: 'game' })
  expect(await ui.find({ type: 'Text', text: /クリックかスペースでジャンプ/, in: 'game' })).toBeDefined()
  // ゲームのあいだも、下に組織図は出ている
  expect(await ui.find({ type: 'Text', text: '秘書' })).toBeDefined()

  // スペースで始まり、しばらく走るとスコアが増える
  await ui.key({ key: 'space', in: 'game' })
  await ui.advance(700)
  const score = await ui.find({ type: 'Text', text: /^\d+/, in: 'game' })
  expect(Number(/^\d+/.exec(score?.text ?? '')?.[0] ?? 0) > 0).toBe(true)

  // 係が終わると、ゲームの中に知らせが出る
  await $.agent.spawn(SPAWN as never)
  await $.turn.complete({ agentId: 'a1', answer: '状態: 完了', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await ui.advance(140)
  expect(await ui.find({ type: 'Text', text: /★ 市場の調べもの がおわった/, in: 'game' })).toBeDefined()

  // 跳ばずにいると、いつかぶつかる
  await ui.advance(20_000)
  expect(await ui.find({ type: 'Text', text: /ぶつかった/, in: 'game' })).toBeDefined()

  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'play' })).toBeDefined()
  await ui.unmount()
})

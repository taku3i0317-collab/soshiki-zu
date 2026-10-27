import { expect, mock, test } from 'claude-code/testing'

// この PC はほかのセッションで混むことがあるので、1本の待ち時間を長めに（中身の速さは変えない）
const SLOW_PC_MS = 30_000

// あなた待ち：部門のファイルの「本人の返事待ち／手待ち」と、現場の HANDOFF の「本人に聞きたいこと」

const FILES: Record<string, string> = {
  'roles/roster.md': ['| 係名 | 立場 | 使う部門 | 役割カード |', '|---|---|---|---|', '| 調べ係 | researcher | 仕事 | roles/調べ係.md |'].join('\n'),
  'status/index.md': ['| 部門 | 1行 | 詳細 |', '|---|---|---|', '| 仕事 | | status/仕事.md |', '| 家 | | status/家.md |'].join('\n'),
  'status/仕事.md': [
    '# 仕事',
    '- 2026-10-26 試作の案ができた。**本人の返事待ち：案 A／B のどちらにするか**。',
    '- 本人の手待ち：`claude plugin install foo@bar` を打つ',
    '',
    '## 台帳',
    '### ehon（絵本）— 仕事',
    '- 場所：`/home/a/ehon`',
    '- 記録：現場の HANDOFF.md',
  ].join('\n'),
  'status/家.md': ['# 家', '## 本人の返事待ち', '- ごはんの時間の案でよいか', '- なし'].join('\n'),
  '/home/a/ehon/HANDOFF.md': [
    '# HANDOFF',
    '## 本人に聞きたいこと（済み）',
    '- 古い質問',
    '## 本人に聞きたいこと',
    '1. 表紙は案1か案2か',
    '   - 補足は入れない',
    '## 次にやること',
    '- これは入れない',
  ].join('\n'),
}

const PANE = {
  plugin: 'soshiki-zu',
  component: 'Pane',
  requestId: 'soshiki',
  props: { title: '組織図', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

test('あなた待ちは件数だけ。押すと1件1行、1件を押すと「なぜ・やること」と写せるコマンド', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'soshiki' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    if (key === undefined) throw new Error('no file')
    return { value: FILES[key] ?? '' }
  })
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const sent: string[] = []
  on('prompt.submit', (_, e) => (sent.push(e.text), { text: e.text }))
  const copied: string[] = []
  on('ui.copy', (_, e) => (copied.push(e.text), { value: undefined as never }))
  mock.clock(on, { now: 1_792_738_000_000 })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = async () => (await ui.findAll({ type: 'Text' })).map(x => x.text)
    // 閉じているときは見出しと件数だけ（返事2・手1・HANDOFF 1 ＝ 4件。「なし」と済みの節・字下げの補足は入れない）
    expect((await texts()).includes('あなた待ち')).toBe(true)
    expect((await texts()).includes('  4')).toBe(true)
    expect((await texts()).includes('案 A／B のどちらにするか')).toBe(false)
    await ui.press({ key: 'fold-matsu' })
    const rows = await texts()
    expect(rows.filter(x => x === '仕事').length >= 2).toBe(true)
    expect(rows.includes('ehon')).toBe(true)
    expect(rows.includes('古い質問')).toBe(false)
    // 開け閉めは画面をまたいで残るので、閉じておく
    await ui.press({ key: 'fold-matsu' })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(x => x.text)
  await ui.press({ key: 'fold-matsu' })
  // 1件を押すと、なぜ・やること。コマンドはそのままの形で写せる
  await ui.press({ key: 'm-m1' })
  expect((await texts()).includes('なぜ：手待ち')).toBe(true)
  expect((await texts()).includes('claude plugin install foo@bar')).toBe(true)
  await ui.press({ key: 'copy-m1-0' })
  expect(copied).toEqual(['claude plugin install foo@bar'])
  await ui.press({ key: 'm-m2' })
  expect((await texts()).includes('やること：表紙は案1か案2か')).toBe(true)
  // 返事待ちには「おすすめで」が1つ。押すと秘書の会話にその件の答えを送る。手待ちには無い
  expect(await ui.find({ type: 'Button', key: 'ans-m1' })).toBeUndefined()
  await ui.press({ key: 'm-m0' })
  await ui.press({ key: 'ans-m0' })
  expect(sent).toEqual(['仕事の件（案 A／B のどちらにするか）：おすすめで'])
  await ui.unmount()
})

import { expect, mock, test } from 'claude-code/testing'

// この PC はほかのセッションで混むことがあるので、1本の待ち時間を長めに（中身の速さは変えない）
const SLOW_PC_MS = 30_000

// notes の3つのファイルを、中身を小さくして置き換える
const FILES: Record<string, string> = {
  'roles/roster.md': [
    '# 係の名簿',
    '| 係名 | 立場（agents/） | 使うPM | 役割カード |',
    '|---|---|---|---|',
    '| 判定役 | judge | 仕事 | roles/判定役.md |',
    '| 市場調査係 | researcher | 仕事 | roles/市場調査係.md |',
    '| ニュース調べ係 | researcher | 全部門 | roles/ニュース調べ係.md |',
  ].join('\n'),
  'status/index.md': [
    '| 部門 | 1行 | 詳細 |',
    '|---|---|---|',
    '| 仕事 | 動：試作A（審査待ち。本人）・試作B。ほかは待ち | status/仕事.md |',
    '| 学び | 課題を出す | status/学び.md |',
    '| 制作 | | status/制作.md |',
    '| 家 | | status/家.md |',
    // 詳細が別のファイルを指す行は部門ではない
    '| 組織 | 入口は秘書ひとつ | org/design.md |',
  ].join('\n'),
  'status/制作.md': [
    '## 依頼中（秘書が立てたセッション）',
    '- 2026-10-23 soshiki-zu：組織図の MOD を作る → 直し中',
    '- 2026-10-23 ehon（ehon-kobo）：表紙の案3つ',
    '',
    '## 台帳',
    '### ehon-kobo（共同作業）— 制作・動',
    '### kakeibo（教育 MOD）— 制作',
    '### ehon — 制作',
  ].join('\n'),
  // 記録（kiroku-botan と同じ形）
  'status/生活.md': [
    '## 声かけ',
    '| 項目 | から | まで | 曜 | 言い方 |',
    '|---|---|---|---|---|',
    '| 昼 | 11:30 | 13:00 | 毎日 | 昼ごはん |',
    '| 夜 | 19:00 | 21:00 | 毎日 | 夜ごはん |',
    '',
    '## 間隔',
    '| 項目 | 日 | メモ |',
    '|---|---|---|',
    '| 洗濯 | 3 | |',
    '| 運動 | 2 | |',
    '',
    '## 定例（曜日ごと）',
    '| 曜 | すること | 時刻の目安 |',
    '|---|---|---|',
    '| 月・火・水・木・金 | 17:20 に家を出る（学校まで40分） | |',
  ].join('\n'),
  // 記録のフック：ここにある合図の一覧がボタンになる
  '.claude/scripts/life-log.ps1': "    $items = @('朝','昼','夜')",
  'status/締め切り.md': [
    '## 予定',
    '| 日付 | 部門 | やること | 状態 |',
    '|---|---|---|---|',
    '| 2026-10-23 | 家 | 書類を出す（16:00まで） | 未 |',
    '| 2026-10-22 | 家 | 済んだもの | 済 |',
  ].join('\n'),
  'journal/記録/2026-10.md': [
    '- 2026-10-20 20:00 洗濯',
    '- 2026-10-22 18:00 運動',
    '- 2026-10-23 08:00 運動',
    '- 2026-10-23 08:10 朝 なし',
  ].join('\n'),
}

const PANE = {
  plugin: 'soshiki-zu',
  component: 'Pane',
  requestId: 'soshiki',
  props: {
    title: '組織図',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const PROMPT = '役割カード: /home/a/notes/roles/市場調査係.md\n出力先: work/市場調査係/2026-10-23-test.md\n調べて'

test('係が呼ばれると動いているに出て、終わると状態が変わる', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'soshiki' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    // パスは作業フォルダからの相対で読まれる（エンジンが絶対パスにして渡すこともある）
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    const text = key === undefined ? undefined : FILES[key]
    if (text === undefined) throw new Error('no file')
    return { value: text }
  })
  // エンジンの係の一覧：終わるまでは a1 が動いている
  let status: 'running' | 'completed' = 'running'
  on('agent.list', () => ({ value: [{ id: 'a1', description: '', type: 'researcher', status }] }))
  let t = 1_792_738_000_000
  on('clock.now', () => ({ value: (t += 1000) }))
  on('clock.every', () => ({ value: {} as never }))
  on('clock.after', () => ({ value: {} as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('turn.complete', e => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: PROMPT,
    description: '試作B の市場調査',
    subagentType: 'researcher',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: true,
    fork: false,
  })

  // 描かれた文字を上から順に並べて確かめる。印の説明（マウスを乗せたときの文）は alts に
  const textsOf = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(x => x.text)
    const alts = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.alt))
    await ui.unmount()
    return Object.assign(texts, { alts })
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    const texts = await textsOf(surface)
    // 動いている係は名前と時間だけ。作業の内容は押すまで出さない
    expect(texts.includes('試作B の市場調査')).toBe(false)
    // 「本人」の行は出さない
    expect(texts.includes('本人')).toBe(false)
    // 時計は読まれるたびに1秒進むので、秒か分
    expect(texts.some(x => /^  \d+(秒|分)$/.test(x))).toBe(true)
    // 上の欄には出さず、自動で開いた組織図の枝だけに出る（回る印）
    expect(texts.filter(x => x === '市場調査係').length).toBe(1)
    // 「1人動いている」は数字だけ
    expect(texts.includes('  1')).toBe(true)
    // 状態と出力先は、印の説明（マウスを乗せたとき）に入る（デスクトップ）
    // 状態と出力先は、名前を押すと開く（下の PM の枝のテスト）
    // 括弧の中の「。」では切らない
    expect(texts.includes('動：試作A（審査待ち。本人）・試作B')).toBe(true)
    expect(texts.includes('全部門')).toBe(true)
    expect(texts.includes('外の現場')).toBe(true)
    // セッション一覧の道具が無いときも、上の欄には出さない（台帳にある依頼中は、外の現場の枝を開くと出る）
    expect(texts.includes('ehon')).toBe(false)
    expect(texts.includes('表紙の案3つ')).toBe(false)
  }

  status = 'completed'
  await $.turn.complete({
    agentId: 'a1',
    answer: '状態: 一部\n2件取れず',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })

  const texts = await textsOf('desktop')
  // 最近の行だけに残り（枝は閉じる）、状態「一部」は印の説明に
  expect(texts.filter(x => x === '市場調査係').length).toBe(1)
  expect(texts.alts.includes('一部\nwork/市場調査係/2026-10-23-test.md')).toBe(true)
  expect(texts.includes('最近')).toBe(true)
})

test('PM の枝は最初閉じていて、押すと開く。係が動くと枝が開いて橙になる', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'soshiki' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    if (key === undefined) throw new Error('no file')
    return { value: FILES[key] ?? '' }
  })
  on('agent.list', () => ({ value: [] }))
  mock.clock(on, { now: 1_792_738_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = async () => (await ui.findAll({ type: 'Text' })).map(x => x.text)
    // 閉じているときは係の数だけ
    expect((await texts()).includes('判定役')).toBe(false)
    expect((await texts()).includes('  2')).toBe(true)
    // 枝の線：ターミナルは罫線の文字、デスクトップは本物の線（SVG）。ふだんは灰だけで、橙は無い
    if (surface === 'terminal') expect((await texts()).includes('└─ ')).toBe(true)
    else {
      const lines = (await ui.findAll({ type: 'Svg' })).filter(x => x.props.alt === '枝の線')
      expect(lines.length > 0).toBe(true)
      expect(lines.some(x => String(x.props.source).includes('#D97757'))).toBe(false)
    }
    await ui.press({ key: 'fold-pm:仕事' })
    expect((await texts()).includes('判定役')).toBe(true)
    await ui.press({ key: 'fold-pm:仕事' })
    expect((await texts()).includes('判定役')).toBe(false)
    await ui.unmount()
  }

  // 係が動き出すと、閉じていた枝でも自動で開き、動いている係へ続く枝の線だけ橙になる
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: PROMPT,
    description: '試作B の市場調査',
    subagentType: 'researcher',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: true,
    fork: false,
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const during = (await ui.findAll({ type: 'Text' })).map(x => x.text)
  expect(during.filter(x => x === '市場調査係').length).toBe(1)
  const lines = (await ui.findAll({ type: 'Svg' })).filter(x => x.props.alt === '枝の線')
  expect(lines.some(x => String(x.props.source).includes('#D97757'))).toBe(true)
  expect(lines.some(x => !String(x.props.source).includes('#D97757'))).toBe(true)
  // 回る印は、秘書・部門・係の3か所（組織図の中で、どこが動いているかわかる）
  const spins = (await ui.findAll({ type: 'Svg' })).filter(x => String(x.props.source).includes('animateTransform') && !String(x.props.alt).includes('：'))
  expect(spins.map(x => String(x.props.alt))).toEqual(['係が動いている', '動いている', '調べ役'])
  // 動いている係の名前を押すと、作業の内容・出力先と「やりとり」が開く
  await ui.press({ key: 'view-a1' })
  const opened = (await ui.findAll({ type: 'Text' })).map(x => x.text)
  expect(opened.includes('試作B の市場調査')).toBe(true)
  expect(opened.includes('work/市場調査係/2026-10-23-test.md')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'talk-a1' })).toBeDefined()
  // 見本のボタンはもう無い
  expect(await ui.find({ type: 'Button', key: 'mihon' })).toBeUndefined()
  await ui.unmount()
})

test('秘書が立てた現場のセッションが、係と分けて出る。外の現場の枝にも出る', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'soshiki' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    if (key === undefined) throw new Error('no file')
    return { value: FILES[key] ?? '' }
  })
  on('agent.list', () => ({ value: [] }))
  const clock = mock.clock(on, { now: Date.parse('2026-10-23T07:10:00Z') })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // アプリのセッション一覧：soshiki-zu は動いている、ehon-kobo は止まっている、秘書自身（startedBy なし）は出さない
  const rows = [
    { sessionId: 'local_a', title: '組織図の MOD（右ペイン）', cwd: '/home/a/notes', isRunning: true, lastActivityAt: '2026-10-23T07:09:00Z', startedBy: 'local_h' },
    { sessionId: 'local_b', title: 'ehon-kobo：表紙の案3つを本人に見せる', cwd: '/home/a/ehon', isRunning: false, lastActivityAt: '2026-10-23T07:05:00Z', name: 'ehon-kobo', startedBy: 'local_h' },
    { sessionId: 'local_h', title: '秘書', cwd: '/home/a/notes', isRunning: false, lastActivityAt: '2026-10-23T07:05:00Z' },
  ]
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('tool.call', () => ({ result: {}, text: JSON.stringify(rows) }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // 一覧は始まりを待たせずに取りに行く：15秒の見回りを1回進める
  await clock.advance(15_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(x => x.text)
    // フォルダ名は依頼中の行から（soshiki-zu は notes で動いているが、現場の名前で出す）
    expect(texts.includes('soshiki-zu')).toBe(true)
    // 題名（何の作業か）は押すまで出さない
    expect(texts.includes('組織図の MOD（右ペイン）')).toBe(false)
    expect(texts.includes('ehon')).toBe(true)
    // 止まっているセッションは、止まってからの時間だけ（状態は印と、マウスを乗せたときの説明）
    expect(texts.includes('  5分')).toBe(true)
    expect(texts.includes('秘書')).toBe(true)
    // 動いているセッションがあるので外の現場の枝が開き、台帳の残り（kakeibo）も出る。ehon-kobo は ehon のセッションに入る
    expect(texts.includes('  1')).toBe(true)
    expect(texts.includes('kakeibo')).toBe(true)
    expect(texts.includes('ehon-kobo')).toBe(false)
    await ui.unmount()
  }
})

test('読み込み直しでペインが消えたら、本人の次の送信で開き直す', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'soshiki' } }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    if (key === undefined) throw new Error('no file')
    return { value: FILES[key] ?? '' }
  })
  on('agent.list', () => ({ value: [] }))
  mock.clock(on, { now: 1_792_738_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  // 画面が狭いので、頼まれずに開いたペインは待っている（placed にならない）
  let opens = 0
  on('ui.open', () => ((opens += 1), { value: { isPlaced: false, reason: 'narrow' } as never }))
  on('ui.panes', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens).toBe(1)
  await $.prompt.submit({ text: 'こんにちは' } as never)
  expect(opens).toBe(2)
})

test('いちばん上に使用量の1行。8割をこえた枠だけ色。開くとくわしく、係のトークンも出る', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'soshiki' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    if (key === undefined) throw new Error('no file')
    return { value: FILES[key] ?? '' }
  })
  let status: 'running' | 'completed' = 'running'
  on('agent.list', () => ({ value: [{ id: 'a1', description: '', type: 'researcher', status }] }))
  mock.clock(on, { now: Date.parse('2026-10-23T07:40:00Z') })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  // エンジンの数字：5時間 85%（16:40 JST に戻る）、週 66%
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000, tokens: 262_917, percent: 26 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-23T07:40:01Z' },
        { kind: 'seven_day', percentUsed: 66, resetsAt: '2026-10-26T15:00:01Z' },
      ],
      cost: { usd: 1.5 },
    },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: PROMPT,
    description: '試作B の市場調査',
    subagentType: 'researcher',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: true,
    fork: false,
  })
  status = 'completed'
  await $.turn.complete({
    agentId: 'a1',
    answer: '状態: 完了',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { input_tokens: 100, output_tokens: 900, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 1_000, model: 'm' },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const found = async () => await ui.findAll({ type: 'Text' })
    const five = (await found()).find(x => x.text.startsWith('85%'))
    expect(five?.text).toBe('85% ·16:40')
    // 8割をこえたので黄色
    expect(five?.props.color).toBe('warning')
    const week = (await found()).find(x => x.text === '66%')
    expect(week?.props.color).toBe(undefined)
    // バー：ターミナルは8マスの文字、デスクトップは SVG
    if (surface === 'terminal') {
      expect((await found()).some(x => x.text === '███████░')).toBe(true)
      expect((await found()).some(x => x.text === '█████░░░')).toBe(true)
    } else {
      const bars = await ui.findAll({ type: 'Svg' })
      expect(bars.some(x => x.props.alt === '5時間 85%')).toBe(true)
    }
    expect((await found()).some(x => x.text.startsWith('秘書 '))).toBe(false)
    await ui.press({ key: 'fold-usage' })
    const texts = (await found()).map(x => x.text)
    expect(texts.includes('週 66% ·10/27 00:00')).toBe(true)
    expect(texts.includes('秘書 26.3万 (26%) · $1.50')).toBe(true)
    expect(texts.includes('市場調査係 1.2万')).toBe(true)
    await ui.press({ key: 'fold-usage' })
    await ui.unmount()
  }
})

test('組織図の下に記録。済は薄く押せない、目安超えは橙、押すと合図を送る。洗濯などは「ほか」に', { timeoutMs: SLOW_PC_MS }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'soshiki' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    if (key === undefined) throw new Error('no file')
    return { value: FILES[key] ?? '' }
  })
  on('agent.list', () => ({ value: [] }))
  // 2026-10-23（金）12:00（日本時間）
  mock.clock(on, { now: Date.UTC(2026, 9, 23, 3, 0) })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(x => x.text)
    // 組織図のあとに記録が来る
    expect(texts.indexOf('外の現場') < texts.indexOf('10/23（金） 12:00')).toBe(true)
    // 次の予定：今日の定例（17:20）より、締め切り.md の「予定」（16:00まで）が先
    expect(texts.includes('  書類を出す あと 4:00 · 16:00')).toBe(true)
    // ボタンはフックの合図（朝・昼・夜）。「なし」（朝）は押せない
    expect(texts.includes('薬')).toBe(false)
    expect(await ui.find({ type: 'Button', key: 'kiroku-朝' })).toBeUndefined()
    expect(texts.includes(' なし')).toBe(true)
    // 昼は目安（11:30）を過ぎたので橙、夜はまだ目安前
    expect((await ui.find({ type: 'Text', text: '昼' }))?.props.color).toBe('claude')
    expect((await ui.find({ type: 'Text', text: '夜' }))?.props.color).toBe(undefined)
    // 洗濯（3日ごと・20日から）は「ほか」の中。ほかは目安超えがあるので橙
    expect(texts.includes('洗濯')).toBe(false)
    expect((await ui.find({ type: 'Button', key: 'fold-hoka' })) !== undefined).toBe(true)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'fold-hoka' })
  expect((await ui.find({ type: 'Text', text: '洗濯' }))?.props.color).toBe('claude')
  // 運動は今日 08:00 に済：薄く、時刻が出る
  expect((await ui.find({ type: 'Text', text: '運動' }))?.props.color).toBe(undefined)
  expect((await ui.findAll({ type: 'Text' })).some(x => x.text === ' 08:00')).toBe(true)
  // 押すと今と同じ合図（名前だけ。フックがいまの時刻で書く）。押したあとは済になって押せない
  await ui.press({ key: 'kiroku-昼' })
  expect(sent).toEqual(['昼'])
  expect(await ui.find({ type: 'Button', key: 'kiroku-昼' })).toBeUndefined()
  await ui.unmount()
})

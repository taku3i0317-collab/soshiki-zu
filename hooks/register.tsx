import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Chart, Genba, Irai, Item, Kakari, Matsu, Open, Pm, Run, RunState, Session, Sessions, Usage, Window } from '../types'
import { ACCENT, BAR_PX, GRAY, RED, ROW_PX, SEG_PX, YELLOW, barSvg, barText, branchSvg, glyphOf, icon, nodeSeg, pmIcon, passSeg, spinner } from './icons'
import type { Seg } from './icons'
import { SKIP, clockOf, loadKiroku } from './kiroku'
import { loadMatsu } from './matsu'
import { PetSection, petMessage, petSessions, petSpawned, petStart, petTurnComplete, petTurnStart } from './pet/index'

// 秘書のフォルダ（notes）のファイルは読むだけ。パスは作業フォルダからの相対：roles/roster.md の無いフォルダではペインを開かない
const ROSTER = 'roles/roster.md'
const INDEX = 'status/index.md'
// どの PM にも入らない係の枝の名前（名簿の「使う部門」に書く言葉）
const ALL = '全部門'
// モジュールの中のタイムゾーンに頼らず、日本時間で数える
const JST = 9 * 60 * 60 * 1000

const PANE = 'soshiki'
const TITLE = '組織図'

const chart = atom({ plugin: 'soshiki-zu', key: 'chart' } as const, null)
const runs = atom({ plugin: 'soshiki-zu', key: 'runs' } as const, [])
// 動いている係の「何分」を進めるための時計。動いている係があるときだけ進める
const now = atom({ plugin: 'soshiki-zu', key: 'now' } as const, 0)
// 本人が開け閉めした枝。書かれていない枝は：PM は動いている係がいれば開く、最近は開く、外の現場は閉じる
const open = atom({ plugin: 'soshiki-zu', key: 'open' } as const, {} as Open)

// 秘書が立てた現場のセッション。アプリのセッション一覧（読むだけの道具）を15秒ごとに聞く
const sessions = atom({ plugin: 'soshiki-zu', key: 'sessions' } as const, { sessions: null, note: '', irai: [] } as Sessions)
// 本人が閉じたペインは開き直さない（読み込み直しで消えたときだけ開き直す）
const closedByPerson = atom({ plugin: 'soshiki-zu', key: 'closedByPerson' } as const, false)
const LIST_SESSIONS = 'mcp__ccd_session_mgmt__list_sessions'
// 使用量：エンジンの数字（5時間・週・このセッションの会話の長さと料金）と、アプリの数字（週・モデル別、ほかのセッションの会話の長さ）
const usage = atom({ plugin: 'soshiki-zu', key: 'usage' } as const, null)
const GET_USAGE = 'mcp__ccd_session_mgmt__get_usage'
// この割合をこえたら色で知らせる（黄）。もっと危ないとき（赤）
const WARN_PCT = 80
const DANGER_PCT = 95
const SESSIONS_MS = 15_000

// 組織図の下の記録（status/生活.md・journal/記録/ を読む）。目安の時刻をまたいだら色を変えるため、1分ごとに読み直す
const kiroku = atom({ plugin: 'soshiki-zu', key: 'kiroku' } as const, null)
const KIROKU_MS = 60_000
// あなた待ち。止まって間もない現場のセッションも「返事待ちかも」として入れる（この時間まで）
const matsu = atom({ plugin: 'soshiki-zu', key: 'matsu' } as const, [])
const MATSU_SESSION_MS = 2 * 60 * 60 * 1000
// 次の予定が近い（分）と橙
const SOON_MIN = 30

// 終わった係は「最近」に、数と時間で区切って残す
const RECENT_MAX = 6
// ペインに出す「最近」の数（1件1行）
const RECENT_SHOW = 3
const RECENT_MS = 60 * 60 * 1000
const TICK_MS = 5_000
const ICON_PX = 16

const ROLE_JA: Record<string, string> = {
  researcher: '調べ役',
  generator: '量産役',
  critic: 'ツッコミ役',
  judge: '裁判官役',
  finisher: '仕上げ役',
  circuit: '回路係',
}

const pad = (n: number) => String(n).padStart(2, '0')
const hmOf = (ms: number) => {
  const d = new Date(ms + JST)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
function lengthOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分`
  return `${Math.floor(m / 60)}時間${m % 60}分`
}

// 12345 → 1.2万トークン、850 → 850トークン
function tokensOf(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`
  return `${n}`
}

/** md の表の行をセルの配列で返す（見出し行と区切り行は落とす）。heading を渡すとその「## 見出し」の下だけ */
function tableRows(md: string, heading?: string): string[][] {
  const rows: string[][] = []
  let inside = heading === undefined
  for (const line of md.split(/\r?\n/)) {
    if (heading !== undefined && line.startsWith('## ')) {
      inside = line.startsWith(`## ${heading}`)
      continue
    }
    if (!inside || !line.startsWith('|') || /^\|\s*-/.test(line)) continue
    rows.push(line.split('|').slice(1, -1).map(c => c.trim()))
  }
  return rows.slice(1)
}

// 「動：試作A（…）・試作B（…）。ほかは…」→「試作A（…）・試作B（…）」。動が無い部門は1行そのまま
// 括弧の中の「。」では切らない
function doingOf(line: string): string {
  const at = line.indexOf('動：')
  if (at < 0) return line.trim()
  const rest = line.slice(at + 2)
  let depth = 0
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (ch === '（') depth++
    else if (ch === '）') depth = Math.max(0, depth - 1)
    else if (ch === '。' && depth === 0) return rest.slice(0, i).trim()
  }
  return rest.trim()
}

// 台帳の見出し「### kakeibo（家計簿のアプリ）— 制作」→ 名前と部門
function genbaOf(md: string): Genba[] {
  const out: Genba[] = []
  let inside = false
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      inside = line.startsWith('## 台帳')
      continue
    }
    if (!inside || !line.startsWith('### ')) continue
    const [head = '', bumon = ''] = line.slice(4).split(/\s*—\s*/)
    const name = head.replace(/（.*$/, '').trim()
    if (name) out.push({ name, bumon: bumon.trim() })
  }
  return out
}

const readOr = async ($: Engine, path: string) => {
  try {
    return (await $.fs.read(path)) as string
  } catch {
    return ''
  }
}

// 部門（PM）は status/index.md の表の左の列から。「詳細」の列が別のファイル（org/design.md・status/好み.md など）を
// 指している行は部門ではないので落とす（詳細が空か status/<部門名>.md の行だけ）。表が読めなければ、名簿の「使う部門」から
function pmsOf(index: string, kakari: Kakari[]): Pm[] {
  const fromIndex = tableRows(index)
    .filter(([b = '', , detail = '']) => {
      const path = /\S+?\.md/.exec(detail.replace(/\\/g, '/'))?.[0]
      return b !== '' && (path === undefined || path === `status/${b}.md`)
    })
    .map(([name = '', line = '']) => ({ name, doing: doingOf(line) }))
  if (fromIndex.length > 0) return fromIndex
  return [...new Set(kakari.map(k => k.pm).filter(pm => pm !== '' && pm !== ALL))].map(name => ({ name, doing: '' }))
}

// 秘書が立てた現場の「## 依頼中」と「## 台帳」は、どれかの部門の status/<部門名>.md に書いてある。部門のファイルをつないで読む
async function deptFiles($: Engine, pms: Pm[]): Promise<{ name: string; md: string }[]> {
  const out: { name: string; md: string }[] = []
  for (const p of pms) out.push({ name: p.name, md: await readOr($, `status/${p.name}.md`) })
  return out
}

async function deptText($: Engine, pms: Pm[]): Promise<string> {
  return (await deptFiles($, pms)).map(d => d.md).join('\n')
}

// 組織図と、部門のファイル（あなた待ちも同じ中身から読む。読むのは1回）
async function loadChart($: Engine): Promise<{ chart: Chart; depts: { name: string; md: string }[] } | null> {
  const roster = await readOr($, ROSTER)
  if (!roster) return null
  const kakari: Kakari[] = tableRows(roster)
    .filter(r => r.length >= 3 && r[0])
    .map(([name = '', role = '', pm = '']) => ({ name, role, pm }))
  const pms = pmsOf(await readOr($, INDEX), kakari)
  const depts = await deptFiles($, pms)
  return { chart: { pms, kakari, genba: genbaOf(depts.map(d => d.md).join('\n')) }, depts }
}

// 「## 依頼中」の行「- 2026-10-23 ehon（ehon-kobo）：表紙の案を3つ…」→ 名前2つと作業
function iraiOf(md: string): Irai[] {
  const out: Irai[] = []
  let inside = false
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      inside = line.startsWith('## 依頼中')
      continue
    }
    const m = inside ? /^- (?:\d{4}-\d{2}-\d{2}\s+)?(.+?)：(.*)$/.exec(line) : null
    if (!m) continue
    const names = (m[1] ?? '').split(/[（）]/).map(s => s.trim()).filter(Boolean)
    if (names.length > 0) out.push({ names, what: (m[2] ?? '').trim() })
  }
  return out
}

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

// セッション1つを依頼中の行に結び付ける：短い名前・フォルダ名・題名に、依頼中の名前が入っているか。
// 入っていなければ、依頼中の作業の書き出し（6文字）が題名に入っているか
function iraiFor(s: { name?: string; cwd: string; title: string }, irai: Irai[]): Irai | undefined {
  const folder = baseName(s.cwd)
  return (
    irai.find(i => i.names.some(n => n === s.name || n === folder || s.title.includes(n))) ??
    irai.find(i => i.what.length >= 6 && s.title.includes(i.what.slice(0, 6)))
  )
}

type ListedSession = {
  sessionId: string
  title: string
  cwd: string
  isArchived?: boolean
  isRunning?: boolean
  lastActivityAt?: string
  name?: string
  startedBy?: string
}

// アプリの読むだけの道具を、許可が要らないとき（allow）だけ呼んで、返事の JSON を返す。だめなら null
async function appTool($: Engine, tool: string, input: Record<string, unknown>): Promise<unknown> {
  try {
    const check = await $.tool.check({ tool, input })
    if (check.decision !== 'allow') return null
    const r = await $.tool.call({ tool, ...input } as never)
    if ('deny' in r && r.deny !== undefined) return null
    return JSON.parse(r.text ?? 'null') as unknown
  } catch {
    return null
  }
}

type AppUsage = {
  plan?: { status?: string; windows?: { label: string; percentUsed: number; resetsAt?: string }[] }
  context?: { status?: string; tokensUsed?: number; percentUsed?: number }
}

const msOf = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN)
const windowOf = (label: string, pct: number, resetsAt: string | undefined): Window => {
  const ms = msOf(resetsAt)
  return { label, pct, resetsAt: Number.isFinite(ms) ? ms : null }
}

// エンジンの数字を先に使う（無料・許可いらず）。エンジンにまだ数字が無いとき（このセッションが最初の返事の前）だけ、アプリの数字で埋める
async function loadUsage($: Engine): Promise<Usage> {
  const u = await $.session.usage()
  const rl = (kind: string, label: string) => {
    const w = u.rateLimits.find(r => r.kind === kind)
    return w ? windowOf(label, w.percentUsed, w.resetsAt) : null
  }
  let five = rl('five_hour', '5時間')
  let week = rl('seven_day', '週')
  const app = (await appTool($, GET_USAGE, { session_id: 'self' })) as AppUsage | null
  const appWindows = app?.plan?.status === 'ok' ? (app.plan.windows ?? []) : []
  const appFive = appWindows.find(w => /5-hour/i.test(w.label))
  const appWeek = appWindows.find(w => /^Weekly · all models$/i.test(w.label))
  five ??= appFive ? windowOf('5時間', appFive.percentUsed, appFive.resetsAt) : null
  week ??= appWeek ? windowOf('週', appWeek.percentUsed, appWeek.resetsAt) : null
  const models = appWindows
    .filter(w => /^Weekly · /i.test(w.label) && !/all models/i.test(w.label))
    .map(w => windowOf(`週・${w.label.replace(/^Weekly · /i, '')}`, w.percentUsed, w.resetsAt))
  const ctx =
    u.context.tokens !== undefined && u.context.percent !== undefined
      ? { tokens: u.context.tokens, percent: u.context.percent }
      : null
  return { five, week, models, ctx, usd: u.cost?.usd ?? null }
}

async function refreshUsage($: Engine) {
  try {
    const next = await loadUsage($)
    await update($, usage, () => next)  } catch {}
}

// 一覧の道具は、許可が要らないとき（allow）だけ呼ぶ。聞かれる設定なら呼ばずに、依頼中の行だけ出す（15秒ごとに許可の画面が出ないように）
async function loadSessions($: Engine): Promise<Sessions> {
  const irai = iraiOf(await deptText($, (await read($, chart))?.pms ?? []))
  try {
    const check = await $.tool.check({ tool: LIST_SESSIONS, input: { linked: true } })
    if (check.decision !== 'allow') return { sessions: null, note: 'セッション一覧の道具に許可が要る（README）', irai }
    const r = await $.tool.call({ tool: LIST_SESSIONS, linked: true } as never)
    if ('deny' in r && r.deny !== undefined) return { sessions: null, note: 'セッション一覧が取れない', irai }
    const rows = JSON.parse(r.text ?? '[]') as ListedSession[]
    const list: Session[] = rows
      // 秘書が立てたもの（startedBy がある）だけ。しまったものは出さない
      .filter(s => s.startedBy !== undefined && !s.isArchived)
      .map(s => {
        const i = iraiFor({ name: s.name, cwd: s.cwd, title: s.title }, irai)
        return {
          id: s.sessionId,
          folder: i?.names[0] ?? s.name ?? baseName(s.cwd),
          title: s.title,
          isRunning: s.isRunning === true,
          lastActivityAt: s.lastActivityAt ? Date.parse(s.lastActivityAt) : 0,
          ctx: null as Session['ctx'],
        }
      })
    // 動いているセッションだけ、会話の長さを聞く（止まっているセッションはアプリも「取れない」と返す）
    for (const s of list.filter(x => x.isRunning)) {
      const app = (await appTool($, GET_USAGE, { session_id: s.id })) as AppUsage | null
      const c = app?.context
      if (c?.status === 'ok' && c.tokensUsed !== undefined && c.percentUsed !== undefined) {
        s.ctx = { tokens: c.tokensUsed, percent: c.percentUsed }
      }
    }
    return { sessions: list, note: '', irai }
  } catch {
    return { sessions: null, note: 'セッション一覧が取れない', irai }
  }
}

async function refreshSessions($: Engine) {
  // 使用量も同じ15秒で読み直す（戻る時刻をまたいだとき・ほかのセッションが使ったとき）
  void refreshUsage($)
  try {
    const next = await loadSessions($)
    // 「止まって 5分」を進めるため、時計も進める
    const t = await $.clock.now()
    await update($, now, () => t)
    await update($, sessions, () => next)
    await petSessions($, (next.sessions ?? []).filter(s => s.isRunning).map(s => ({ id: s.id, name: s.folder })))
  } catch {}
}

async function refreshKiroku($: Engine) {
  try {
    const next = await loadKiroku($)
    await update($, kiroku, () => next)
  } catch {}
}

async function refreshChart($: Engine) {
  try {
    const next = await loadChart($)
    await update($, chart, () => next?.chart ?? null)
    if (next !== null) {
      const m = await loadMatsu($, next.depts)
      await update($, matsu, () => m)
    }
  } catch {}
}

// 係を呼ぶプロンプトには「役割カード: …/roles/<係名>.md」と「出力先: work/<係名>/…」が入る（CLAUDE.md の約束）
function cardOf(prompt: string): string | null {
  const m = /役割カード\s*[:：]\s*\S*?roles[\\/]([^\\/\s`'"]+?)\.md/.exec(prompt)
  return m?.[1] ?? null
}
function outOf(prompt: string): string {
  const m = /出力先\s*[:：]\s*`?\S*?(work[\\/][^\s`'"]+)/.exec(prompt)
  return (m?.[1] ?? '').replace(/\\/g, '/')
}
// 係の返事の1行目は「状態: 完了|一部|失敗」
function stateOf(answer: string): RunState {
  const m = /状態\s*[:：]\s*\**\s*(完了|一部|失敗)/.exec(answer.slice(0, 400))
  return (m?.[1] as RunState | undefined) ?? '終わった'
}

// 動いている係はすべて、終わった係は新しい順に RECENT_MAX まで・RECENT_MS 以内だけ残す
function prune(list: Run[], t: number): Run[] {
  const running = list.filter(r => r.state === 'running')
  const done = list
    .filter(r => r.state !== 'running' && r.endedAt !== null && t - r.endedAt < RECENT_MS)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, RECENT_MAX)
  return [...running, ...done]
}

const finish = async ($: Engine, id: string, state: RunState) => {
  const t = await $.clock.now()
  await update($, runs, list =>
    prune(
      (list ?? []).map(r => (r.id === id && r.state === 'running' ? { ...r, state, endedAt: t } : r)),
      t,
    ),
  )
}

// 係が始まったら、本人が閉じていたその PM の枝も「決まりの開き方」（動いていれば開く）に戻す
async function reopenFor($: Engine, name: string) {
  const c = await read($, chart)
  const pm = c?.kakari.find(k => k.name === name)?.pm
  if (pm === undefined) return
  const key = `pm:${c?.pms.some(p => p.name === pm) ? pm : ALL}`
  await update($, open, cur => {
    const { [key]: _, ...rest } = cur ?? {}
    return rest
  })
}

// フックを取りこぼしても（読み込み直し・中断）止まったままにならないよう、エンジンの一覧と突き合わせる
async function tick($: Engine) {
  try {
    const list = (await read($, runs)) ?? []
    const running = list.filter(r => r.state === 'running')
    if (running.length === 0) return
    const t = await $.clock.now()
    await update($, now, () => t)
    const agents = new Map((await $.agent.list()).map(a => [a.id, a.status]))
    for (const r of running) {
      const s = agents.get(r.id)
      // 始まって間もないもの（まだ agentId になっていない）は待つ
      if (t - r.startedAt < 10_000) continue
      if (s === undefined || s === 'completed') await finish($, r.id, '終わった')
      else if (s === 'failed') await finish($, r.id, '失敗')
      else if (s === 'killed') await finish($, r.id, '中断')
    }
  } catch {}
}

export const register: Register = (on, options) => {
  // ペットのキャラの差しかえ（空なら既定のキャラ）
  const charaFile = typeof options.charaFile === 'string' ? options.charaFile : ''
  let timer: { cancel: () => void } | undefined
  let sessionTimer: { cancel: () => void } | undefined
  let kirokuTimer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await refreshChart($)
    await petStart($, charaFile)
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => void tick($))
    sessionTimer?.cancel()
    kirokuTimer?.cancel()
    if ((await read($, chart)) !== null) {
      void refreshSessions($)
      sessionTimer = $.clock.every(SESSIONS_MS, () => void refreshSessions($))
      await refreshKiroku($)
      kirokuTimer = $.clock.every(KIROKU_MS, () => void refreshKiroku($))
    }
    await $.command.register({ name: 'soshiki', description: '組織図のペインを右に開く' })
    // 頼まれずに開くペインは、画面が広いときだけ出る（狭いと待つ）。待っていたら本人の次の送信で開く（下の prompt.submit）
    if ((await read($, chart)) !== null && !(await read($, closedByPerson))) void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'soshiki' }, async $ => {
    await refreshChart($)
    await update($, closedByPerson, () => false)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: '組織図のペインを開いた' }
  })

  // 使用量が動いたとき（ターンの終わり・枠が1ポイント動いたとき）にエンジンが知らせてくる
  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    if ((await read($, chart)) !== null) void refreshUsage($)
    return r
  })

  // 本人が閉じたら覚えておく。読み込み直し（unload）で消えたのは本人が閉じたのではない
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, closedByPerson, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  // 読み込み直しでペインが消えたあと、本人が何か送ったら開き直す（本人の送信のあとなら、狭い画面でも出る）
  // 記録はフックが送信のときに書くので、送信のあとに読み直す
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    try {
      if ((await read($, chart)) !== null) await refreshKiroku($)
      if ((await read($, chart)) !== null && !(await read($, closedByPerson))) {
        const pane = (await $.ui.panes()).find(p => p.id === PANE)
        if (pane === undefined || !pane.isPlaced) await $.ui.open({ id: PANE, title: TITLE })
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  // 係が呼ばれた：見るだけで、呼び出しは変えない
  on('agent.spawn', async ($, e, next) => {
    const t = await $.clock.now()
    const resumed = e.resume?.agentId
    if (resumed !== undefined) {
      // SendMessage で起こされた係は、同じ行を「動いている」に戻す
      const r = await next(e)
      await update($, runs, list =>
        (list ?? []).map(x => (x.id === resumed ? { ...x, state: 'running' as const, startedAt: t, endedAt: null } : x)),
      )
      return r
    }
    const card = cardOf(e.prompt)
    const run: Run = {
      id: e.tool_use_id || `spawn-${t}`,
      name: card ?? e.subagentType,
      role: e.subagentType,
      hasCard: card !== null,
      description: e.description,
      out: outOf(e.prompt),
      startedAt: t,
      endedAt: null,
      state: 'running',
    }
    await update($, now, () => t)
    await update($, runs, list => prune([run, ...(list ?? [])], t))
    await reopenFor($, run.name)
    const r = await next(e)
    if ('deny' in r && r.deny !== undefined) {
      await update($, runs, list => (list ?? []).filter(x => x.id !== run.id))
    } else if (r.agentId !== undefined) {
      const id = r.agentId
      await update($, runs, list => (list ?? []).map(x => (x.id === run.id ? { ...x, id } : x)))
      await petSpawned($, id, e.description || e.subagentType || '係')
    }
    return r
  }).catch(($, e, next) => next(e))

  // 係の1回が終わった：返事の先頭の「状態:」行を読む。秘書のターンの終わりには名簿を読み直す
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await petTurnComplete($, e)
    if (e.agentId === undefined) {
      await refreshChart($)
      if ((await read($, chart)) !== null) {
        void refreshSessions($)
        await refreshKiroku($)
      }
      return r
    }
    const known = ((await read($, runs)) ?? []).some(x => x.id === e.agentId && x.state === 'running')
    if (known) {
      const state: RunState = e.isAborted ? '中断' : e.reason === 'error' ? '失敗' : stateOf(e.answer)
      await finish($, e.agentId, state)
      // エンジンが数えたトークン（このターンの分）を足す。数えていなければ書かない
      const u = e.usage
      if (u !== undefined) {
        const sum = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens
        const id = e.agentId
        await update($, runs, list => (list ?? []).map(x => (x.id === id ? { ...x, tokens: (x.tokens ?? 0) + sum } : x)))
      }
    }
    return r
  })

  // このセッション自身のターンが始まった（ペットが「考え中」になる）
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await petTurnStart($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // ペットのゲームの部品から：もどる・さいこう点
  on('ui.message', async ($, e, next) => {
    await petMessage($, e.data)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // アイコンはデスクトップ等の表だけにある Svg で描く。ターミナルでは文字だけ
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    // tip はマウスを乗せたときだけ出る説明（文字を減らすため、くわしいことはここへ）
    const Ico = (props: { name: string; color?: string; spin?: boolean; tip?: string }) =>
      Svg ? (
        <Svg
          source={props.spin ? spinner(props.color ?? GRAY, props.tip) : icon(props.name, props.color ?? GRAY, props.tip)}
          alt={props.tip ?? props.name}
          width={ICON_PX}
          height={ICON_PX}
          isInteractive={props.spin || props.tip !== undefined}
        />
      ) : null

    const c = await read($, chart)
    if (c === null) {
      return <Text dimColor>秘書のフォルダ（roles/roster.md がある所）で開いたときに使える</Text>
    }
    const list = (await read($, runs)) ?? []
    const opened = (await read($, open)) ?? {}
    const t = Math.max(await read($, now), ...list.map(r => r.startedAt))
    const running = list.filter(r => r.state === 'running')
    const recent = list.filter(r => r.state !== 'running')
    const busy = new Set(running.map(r => r.name))

    const colorOf = (s: RunState) => (s === 'running' ? ACCENT : s === '失敗' ? RED : s === '一部' ? YELLOW : GRAY)
    const themeOf = (s: RunState) =>
      s === 'running' ? ('claude' as const) : s === '失敗' ? ('error' as const) : s === '一部' ? ('warning' as const) : undefined

    const isOpen = (key: string, byDefault: boolean) => opened[key] ?? byDefault
    const toggle = (key: string, byDefault: boolean) =>
      update($, open, cur => ({ ...(cur ?? {}), [key]: !((cur ?? {})[key] ?? byDefault) }))

    // 開け閉めの見出し：矢印＋名前＋閉じているときの要約。押すと開け閉め
    const Fold = (props: { k: string; isOn: boolean; byDefault: boolean; label: string; note: string; icon?: string; busy?: boolean }) => (
      <Box flexDirection="row" alignItems="center" gap="xs">
        <Ico name={props.isOn ? '開' : '閉'} />
        {props.icon !== undefined && <Ico name={props.icon} color={props.busy ? ACCENT : GRAY} spin={props.busy} tip={props.busy ? '動いている' : undefined} />}
        <Button key={`fold-${props.k}`} plain onPress={() => toggle(props.k, props.byDefault)}>
          {e.surface !== 'terminal' ? '' : props.isOn ? '▾ ' : '▸ '}
          <Text bold color={props.busy ? 'claude' : undefined}>
            {props.label}
          </Text>
          <Text dimColor={!props.busy} color={props.busy ? 'claude' : undefined} size="caption">
            {props.note === '' ? '' : `  ${props.note}`}
          </Text>
        </Button>
      </Box>
    )

    // ツリーの1行：左に枝の線、右に中身。デスクトップは本物の線（SVG）、ターミナルは罫線の文字。
    // 行は1行の高さにそろえる（文字は折り返さず切る）ので、縦の線が行から行へつながる
    const isTerminal = e.surface === 'terminal'
    // 「本人」の行は出さない（本人の決定）。木は本人の下の段から描くので、いちばん左の区切り（本人からの枝）は落とす
    const Line = (props: { segs: Seg[]; children: unknown }) => {
      const segs = props.segs.slice(1)
      return (
      <Box flexDirection="row" alignItems="center">
        {segs.length === 0 ? null : isTerminal || !Svg ? (
          <Text dimColor mono>
            {segs.map(glyphOf).join('')}
          </Text>
        ) : (
          <Svg
            source={branchSvg(segs)}
            alt="枝の線"
            width={segs.length * SEG_PX}
            height={ROW_PX}
          />
        )}
        <Box flexDirection="row" alignItems="center" gap="xs" flexShrink={1} overflow="hidden">
          {props.children as never}
        </Box>
      </Box>
      )
    }

    // 1行＝係の1回。動いている係は名前と時間だけ：押すと作業の内容・出力先と「やりとり」が開く（本人の決定）。
    // 終わった係は押すとその係の画面（やりとり）を見られる
    const RunRow = ({ r }: { r: Run }) => {
      const isRunning = r.state === 'running'
      const detailKey = `d:${r.id}`
      const isDetail = isRunning && isOpen(detailKey, false)
      const when = isRunning
        ? lengthOf(t - r.startedAt)
        : [lengthOf((r.endedAt ?? t) - r.startedAt), hmOf(r.endedAt ?? t), r.tokens !== undefined ? tokensOf(r.tokens) : '']
            .filter(Boolean)
            .join(' · ')
      const tip = [isRunning ? '動いている' : r.state, r.hasCard ? '' : '役割カードなし', r.out].filter(Boolean).join('\n')
      return (
        <Box key={`run-${r.id}`} flexDirection="row" gap="sm">
          <Ico name={r.state} color={colorOf(r.state)} spin={isRunning} tip={tip} />
          <Box flexDirection="column" flexShrink={1}>
            <Button
              key={`view-${r.id}`}
              plain
              onPress={() => (isRunning ? toggle(detailKey, false) : void $.ui.view({ agentId: r.id }))}
            >
              <Text bold={isRunning} color={themeOf(r.state)}>
                {r.name}
              </Text>
              <Text dimColor size="caption">{`  ${when}`}</Text>
            </Button>
            {isDetail && (
              <Box flexDirection="column">
                {r.description !== '' && (
                  <Text size="caption" wrap="truncate-end">
                    {r.description}
                  </Text>
                )}
                {r.out !== '' && (
                  <Text dimColor size="caption" wrap="truncate-end">
                    {r.out}
                  </Text>
                )}
                <Button key={`talk-${r.id}`} plain dimColor onPress={() => void $.ui.view({ agentId: r.id })}>
                  <Text size="caption">やりとり</Text>
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      )
    }

    const pmNames = new Set(c.pms.map(p => p.name))
    const pmBlocks = [
      ...c.pms.map(p => ({ name: p.name, doing: p.doing, kakari: c.kakari.filter(k => k.pm === p.name) })),
      ...(c.kakari.some(k => !pmNames.has(k.pm))
        ? [{ name: ALL, doing: '', kakari: c.kakari.filter(k => !pmNames.has(k.pm)) }]
        : []),
    ]

    // 現場のセッション：四角い画面のアイコンで、係（回る印・立場のアイコン）と見分ける
    const ss = (await read($, sessions)) ?? { sessions: null, note: '', irai: [] }
    const live = [...(ss.sessions ?? [])].sort((a, b) => Number(b.isRunning) - Number(a.isRunning))
    const nLive = live.filter(s => s.isRunning).length
    const sessionTip = (s: Session) => (s.isRunning ? '動いている' : '止まっている（返事待ちかも）')

    // 組織図のツリー：秘書（→ PM → 係）と、横に並ぶ外の現場（現場は秘書の下の係ではない）。「本人」の行は出さない
    // 枝の線は、その先に動いているものがある所だけ橙
    const pmBusy = pmBlocks.map(p => p.kakari.some(k => busy.has(k.name)))
    const top = [running.length > 0, nLive > 0]
    const tree: unknown[] = [
      <Line key="t-hisho" segs={[nodeSeg(top, 0)]}>
        <Ico name="秘書" color={running.length > 0 ? ACCENT : GRAY} spin={running.length > 0} tip={running.length > 0 ? '係が動いている' : undefined} />
        <Text bold>秘書</Text>
      </Line>,
    ]
    pmBlocks.forEach((p, i) => {
      const kBusy = p.kakari.map(k => busy.has(k.name))
      const nBusy = kBusy.filter(Boolean).length
      const key = `pm:${p.name}`
      const isOn = isOpen(key, nBusy > 0)
      const note = nBusy > 0 ? `${nBusy}` : isOn || p.kakari.length === 0 ? '' : `${p.kakari.length}`
      const above = [passSeg(top, 0), passSeg(pmBusy, i)]
      tree.push(
        <Line key={`t-${key}`} segs={[passSeg(top, 0), nodeSeg(pmBusy, i)]}>
          <Fold k={key} isOn={isOn} byDefault={nBusy > 0} label={p.name} note={note} icon={pmIcon(p.name)} busy={nBusy > 0} />
        </Line>,
      )
      if (!isOn) return
      if (p.doing !== '') {
        tree.push(
          <Line
            key={`t-${key}-doing`}
            segs={[...above, p.kakari.length > 0 ? { kind: 'pass', hot: nBusy > 0 } : { kind: 'blank' }]}
          >
            <Text dimColor size="caption" wrap="truncate-end">{`動：${p.doing}`}</Text>
          </Line>,
        )
      }
      if (p.kakari.length === 0) {
        tree.push(
          <Line key={`t-${key}-none`} segs={[...above, nodeSeg([false], 0)]}>
            <Text dimColor size="caption">
              係はまだいない
            </Text>
          </Line>,
        )
      }
      p.kakari.forEach((k, j) => {
        const isBusy = kBusy[j] === true
        const r = running.find(x => x.name === k.name)
        tree.push(
          <Line key={`t-k-${k.name}`} segs={[...above, nodeSeg(kBusy, j)]}>
            <Ico name={k.role} color={isBusy ? ACCENT : GRAY} spin={isBusy} tip={ROLE_JA[k.role] ?? k.role} />
            {r ? (
              <Button key={`view-${r.id}`} plain onPress={() => toggle(`d:${r.id}`, false)}>
                <Text bold color="claude">
                  {k.name}
                </Text>
                <Text dimColor size="caption">{`  ${lengthOf(t - r.startedAt)}`}</Text>
              </Button>
            ) : (
              <Text wrap="truncate-end">{k.name}</Text>
            )}
          </Line>,
        )
        if (r && isOpen(`d:${r.id}`, false)) {
          const sub = [...above, passSeg(kBusy, j), { kind: 'blank' } as Seg]
          for (const [n, line] of [r.description, r.out].filter(Boolean).entries()) {
            tree.push(
              <Line key={`t-kd-${r.id}-${n}`} segs={sub}>
                <Text dimColor={n > 0} size="caption" wrap="truncate-end">
                  {line}
                </Text>
              </Line>,
            )
          }
          tree.push(
            <Line key={`t-kv-${r.id}`} segs={sub}>
              <Button key={`talk-${r.id}`} plain dimColor onPress={() => void $.ui.view({ agentId: r.id })}>
                <Text size="caption">やりとり</Text>
              </Button>
            </Line>,
          )
        }
      })
    })

    // 外の現場の枝：いまのセッションを先に、台帳の現場（セッションの無いもの）をあとに。動いているセッションがあれば開く
    const taken = new Set(live.flatMap(s => [s.folder, ...(ss.irai.find(i => i.names.includes(s.folder))?.names ?? [])]))
    const restGenba = c.genba.filter(g => !taken.has(g.name))
    const genbaOn = isOpen('genba', nLive > 0)
    tree.push(
      <Line key="t-genba" segs={[nodeSeg(top, 1)]}>
        <Fold
          k="genba"
          isOn={genbaOn}
          byDefault={nLive > 0}
          label="外の現場"
          note={nLive > 0 ? `${nLive}` : genbaOn ? '' : `${live.length + restGenba.length}`}
          icon="現場"
          busy={nLive > 0}
        />
      </Line>,
    )
    if (genbaOn) {
      const kids = [
        ...live.map(s => ({ key: `t-gs-${s.id}`, s, g: undefined as Genba | undefined })),
        ...restGenba.map(g => ({ key: `t-gg-${g.name}`, s: undefined as Session | undefined, g })),
      ]
      const kidBusy = kids.map(k => k.s?.isRunning === true)
      kids.forEach((k, j) => {
        const segs = [passSeg(top, 1), nodeSeg(kidBusy, j)]
        if (k.s) {
          const s = k.s
          tree.push(
            <Line key={k.key} segs={segs}>
              <Ico name={s.isRunning ? 'セッション' : '止まっている'} color={s.isRunning ? ACCENT : GRAY} spin={s.isRunning} tip={sessionTip(s)} />
              <Button key={`sd-${s.id}`} plain onPress={() => toggle(`d:s-${s.id}`, false)}>
                <Text bold={s.isRunning} color={s.isRunning ? 'claude' : undefined}>
                  {s.folder}
                </Text>
                <Text dimColor size="caption">{s.isRunning ? '' : `  ${lengthOf(t - s.lastActivityAt)}`}</Text>
              </Button>
            </Line>,
          )
          if (isOpen(`d:s-${s.id}`, false)) {
            tree.push(
              <Line key={`${k.key}-d`} segs={[passSeg(top, 1), passSeg(kidBusy, j), { kind: 'blank' } as Seg]}>
                <Text dimColor size="caption" wrap="truncate-end">
                  {s.title}
                </Text>
              </Line>,
            )
          }
        } else if (k.g) {
          tree.push(
            <Line key={k.key} segs={segs}>
              <Ico name="現場" tip={k.g.bumon} />
              <Text dimColor size="caption" wrap="truncate-end">
                {k.g.name}
              </Text>
            </Line>,
          )
        }
      })
    }

    const recentOn = isOpen('recent', true)
    // 上の欄に出すのは、木に出ない物だけ（本人の決定「おすすめで」＝案B：動いている所は木の回る印で見る）
    const rosterNames = new Set(c.kakari.map(k => k.name))
    const loose = running.filter(r => !rosterNames.has(r.name))
    const genbaNames = new Set(c.genba.map(g => g.name))
    const looseIrai = ss.irai.filter(i => !i.names.some(n => genbaNames.has(n)))


    // あなた待ち：件数だけ出し、押すと1件1行。1件を押すと「どこ・なぜ・やること」と、打つコマンド（写すボタン）
    const stoppedSessions: Matsu[] = live
      .filter(s => !s.isRunning && t - s.lastActivityAt < MATSU_SESSION_MS)
      .map(s => ({ id: `s-${s.id}`, where: s.folder, kind: '現場', text: s.title, commands: [], from: 'session' }))
    const waits = [...((await read($, matsu)) ?? []), ...stoppedSessions]
    const matsuOn = isOpen('matsu', false)
    const WHY: Record<Matsu['kind'], string> = { 返事: '返事待ち', 手: '手待ち', 現場: '止まっている（返事待ちかも）' }
    // 返事待ちの物には「おすすめで」のボタンを1つ（案2。秘書の代理承認 2026-10-26）。押すと秘書の会話にその件の答えを送る（記録のボタンと同じ送り方）
    const answer = (m: Matsu) => $.prompt.submit({ text: `${m.where}の件（${m.text.slice(0, 24)}${m.text.length > 24 ? '…' : ''}）：おすすめで`, asUser: true })
    const MatsuRow = ({ m }: { m: Matsu }) => {
      const isOn = isOpen(`d:m-${m.id}`, false)
      return (
        <Box key={`matsu-${m.id}`} flexDirection="column">
          <Button key={`m-${m.id}`} plain onPress={() => toggle(`d:m-${m.id}`, false)}>
            <Text bold>{m.where}</Text>
            <Text dimColor size="caption">{`  ${m.kind === '現場' ? '止まっている' : WHY[m.kind]}`}</Text>
          </Button>
          {isOn && (
            <Box flexDirection="column" paddingLeft={2}>
              <Text dimColor size="caption">{`なぜ：${WHY[m.kind]}`}</Text>
              <Text size="caption">{`やること：${m.kind === '現場' ? `${m.where} のセッションを見る（${m.text}）` : m.text}`}</Text>
              {m.kind === '返事' && (
                <Button key={`ans-${m.id}`} plain onPress={() => void answer(m)}>
                  <Text size="caption" color="claude">
                    おすすめで
                  </Text>
                </Button>
              )}
              {m.commands.map((cmd, j) => (
                <Box key={`cmd-${m.id}-${j}`} flexDirection="row" gap="sm" alignItems="center">
                  <Text mono size="caption" wrap="truncate-end">
                    {cmd}
                  </Text>
                  <Button key={`copy-${m.id}-${j}`} plain dimColor onPress={press => void $.ui.copy({ text: cmd, surface: press.surface })}>
                    <Text size="caption">写す</Text>
                  </Button>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    // 使用量：いちばん上に1行。8割をこえた枠だけ色で知らせる。くわしくは開いたときだけ
    const us = await read($, usage)
    const levelOf = (pct: number) => (pct >= DANGER_PCT ? ('error' as const) : pct >= WARN_PCT ? ('warning' as const) : undefined)
    const worst = Math.max(us?.five?.pct ?? 0, us?.week?.pct ?? 0, ...(us?.models ?? []).map(m => m.pct))
    const resetOf = (w: Window, withDay: boolean) => {
      if (w.resetsAt === null) return ''
      const d = new Date(w.resetsAt + JST)
      const hm = hmOf(w.resetsAt)
      return withDay ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}` : hm
    }
    const WinText = ({ w, withDay }: { w: Window; withDay: boolean }) => (
      <Text size="caption" color={levelOf(w.pct)} bold={levelOf(w.pct) !== undefined} dimColor={levelOf(w.pct) === undefined}>
        {`${w.label} ${w.pct}%${resetOf(w, withDay) ? ` ·${resetOf(w, withDay)}` : ''}`}
      </Text>
    )
    // 使用量のバー。デスクトップは SVG、ターミナルは文字のマス
    const Bar = ({ w }: { w: Window | null }) => {
      const pct = w?.pct ?? 0
      const level = levelOf(pct)
      return isTerminal || !Svg ? (
        <Text size="caption" mono color={level} dimColor={level === undefined}>
          {barText(pct)}
        </Text>
      ) : (
        <Svg
          source={barSvg(pct, level === 'error' ? RED : level === 'warning' ? YELLOW : GRAY)}
          alt={w ? `${w.label} ${pct}%` : '—'}
          width={BAR_PX}
          height={6}
        />
      )
    }
    // 記録：済は薄く、目安超えは橙
    const kk = await read($, kiroku)
    const nowMs = await $.clock.now()
    const clk = clockOf(nowMs)
    // 毎日のもの（間隔の表に無いもの）はいつも出す。間隔の表のものは「ほか」。毎日のものが無ければ全部いつも出す
    const daily = (kk?.items ?? []).filter(i => !i.every)
    const fixed = daily.length > 0 ? daily : (kk?.items ?? [])
    const hoka = daily.length > 0 ? (kk?.items ?? []).filter(i => i.every) : []
    const hokaLate = hoka.some(i => i.isLate)
    const hokaOn = isOpen('hoka', false)
    const nextSoon = kk?.soon.find(x => x.at > nowMs)
    const soonNear = nextSoon !== undefined && nextSoon.at - nowMs <= SOON_MIN * 60_000
    const leftOf = (at: number) => {
      const mins = Math.ceil((at - nowMs) / 60_000)
      return mins < 24 * 60 ? `${Math.floor(mins / 60)}:${pad(mins % 60)}` : `${Math.floor(mins / 1440)}日${Math.floor((mins % 1440) / 60)}時間`
    }
    // まだのものだけ押せる（済を押して二重に送らない。時刻をずらすときは今までどおり打つ）。
    // 先に見た目を済にする：フックが書いたあとの読み直しを待たない
    const recordNow = async (name: string) => {
      await update($, kiroku, cur =>
        cur && { ...cur, items: cur.items.map(i => (i.name === name ? { ...i, at: clk.hm, skipped: false, isLate: false } : i)) },
      )
      await $.prompt.submit({ text: name, asUser: true })
    }
    const KirokuButton = ({ item }: { item: Item }) => {
      const isDone = item.at !== null
      const note = !isDone ? '' : item.skipped ? ` ${SKIP}` : ` ${item.at}`
      const tip = isDone ? (item.skipped ? `${SKIP}（${item.at}）` : `済 ${item.at}`) : item.isLate ? '目安超え' : 'まだ'
      return (
        <Box key={`k-${item.name}`} flexDirection="row" alignItems="center" gap="xs">
          <Ico name={item.name} color={item.isLate ? ACCENT : GRAY} tip={tip} />
          {isDone ? (
            <Box flexDirection="row" alignItems="center">
              <Text dimColor>{item.name}</Text>
              <Text dimColor size="caption">
                {note}
              </Text>
            </Box>
          ) : (
            <Button key={`kiroku-${item.name}`} plain onPress={() => recordNow(item.name)}>
              <Text bold={item.isLate} color={item.isLate ? 'claude' : undefined}>
                {item.name}
              </Text>
            </Button>
          )}
        </Box>
      )
    }

    const usageOn = isOpen('usage', false)
    const finishedTokens = recent.filter(r => r.tokens !== undefined)
    const pet = await PetSection($, e)

    return (
      <Box flexDirection="column" gap="md" paddingX={1}>
        {/* いちばん上：ペット（マスコットとミニゲーム） */}
        {pet}
        {/* あなた待ち：件数だけ。押すと開く */}
        {waits.length > 0 && (
          <Box flexDirection="column" gap="xs">
            <Fold k="matsu" isOn={matsuOn} byDefault={false} label="あなた待ち" note={`${waits.length}`} busy />
            {matsuOn && (
              <Box flexDirection="column" gap="xs" paddingLeft={3}>
                {waits.map(m => (
                  <MatsuRow m={m} />
                ))}
              </Box>
            )}
          </Box>
        )}
        {/* 使用量の1行。押すとくわしく */}
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" alignItems="center" gap="xs" flexWrap="wrap">
            <Ico name={usageOn ? '開' : '閉'} />
            <Ico name="使用量" color={worst >= DANGER_PCT ? RED : worst >= WARN_PCT ? YELLOW : GRAY} tip="使用量（· のあとは戻る時刻）" />
            <Button key="fold-usage" plain onPress={() => toggle('usage', false)}>
              {e.surface !== 'terminal' ? '' : usageOn ? '▾ ' : '▸ '}
              <Text size="caption" dimColor>
                5h
              </Text>
            </Button>
            <Bar w={us?.five ?? null} />
            <Text size="caption" color={levelOf(us?.five?.pct ?? 0)} dimColor={levelOf(us?.five?.pct ?? 0) === undefined}>
              {us?.five ? `${us.five.pct}%${us.five.resetsAt !== null ? ` ·${hmOf(us.five.resetsAt)}` : ''}` : '—'}
            </Text>
            <Text size="caption" dimColor>
              {' 週'}
            </Text>
            <Bar w={us?.week ?? null} />
            <Text size="caption" color={levelOf(us?.week?.pct ?? 0)} dimColor={levelOf(us?.week?.pct ?? 0) === undefined}>
              {us?.week ? `${us.week.pct}%` : '—'}
            </Text>
          </Box>
          {usageOn && (
            <Box flexDirection="column" gap="xs" paddingLeft={3}>
              {us === null ? (
                <Text dimColor size="caption">
                  —
                </Text>
              ) : (
                <Box flexDirection="column" gap="xs">
                  {us.five && <WinText w={us.five} withDay={false} />}
                  {us.week && <WinText w={us.week} withDay />}
                  {us.models.map(m => (
                    <WinText key={`w-${m.label}`} w={m} withDay />
                  ))}
                  <Text dimColor size="caption">
                    {us.ctx
                      ? `秘書 ${tokensOf(us.ctx.tokens)} (${us.ctx.percent}%)${us.usd !== null ? ` · $${us.usd.toFixed(2)}` : ''}`
                      : '秘書 —'}
                  </Text>
                  {live
                    .filter(x => x.isRunning)
                    .map(x => (
                      <Text key={`uc-${x.id}`} dimColor size="caption">
                        {x.ctx ? `${x.folder} ${tokensOf(x.ctx.tokens)} (${x.ctx.percent}%)` : `${x.folder} —`}
                      </Text>
                    ))}
                  {finishedTokens.map(r => (
                    <Text key={`ut-${r.id}`} dimColor size="caption">{`${r.name} ${tokensOf(r.tokens ?? 0)}`}</Text>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* 上：いま動いている係（回る印）と、現場のセッション（四角い画面の印）。見出しは置かない */}
        {(loose.length > 0 || looseIrai.length > 0) && (
          <Box flexDirection="column" gap="xs">
            {loose.map(r => (
              <RunRow r={r} />
            ))}
            {ss.sessions === null
              ? looseIrai.map(i => (
                  <Box key={`irai-${i.names.join('-')}`} flexDirection="row" gap="sm">
                    <Ico name="セッション" tip={`状態はわからない：${ss.note || 'セッション一覧がまだ取れていない'}`} />
                    <Box flexDirection="column" flexShrink={1}>
                      <Button key={`id-${i.names.join('-')}`} plain onPress={() => toggle(`d:i-${i.names.join('-')}`, false)}>
                        <Text>{i.names[0] ?? ''}</Text>
                        <Text dimColor size="caption">
                          {'  ?'}
                        </Text>
                      </Button>
                      {isOpen(`d:i-${i.names.join('-')}`, false) && (
                        <Text dimColor size="caption" wrap="truncate-end">
                          {i.what}
                        </Text>
                      )}
                    </Box>
                  </Box>
                ))
              : null}
          </Box>
        )}

        {recent.length > 0 && (
          <Box flexDirection="column" gap="xs">
            <Fold k="recent" isOn={recentOn} byDefault label="最近" note={`${recent.length}`} />
            {recentOn && (
              <Box flexDirection="column" gap="xs" paddingLeft={3}>
                {recent.slice(0, RECENT_SHOW).map(r => (
                  <RunRow r={r} />
                ))}
              </Box>
            )}
          </Box>
        )}

        {/* まんなか：組織図（罫線でつないだツリー。行のあいだは空けない＝線がつながる） */}
        <Box flexDirection="column">{tree as never}</Box>

        {/* 下：記録。押すと合図（「朝」など）を送り、記録のフックがいまの時刻で書く */}
        {kk !== null && (
          <Box flexDirection="column" gap="xs">
            <Box flexDirection="row" alignItems="center" gap="xs" flexWrap="wrap">
              <Ico name="時計" />
              <Text dimColor size="caption">
                {`${clk.date.slice(5).replace('-', '/')}（${clk.youbi}） ${clk.hm}`}
              </Text>
              {nextSoon !== undefined && (
                <Text size="caption" bold={soonNear} color={soonNear ? 'claude' : undefined} dimColor={!soonNear} wrap="truncate-end">
                  {`  ${nextSoon.what} あと ${leftOf(nextSoon.at)} · ${nextSoon.label}`}
                </Text>
              )}
            </Box>
            <Box flexDirection="row" alignItems="center" gap="sm" flexWrap="wrap">
              {fixed.map(item => (
                <KirokuButton item={item} />
              ))}
              {hoka.length > 0 && (
                <Box flexDirection="row" alignItems="center" gap="xs">
                  <Ico name={hokaOn ? '開' : '閉'} color={hokaLate ? ACCENT : GRAY} />
                  <Button key="fold-hoka" plain onPress={() => toggle('hoka', false)}>
                    <Text color={hokaLate ? 'claude' : undefined} dimColor={!hokaLate}>
                      {isTerminal ? (hokaOn ? 'ほか ▾' : 'ほか ▸') : 'ほか'}
                    </Text>
                  </Button>
                </Box>
              )}
            </Box>
            {hokaOn && hoka.length > 0 && (
              <Box flexDirection="row" alignItems="center" gap="sm" flexWrap="wrap">
                {hoka.map(item => (
                  <KirokuButton item={item} />
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}

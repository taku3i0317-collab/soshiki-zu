import type { EngineInterface as Engine } from 'claude-code'

import type { Item, Soon, Today } from '../types'

// 組織図の下の「記録」。読み方は kiroku-botan と同じ（status/生活.md と journal/記録/）。
// 書くのは記録のフック（.claude/scripts/life-log.ps1）：この MOD は合図（「朝」など）を送るだけ。
// パスは作業フォルダからの相対：status/生活.md が無いフォルダでは記録は出さない
const SEIKATSU = 'status/生活.md'
const KIROKU_DIR = 'journal/記録'
// 締め切り：`status/締め切り.md` の「予定」表と、`status/学業.md` の「個別」表。あるほうを読む（両方あれば両方）
const SHIMEKIRI = 'status/締め切り.md'
const GAKUGYO = 'status/学業.md'
// 記録のフック。ここに書いてある合図の一覧（`$items = @('…', …)`）がボタンになる（フックが受け取る合図と同じ物だけ出す）
const HOOK = '.claude/scripts/life-log.ps1'
// 「しなかった」の合図はメモ「なし」
export const SKIP = 'なし'
const JST = 9 * 60 * 60 * 1000

type Clock = { date: string; month: string; prevMonth: string; hm: string; youbi: string; day: number }

const pad = (n: number) => String(n).padStart(2, '0')

export function clockOf(ms: number): Clock {
  const d = new Date(ms + JST)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return {
    date: `${y}-${pad(m)}-${pad(d.getUTCDate())}`,
    month: `${y}-${pad(m)}`,
    prevMonth: m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`,
    hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    youbi: '日月火水木金土'.charAt(d.getUTCDay()),
    day: d.getUTCDate(),
  }
}

/** 「## 見出し」の下の表を、見出しの名前で引く（列の順が変わっても読める。無ければ fallback 番目） */
function tableBy(md: string, heading: string): { rows: string[][]; col: (name: string, fallback: number) => number } {
  const all: string[][] = []
  let inside = false
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      inside = line.startsWith(`## ${heading}`)
      continue
    }
    if (!inside || !line.startsWith('|') || /^\|\s*-/.test(line)) continue
    all.push(line.split('|').slice(1, -1).map(c => c.trim()))
  }
  const head = all[0] ?? []
  return {
    rows: all.slice(1),
    col: (name, fallback) => {
      const i = head.findIndex(h => h.includes(name))
      return i >= 0 ? i : fallback
    },
  }
}

// 「17:20 に家を出る（学校まで40分）」から、時刻と短い名前を取る
function timedOf(text: string): { hm: string; what: string } | null {
  const m = /(\d{1,2})[:：](\d{2})\s*に\s*([^（(、。]+)/.exec(text)
  if (!m) return null
  return { hm: `${pad(Number(m[1]))}:${m[2]}`, what: (m[3] ?? '').trim() }
}

// 日本時間の「日付＋時刻」を、時計の値（UTC のミリ秒）にする
const msOf = (date: string, hm: string) => Date.parse(`${date}T${hm}:00Z`) - JST

// 曜の書き方：`毎日`・`火・金`・`第1水`
function dayMatches(days: string, c: Clock): boolean {
  if (days === '毎日') return true
  return days.split('・').some(d => {
    const nth = /^第(\d)(.)$/.exec(d)
    if (nth) return nth[2] === c.youbi && Math.ceil(c.day / 7) === Number(nth[1])
    return d === c.youbi
  })
}

async function readOr($: Engine, path: string): Promise<string> {
  try {
    return (await $.fs.read(path)) as string
  } catch {
    return ''
  }
}

/** フックの `$items = @('朝', '昼')` から合図の名前を取る。無ければ空 */
function hookItems(ps1: string): string[] {
  const m = /\$items\s*=\s*@\(([^)]*)\)/.exec(ps1)
  return m ? [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map(x => x[1] ?? '').filter(Boolean) : []
}

export async function loadKiroku($: Engine): Promise<Today | null> {
  const md = await readOr($, SEIKATSU)
  if (!md) return null
  const c = clockOf(await $.clock.now())

  const intervals = new Map<string, number>()
  for (const [name = '', days = ''] of tableBy(md, '間隔').rows) {
    const n = Number(days)
    if (name && Number.isFinite(n)) intervals.set(name, n)
  }
  const lateFrom = new Map<string, string>()
  // 表の列は「| 項目 | から | まで | 曜 | … |」（kiroku-botan と同じ位置で読む）
  for (const [name = '', from = '', , days = ''] of tableBy(md, '声かけ').rows) {
    if (name && /^\d{2}:\d{2}$/.test(from) && dayMatches(days, c)) lateFrom.set(name, from)
  }

  const log = (await readOr($, `${KIROKU_DIR}/${c.prevMonth}.md`)) + '\n' + (await readOr($, `${KIROKU_DIR}/${c.month}.md`))
  const lastAtToday = new Map<string, { hm: string; skipped: boolean }>()
  const lastDate = new Map<string, string>()
  for (const line of log.split(/\r?\n/)) {
    const m = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) (\S+)(?: (\S+))?/.exec(line)
    const [, date = '', hm = '', name = '', note = ''] = m ?? []
    if (!m || name.startsWith('通知:')) continue
    const skipped = note === SKIP
    // あとの行が勝つ
    if (date === c.date) lastAtToday.set(name, { hm, skipped })
    // 間隔（何日ごと）は、やった日だけで数える
    if (skipped) continue
    const before = lastDate.get(name)
    if (before === undefined || before < date) lastDate.set(name, date)
  }
  const daysSince = (date: string) => Math.round((Date.parse(c.date) - Date.parse(date)) / (24 * 60 * 60 * 1000))

  // ボタンの項目：status/生活.md に「## ボタン」の表（| 項目 | まとまり | なしの言い方 |）があればその順。
  // 無ければフックの合図の一覧。どちらのあとにも「間隔」の表の項目を足す（間隔の項目は「ほか」に入る）
  const buttons = tableBy(md, 'ボタン')
  const [bName, bGroup, bSkip] = [buttons.col('項目', 0), buttons.col('まとまり', 1), buttons.col('なし', 2)]
  const listed = buttons.rows.map(r => ({ name: r[bName] ?? '', group: r[bGroup] ?? '', skip: r[bSkip] ?? '' })).filter(b => b.name)
  const base = listed.length > 0 ? listed.map(b => b.name) : hookItems(await readOr($, HOOK))
  const names = [...new Set([...base, ...intervals.keys()])]
  const items: Item[] = names.map(name => {
    const done = lastAtToday.get(name)
    const at = done?.hm ?? null
    let isLate = false
    if (at === null) {
      const from = lateFrom.get(name)
      const every = intervals.get(name)
      const last = lastDate.get(name)
      if (from) isLate = c.hm >= from
      else if (every !== undefined) isLate = last === undefined || daysSince(last) >= every
    }
    const b = listed.find(x => x.name === name)
    return {
      name,
      at,
      skipped: done?.skipped ?? false,
      isLate,
      every: intervals.has(name),
      group: b?.group ?? '',
      skipText: b?.skip ?? '',
    }
  })

  // 次の予定：時刻の書いてある今日の定例と、7日以内で済でない締め切り（kiroku-botan と同じ）
  const soon: Soon[] = []
  const teirei = tableBy(md, '定例')
  const [cDays, cWhat, cWhen] = [teirei.col('曜', 0), teirei.col('すること', 1), teirei.col('時刻', 2)]
  for (const row of teirei.rows) {
    const [days, what, when] = [row[cDays], row[cWhat], row[cWhen]]
    if (!what || !days || !dayMatches(days, c)) continue
    for (const timed of [timedOf(what), timedOf(when ?? '')]) {
      if (timed) soon.push({ what: timed.what, at: msOf(c.date, timed.hm), label: timed.hm })
    }
  }
  // 締め切り：7日以内で済でないもの。時刻は「23:59まで」「16:50まで」から。書いてなければその日の 23:59
  const deadlineTables = [
    { table: tableBy(await readOr($, SHIMEKIRI), '予定'), what: 'やること', whatAt: 2, subjectAt: -1 },
    { table: tableBy(await readOr($, GAKUGYO), '個別'), what: '出すもの', whatAt: 2, subjectAt: 1 },
  ]
  for (const d of deadlineTables) {
    const [cDate, cSubject, cThing, cState] = [
      d.table.col('日付', 0),
      d.table.col('科目', d.subjectAt),
      d.table.col(d.what, d.whatAt),
      d.table.col('状態', 3),
    ]
    for (const row of d.table.rows) {
      const [date = '', subject = '', what = '', state = ''] = [row[cDate], row[cSubject], row[cThing], row[cState]]
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || state === '済') continue
      const days = -daysSince(date)
      if (days < 0 || days > 7) continue
      const until = /(\d{1,2})[:：](\d{2})\s*まで/.exec(what)
      const hm = until ? `${pad(Number(until[1]))}:${until[2]}` : '23:59'
      const day = new Date(Date.parse(date))
      soon.push({
        what: [subject, what.replace(/（.*$/, '').trim()].filter(Boolean).join(' '),
        at: msOf(date, hm),
        label: days === 0 ? hm : `${day.getUTCMonth() + 1}/${day.getUTCDate()} ${hm}`,
      })
    }
  }
  soon.sort((a, b) => a.at - b.at)
  return { items, soon }
}

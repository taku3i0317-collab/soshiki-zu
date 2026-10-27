import type { EngineInterface as Engine } from 'claude-code'

import type { Matsu } from '../types'

// 「あなた待ち」：本人の返事・手を待って止まっている物を集める。読むだけ。
// (a) 部門のファイル status/<部門名>.md の「本人の返事待ち：…」「本人の手待ち：…」の行と、「## 本人の返事待ち」の節の行
// (b) 台帳（### 名前）の「場所：`フォルダ`」の HANDOFF.md の、いちばん新しい「本人に聞きたいこと／本人に聞くこと／本人が打つ／本人がすること」の節
// (c) 止まっている現場のセッション（アプリが「本人の許可待ち」かまでは教えないので、止まって間もない物を「返事待ちかも」として、描くときに足す）

// 1つの節から取る数（古い HANDOFF の長い節で、ペインが埋まらないように）
const PER_SECTION = 6
const HANDOFF_HEAD = /本人に(聞きたい|聞く)こと|本人が(打つ|すること)/

async function readOr($: Engine, path: string): Promise<string> {
  try {
    return (await $.fs.read(path)) as string
  } catch {
    return ''
  }
}

const clean = (s: string) =>
  s
    .replace(/\*\*/g, '')
    .replace(/^[-*]\s+|^\d+\.\s+/, '')
    .trim()

// 文の中の `…` のうち、打つコマンドに見える物（そのままの形で写せるように、中身は変えない）
const COMMAND = /^(\/[a-z]|claude |git |gh |npm |npx |node |python|pip |winget |Copy-Item|Move-Item|New-Item|cp |mv |code |cd |pwsh|powershell)/
export function commandsOf(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map(m => m[1] ?? '').filter(c => COMMAND.test(c))
}

/** (a) 部門のファイル1つから。where は部門名、台帳の「### 名前」の下ならその名前 */
export function waitsOfStatus(md: string, dept: string): Matsu[] {
  const out: Matsu[] = []
  let where = dept
  let inSection: Matsu['kind'] | null = null
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim()
    if (raw.startsWith('## ')) {
      where = dept
      inSection = /本人の返事待ち/.test(raw) ? '返事' : /本人の手待ち/.test(raw) ? '手' : null
      continue
    }
    if (raw.startsWith('### ')) {
      where = raw.slice(4).replace(/（.*$/, '').split(/\s*—\s*/)[0]!.trim() || dept
      continue
    }
    if (inSection !== null) {
      const text = clean(line)
      if (/^[-*\d]/.test(line) && text !== '' && !/^（?なし/.test(text)) out.push({ id: '', where, kind: inSection, text, commands: commandsOf(text), from: 'status' })
      continue
    }
    for (const m of line.matchAll(/本人の(返事待ち|手待ち)\s*[:：]\s*([^。]+(?:。|$))/g)) {
      const text = clean(m[2] ?? '').replace(/\*+$/, '').replace(/。$/, '')
      if (text !== '') out.push({ id: '', where, kind: m[1] === '返事待ち' ? '返事' : '手', text, commands: commandsOf(text), from: 'status' })
    }
  }
  return out
}

/** 台帳の「### 名前」ごとの「場所：`フォルダ`」 */
export function placesOf(md: string): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = []
  let name = ''
  for (const raw of md.split(/\r?\n/)) {
    if (raw.startsWith('## ')) name = ''
    else if (raw.startsWith('### ')) name = raw.slice(4).replace(/（.*$/, '').split(/\s*—\s*/)[0]!.trim()
    else if (name !== '') {
      const m = /^-\s*場所\s*[:：]\s*`([^`]+)`/.exec(raw.trim())
      if (m && !out.some(o => o.name === name)) out.push({ name, dir: (m[1] ?? '').replace(/[\\/]+$/, '') })
    }
  }
  return out
}

/** (b) HANDOFF.md のいちばん新しい「本人に聞きたいこと／本人が打つ…」の節から */
export function waitsOfHandoff(md: string, where: string): Matsu[] {
  const lines = md.split(/\r?\n/)
  // いちばん下（新しい）の該当する見出し
  let at = -1
  for (let i = 0; i < lines.length; i++) if (/^#{2,4}\s/.test(lines[i]!) && HANDOFF_HEAD.test(lines[i]!) && !/済/.test(lines[i]!)) at = i
  if (at < 0) return []
  const level = /^(#+)/.exec(lines[at]!)?.[1]?.length ?? 2
  const kind: Matsu['kind'] = /打つ|すること/.test(lines[at]!) ? '手' : '返事'
  const out: Matsu[] = []
  let fence: string[] | null = null
  for (const raw of lines.slice(at + 1)) {
    const head = /^(#+)\s/.exec(raw)
    if (head && (head[1]?.length ?? 0) <= level) break
    if (/^\s*```/.test(raw)) {
      // コードの囲み：中の1行ずつを、直前の項目のコマンドに足す（項目が無ければ1項目にする）
      if (fence === null) fence = []
      else {
        const cmds = fence.filter(l => l.trim() !== '')
        const last = out[out.length - 1]
        if (last) last.commands.push(...cmds)
        else if (cmds.length > 0) out.push({ id: '', where, kind: '手', text: '打つ', commands: cmds, from: 'handoff' })
        fence = null
      }
      continue
    }
    if (fence !== null) {
      fence.push(raw.trim())
      continue
    }
    // いちばん外の箇条だけ（字下げした補足は入れない）
    if (/^(-|\*|\d+\.)\s/.test(raw)) {
      const text = clean(raw)
      if (text !== '' && !/^（?なし/.test(text)) out.push({ id: '', where, kind, text, commands: commandsOf(text), from: 'handoff' })
    }
  }
  return out.slice(0, PER_SECTION)
}

/** (a)(b) を集める。同じ文は1つにまとめ、id を振る */
export async function loadMatsu($: Engine, depts: { name: string; md: string }[]): Promise<Matsu[]> {
  const all: Matsu[] = []
  for (const { name, md } of depts) {
    if (md === '') continue
    all.push(...waitsOfStatus(md, name))
    for (const pl of placesOf(md)) {
      const h = await readOr($, `${pl.dir}/HANDOFF.md`)
      if (h !== '') all.push(...waitsOfHandoff(h, pl.name))
    }
  }
  const seen = new Set<string>()
  return all
    .filter(m => {
      const k = `${m.where}|${m.text}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((m, i) => ({ ...m, id: `m${i}` }))
}

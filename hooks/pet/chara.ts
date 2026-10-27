// ペットのキャラの定義はこのファイルだけ。差しかえは userConfig の charaFile（同じ形の JSON）でもできる
//
// 絵は 16×12 ドットの文字の並び。'.' は透明、ほかの1文字は palette の色。
// eye に書いた文字は目：寝る・転ぶのときに閉じた目・×の目に描きかえる。
// poses を書けば、その状態の絵だけ自分の絵に置きかわる（書かなければ stand から作る）。
// ミニゲームの小さい絵（8×6）は stand を縮めて作る。game を書けば置きかわる。

export type Grid = readonly string[]

export type Chara = {
  name: string
  palette: Readonly<Record<string, string>>
  eye: string
  stand: Grid
  poses?: Partial<Record<'work' | 'sleep' | 'happy' | 'fall', Grid>>
  game?: { run: readonly Grid[]; jump: Grid }
}

export const W = 16
export const H = 12

// 既定のキャラ：「もち」（自作のドット絵。pane-pet で作った案）。自分のキャラにするときは charaFile に JSON を書く
export const DEFAULT: Chara = {
  name: 'もち',
  palette: { o: '#f4efe6', l: '#8a7f73', k: '#2b2b2b', p: '#f2a0a8' },
  eye: 'k',
  stand: [
    '................',
    '.....llllll.....',
    '...llooooooll...',
    '..looooooooool..',
    '..lookooookool..',
    '.llookooookooll.',
    '.lopoooooooopol.',
    '.looooooooooool.',
    '.looooooooooool.',
    '..looooooooool..',
    '...llllllllll...',
    '................',
  ],
}

// charaFile の JSON を読む。形が違えば null（既定のキャラのまま）
export function parseChara(text: string): Chara | null {
  try {
    const c = JSON.parse(text) as Partial<Chara>
    const okGrid = (g: unknown): g is Grid =>
      Array.isArray(g) && g.length === H && g.every(r => typeof r === 'string' && r.length === W)
    if (typeof c.name !== 'string' || typeof c.eye !== 'string' || !okGrid(c.stand)) return null
    if (typeof c.palette !== 'object' || c.palette === null) return null
    const poses: Chara['poses'] = {}
    for (const k of ['work', 'sleep', 'happy', 'fall'] as const) {
      const g = c.poses?.[k]
      if (okGrid(g)) poses[k] = g
    }
    return { name: c.name, palette: c.palette, eye: c.eye, stand: c.stand, poses }
  } catch {
    return null
  }
}

// 目を閉じる：目のドットのうち、いちばん下の段だけ残し、ほかは左どなりの色にする
export function closeEyes(c: Chara, g: Grid): Grid {
  const rows = g.map(r => r.split(''))
  for (let x = 0; x < W; x++) {
    const ys = rows.map((r, y) => (r[x] === c.eye ? y : -1)).filter(y => y >= 0)
    const bottom = Math.max(...ys)
    for (const y of ys) if (y !== bottom) rows[y]![x] = rows[y]![x - 1] ?? '.'
  }
  return rows.map(r => r.join(''))
}

// ゲーム用に 2×2 を1ドットへ縮める（目があれば目、いちばん多い色、半分以上透明なら透明）
export function shrink(c: Chara, g: Grid): Grid {
  const out: string[] = []
  for (let y = 0; y < H; y += 2) {
    let row = ''
    for (let x = 0; x < W; x += 2) {
      const px = [g[y]?.[x], g[y]?.[x + 1], g[y + 1]?.[x], g[y + 1]?.[x + 1]].map(p => p ?? '.')
      if (px.includes(c.eye)) {
        row += c.eye
        continue
      }
      const solid = px.filter(p => p !== '.')
      if (solid.length < 2) {
        row += '.'
        continue
      }
      const count = new Map<string, number>()
      for (const p of solid) count.set(p, (count.get(p) ?? 0) + 1)
      row += [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    }
    out.push(row)
  }
  return out
}

// 足の段（いちばん下）の、続いているドットのかたまり（例：「.oo..oo.」→ [1,2] と [5,6]）
function legGroups(row: string): number[][] {
  const groups: number[][] = []
  for (let x = 0; x < row.length; x++) {
    if (row[x] === '.') continue
    const last = groups[groups.length - 1]
    if (last && last[last.length - 1] === x - 1) last.push(x)
    else groups.push([x])
  }
  return groups
}

// 足の段を、かたまりごとに1ドットだけ残す。0＝外側の足、1＝内側の足（はさみのように交互）
function scissor(s: Grid, phase: 0 | 1): Grid {
  const row = s[s.length - 1] ?? ''
  const groups = legGroups(row)
  const out = row.split('').map(() => '.')
  groups.forEach((g, i) => {
    const isLeft = i < groups.length / 2
    const x = (phase === 0) === isLeft ? g[0]! : g[g.length - 1]!
    out[x] = row[x]!
  })
  return [...s.slice(0, -1), out.join('')]
}

// ゲームの絵：走る2コマとジャンプ。走りは本人の決定 A（足を交互に：外の足 ⇄ 内の足。1コマ1ドット、体は動かない）
export function gameSprites(c: Chara): { run: Grid[]; jump: Grid } {
  if (c.game) return { run: [...c.game.run], jump: c.game.jump }
  const s = shrink(c, c.stand)
  return { run: [scissor(s, 0), scissor(s, 1)], jump: s }
}

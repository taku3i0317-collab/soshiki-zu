import type { Chara, Grid } from './chara'
import { H, W, closeEyes } from './chara'

export type Mood = 'work' | 'sleep' | 'happy' | 'fall'

// キャンバスは 24×16 ドット。キャラは 16×12 で、下にそろえて真ん中に置く
const CW = 24
const CH = 16
const OX = 4
const OY = 3
// 1ドットの大きさ（px）。本人の決定：キャラの横幅 48px（16ドット×3）
export const DOT = 3
export const PX_W = CW * DOT
export const PX_H = CH * DOT

const EFFECT = '#9a9a9a'
const STAR = '#f2c14e'

// 横に同じ色が続くところは1つの rect にまとめる
function rects(c: Chara, g: Grid, ox: number, oy: number): string {
  let out = ''
  g.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const p = row[x]!
      let n = 1
      while (row[x + n] === p) n++
      const fill = c.palette[p]
      if (p !== '.' && fill !== undefined) out += `<rect x="${ox + x}" y="${oy + y}" width="${n}" height="1" fill="${fill}"/>`
      x += n
    }
  })
  return out
}

const flip = (g: Grid): Grid => [...g].reverse().map(r => r.split('').reverse().join(''))

// 決まった間隔で切りかえる（discrete）。values は「;」区切り
const anim = (attr: string, values: string, dur: number, extra = '') =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}s" calcMode="discrete" repeatCount="indefinite"${extra}/>`
const move = (values: string, dur: number) =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}s" calcMode="discrete" repeatCount="indefinite"/>`

// 小さい「z」（4×4）
const zee = (x: number, y: number) =>
  `<rect x="${x}" y="${y}" width="4" height="1"/><rect x="${x + 2}" y="${y + 1}" width="1" height="1"/><rect x="${x + 1}" y="${y + 2}" width="1" height="1"/><rect x="${x}" y="${y + 3}" width="4" height="1"/>`
// 十字の星
const star = (x: number, y: number) =>
  `<rect x="${x}" y="${y - 1}" width="1" height="3"/><rect x="${x - 1}" y="${y}" width="3" height="1"/>`

export function mascotSvg(c: Chara, mood: Mood): string {
  const pose = c.poses?.[mood]
  let body = ''
  switch (mood) {
    case 'work': {
      // 上下にはずむ＋頭の上の「…」が1つずつ増える
      const g = pose ?? c.stand
      body =
        `<g>${rects(c, g, OX, OY)}${move('0 0;0 -1', 0.6)}</g>` +
        `<g fill="${EFFECT}">` +
        [0, 1, 2]
          .map(i => `<rect x="${OX + W + 1 + i * 2}" y="1" width="1" height="1" opacity="0">${anim('opacity', i === 0 ? '0;1;1;1' : i === 1 ? '0;0;1;1' : '0;0;0;1', 1.6)}</rect>`)
          .join('') +
        `</g>`
      break
    }
    case 'sleep': {
      // 目を閉じて、ゆっくり息をする。z が右上へのぼる
      const g = pose ?? closeEyes(c, c.stand)
      body =
        `<g>${rects(c, g, OX, OY)}${move('0 0;0 0;0 1;0 1', 3.2)}</g>` +
        `<g fill="${EFFECT}">${zee(OX + W - 1, OY - 2)}${move('0 0;1 -1;2 -2;3 -3', 2.4)}${anim('opacity', '1;1;1;0', 2.4)}</g>`
      break
    }
    case 'happy': {
      // ぴょんぴょん跳ねる。まわりで星がまたたく
      const g = pose ?? c.stand
      body =
        `<g>${rects(c, g, OX, OY)}${move('0 0;0 -2;0 -3;0 -2', 0.6)}</g>` +
        `<g fill="${STAR}">${star(2, 4)}${anim('opacity', '1;0', 0.4)}</g>` +
        `<g fill="${STAR}">${star(CW - 3, 6)}${anim('opacity', '0;1', 0.4)}</g>`
      break
    }
    case 'fall': {
      // ひっくり返って目を回す。上で星が回る
      const g = pose ?? flip(closeEyes(c, c.stand))
      body =
        `<g>${rects(c, g, OX, OY + 1)}</g>` +
        [0, 1, 2]
          .map(i => `<g fill="${STAR}" opacity="0">${star(OX + 4 + i * 4, OY - 1)}${anim('opacity', ['1;0;0', '0;1;0', '0;0;1'][i]!, 0.9)}</g>`)
          .join('')
      break
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PX_W}" height="${PX_H}" viewBox="0 0 ${CW} ${CH}" shape-rendering="crispEdges">` +
    body +
    `</svg>`
  )
}

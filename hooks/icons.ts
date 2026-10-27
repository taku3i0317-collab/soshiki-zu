// 線のアイコン（形は Lucide、ISC ライセンス）。24 の枠、線 2、角は丸。kiroku-botan と同じ描き方。
// 色は合図にだけ使う：ふだんは灰、動いている＝Claude の橙、失敗＝赤、一部＝黄。
export const GRAY = '#8E8E8E'
export const ACCENT = '#D97757'
export const RED = '#D9534F'
export const YELLOW = '#C9A227'

const PATHS: Record<string, string> = {
  // 人と窓口
  本人: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  秘書: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  // PM（部門）。名前は使う人が決めるので、名前の言葉で形を選ぶ（pmIcon）。合わなければフォルダ
  部門: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  仕事: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  学び: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  制作: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4"/>',
  家: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  全部門: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  // 立場（.claude/agents/ の6つ）
  researcher: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  generator: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  critic: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  judge: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  finisher: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
  circuit: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  // 外の現場・状態
  現場: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  完了: '<path d="M20 6 9 17l-5-5"/>',
  終わった: '<path d="M20 6 9 17l-5-5"/>',
  一部: '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>',
  失敗: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  中断: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  // 枝の開け閉め
  閉: '<path d="m9 18 6-6-6-6"/>',
  開: '<path d="m6 9 6 6 6-6"/>',
  // 使用量（ゲージ）
  使用量: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  // 現場のセッション（係と見分ける：四角い画面の形）
  セッション: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
  止まっている: '<circle cx="12" cy="12" r="10"/><path d="M10 15V9"/><path d="M14 15V9"/>',
  // 記録（kiroku-botan と同じ形）
  薬: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  朝: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  昼: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  夜: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  洗濯: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  ごみ: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  運動: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  時計: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  済: '<path d="M20 6 9 17l-5-5"/>',
  なし: '<path d="M5 12h14"/>',
}
/** 部門の名前から形を選ぶ（例：「学業」「勉強」→ 本、「生活」「家のこと」→ 家）。どれにも当たらなければフォルダ */
export function pmIcon(name: string): string {
  if (name === '全部門') return name
  if (/学|勉強|授業|資格/.test(name)) return '学び'
  if (/家|生活|暮らし|健康/.test(name)) return '家'
  if (/制作|創作|趣味|作品/.test(name)) return '制作'
  if (/仕事|開発|商品|事業|副業/.test(name)) return '仕事'
  return '部門'
}

// 名前の無いもの（agents/ に無い立場など）は小さな丸
const DOT = '<circle cx="12" cy="12" r="3"/>'

const wrap = (color: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

// title はマウスを乗せたときの説明（SVG の <title>。ペイン側で isInteractive にすると出る）
const titleOf = (title: string | undefined) =>
  title === undefined ? '' : `<title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`

export function icon(name: string, color: string, title?: string): string {
  return wrap(color, titleOf(title) + (PATHS[name] ?? DOT))
}

// 組織図の枝の線。1行の左に、深さの数だけ「区切り」を並べる。
// pass＝上から下へ通る線、tee＝通りながら右へ枝を出す、end＝最後の枝（角を丸める）、blank＝何も無い。
// hot は橙（その先に動いているものがある）。tee・end は、上半分・右への枝・下半分を別々に色分けする
export type Seg =
  | { kind: 'pass'; hot: boolean }
  | { kind: 'blank' }
  | { kind: 'tee' | 'end'; hotUp: boolean; hotTick: boolean; hotDown: boolean }

export const SEG_PX = 16
export const ROW_PX = 26

/** 兄弟の中の j 番目の枝。flags はそれぞれの兄弟の先に動いているものがあるか */
export function nodeSeg(flags: boolean[], j: number): Seg {
  const isLast = j === flags.length - 1
  return {
    kind: isLast ? 'end' : 'tee',
    hotUp: flags.slice(j).some(Boolean),
    hotTick: flags[j] === true,
    hotDown: flags.slice(j + 1).some(Boolean),
  }
}

/** j 番目の兄弟の子の行で、その深さに通す線（j が最後なら何も無い） */
export function passSeg(flags: boolean[], j: number): Seg {
  return j === flags.length - 1 ? { kind: 'blank' } : { kind: 'pass', hot: flags.slice(j + 1).some(Boolean) }
}

/** ターミナル用の罫線の文字 */
export function glyphOf(s: Seg): string {
  return s.kind === 'pass' ? '│  ' : s.kind === 'tee' ? '├─ ' : s.kind === 'end' ? '└─ ' : '   '
}

// 線の色：ふだんは文字より薄い灰、動いている枝は橙
const LINE = GRAY
const LINE_OPACITY = 0.45

export function branchSvg(segs: Seg[]): string {
  const x0 = 7 // 縦の線の位置（区切りの中で）
  const c = ROW_PX / 2 // 横の枝の高さ
  const r = 5 // 角の丸み
  const parts: string[] = []
  const stroke = (d: string, hot: boolean) =>
    parts.push(
      `<path d="${d}" stroke="${hot ? ACCENT : LINE}" stroke-opacity="${hot ? 1 : LINE_OPACITY}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    )
  segs.forEach((s, i) => {
    const x = i * SEG_PX + x0
    const right = (i + 1) * SEG_PX
    if (s.kind === 'pass') stroke(`M${x} 0V${ROW_PX}`, s.hot)
    else if (s.kind === 'tee') {
      stroke(`M${x} 0V${c}`, s.hotUp)
      stroke(`M${x} ${c}V${ROW_PX}`, s.hotDown)
      stroke(`M${x} ${c}H${right}`, s.hotTick)
    } else if (s.kind === 'end') {
      stroke(`M${x} 0V${c - r}Q${x} ${c} ${x + r} ${c}H${right}`, s.hotUp)
    }
  })
  // 橙を灰の上に描く（重なった所で橙が見えるように）
  parts.sort((a, b) => Number(a.includes(ACCENT)) - Number(b.includes(ACCENT)))
  const w = segs.length * SEG_PX
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${ROW_PX}" width="${w}" height="${ROW_PX}">${parts.join('')}</svg>`
}

// 動いている係：円弧が回り続ける（SMIL。1周1秒）
export function spinner(color: string, title?: string): string {
  return wrap(
    color,
    titleOf(title) +
      '<path d="M21 12a9 9 0 1 1-6.219-8.56"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></path>',
  )
}

// 使用量のバー。下地は薄い灰、使った分を色で塗る（ふだんは灰、8割で黄、95%で赤）
export const BAR_PX = 56
const BAR_H = 6

export function barSvg(pct: number, color: string): string {
  const fill = Math.round((BAR_PX * Math.min(Math.max(pct, 0), 100)) / 100)
  const r = BAR_H / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAR_PX} ${BAR_H}" width="${BAR_PX}" height="${BAR_H}">` +
    `<rect width="${BAR_PX}" height="${BAR_H}" rx="${r}" fill="${GRAY}" fill-opacity="0.25"/>` +
    (fill > 0 ? `<rect width="${Math.max(fill, BAR_H)}" height="${BAR_H}" rx="${r}" fill="${color}"/>` : '') +
    '</svg>'
  )
}

// ターミナルでは8マスの文字で描く
export function barText(pct: number): string {
  const n = Math.round((8 * Math.min(Math.max(pct, 0), 100)) / 100)
  return '█'.repeat(n) + '░'.repeat(8 - n)
}

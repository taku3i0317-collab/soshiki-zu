import type { ClientModule } from 'claude-code'

import type { GameProps } from '../../types'

// ジャンプだけのミニゲーム。ペインの中の部品（Client）で動く。
// 1ドット＝横2マス・縦1行の色の箱（本人の決定：案3）。クリックかスペースでジャンプ

type Obstacle = { x: number; w: number; h: number }
type S = {
  mode: 'ready' | 'play' | 'over'
  y: number
  vy: number
  obs: Obstacle[]
  gap: number
  speed: number
  score: number
  best: number
  /** 走った距離（ドット）。足のコマはこれで進める（速くなれば足も速く） */
  dist: number
  noticeId: number
  noticeLeft: number
}

const FIELD_H = 14
const GROUND = '#9a9a9a'
const OBSTACLE = '#5f9e6e'
const GRAVITY = 0.3
const JUMP = 2.0
const SPEED0 = 0.7
const SPEED_MAX = 1.2
const NOTICE_TICKS = 60
// 足のコマを1つ進める距離（ドット）。はじめの速さで、前と同じくらいの間隔
const STEP_DOTS = 2

const fresh = (best: number, noticeId: number): S => ({
  mode: 'ready',
  y: 0,
  vy: 0,
  obs: [],
  gap: 12,
  speed: SPEED0,
  score: 0,
  best,
  dist: 0,
  noticeId,
  noticeLeft: 0,
})

// 最新の props（タイマーの中から係の知らせを読むため）
let latest: GameProps | undefined

const Game: ClientModule<GameProps, S> = (props, surface) => {
  latest = props
  const { Box, Text, Button } = surface.elements
  const run = props.sprites.run
  const sw = run[0]?.[0]?.length ?? 8
  const sh = run[0]?.length ?? 6
  const fieldW = Math.max(sw + 10, Math.floor((surface.columns || 44) / 2))
  const cur = () => surface.state ?? fresh(props.best, props.noticeId)

  const jump = () => {
    const s = cur()
    if (s.mode === 'ready') surface.setState({ ...s, mode: 'play', vy: JUMP })
    else if (s.mode === 'over') surface.setState({ ...fresh(s.best, s.noticeId), mode: 'play' })
    else if (s.y === 0) surface.setState({ ...s, vy: JUMP })
  }

  if (surface.state === undefined) {
    surface.every(props.tickMs, () => {
      let s = cur()
      // 係の知らせが新しく来たら、しばらく上に出す
      const p = latest ?? props
      if (p.noticeId !== s.noticeId) s = { ...s, noticeId: p.noticeId, noticeLeft: p.notice ? NOTICE_TICKS + 1 : 0 }
      const noticeLeft = Math.max(0, s.noticeLeft - 1)
      if (s.mode !== 'play') {
        if (s !== cur() || noticeLeft !== s.noticeLeft) surface.setState({ ...s, noticeLeft })
        return
      }
      // 動かす
      let vy = s.vy - GRAVITY
      let y = s.y + s.vy
      if (y <= 0) {
        y = 0
        vy = 0
      }
      const speed = Math.min(SPEED_MAX, SPEED0 + s.score / 2000)
      let obs = s.obs.map(o => ({ ...o, x: o.x - speed })).filter(o => o.x + o.w > 0)
      let gap = s.gap - speed
      if (gap <= 0) {
        const w = 1 + Math.floor(Math.random() * 2)
        const h = 2 + Math.floor(Math.random() * 2)
        obs = [...obs, { x: fieldW, w, h }]
        gap = w + 14 + Math.floor(Math.random() * 12)
      }
      // ぶつかったか（絵の左右1ドットずつは見のがす）
      const px0 = 2 + 1
      const px1 = 2 + sw - 1
      const hit = obs.some(o => o.x < px1 && o.x + o.w > px0 && y < o.h)
      const score = s.score + 1
      if (hit) {
        const best = Math.max(s.best, score)
        if (best > s.best) surface.post({ kind: 'best', best })
        surface.setState({ ...s, mode: 'over', y, vy, obs, gap, best, score, noticeLeft })
        return
      }
      surface.setState({ ...s, y, vy, obs, gap, speed, score, dist: s.dist + speed, noticeLeft })
    })
    surface.onPointer(ev => {
      if (ev.type === 'down') jump()
    })
    surface.onKey(ev => {
      if (ev.key === ' ' || ev.key === 'space' || ev.key === 'up' || ev.key === 'return' || ev.key === 'w') jump()
    })
    surface.setState(fresh(props.best, props.noticeId))
  }

  const s = cur()

  // 画面を色の表にする（下から数えた y を上からの行に直す）
  const grid: (string | undefined)[][] = Array.from({ length: FIELD_H }, () => Array<string | undefined>(fieldW).fill(undefined))
  const groundRow = FIELD_H - 1
  for (let x = 0; x < fieldW; x++) grid[groundRow]![x] = GROUND
  for (const o of s.obs) {
    for (let dx = 0; dx < o.w; dx++) {
      const x = Math.round(o.x) + dx
      if (x < 0 || x >= fieldW) continue
      for (let dy = 0; dy < o.h; dy++) grid[groundRow - 1 - dy]![x] = OBSTACLE
    }
  }
  const sprite = s.y > 0 || s.mode !== 'play' ? props.sprites.jump : run[Math.floor(s.dist / STEP_DOTS) % run.length]!
  const top = groundRow - sh - Math.round(s.y)
  sprite.forEach((row, sy) => {
    for (let sx = 0; sx < row.length; sx++) {
      const color = props.palette[row[sx]!]
      const gy = top + sy
      if (row[sx] !== '.' && color !== undefined && gy >= 0 && gy < groundRow) grid[gy]![2 + sx] = color
    }
  })

  // 同じ色が続くところは1つの箱にまとめる
  const rows = grid.map((cells, y) => {
    const boxes = []
    let x = 0
    while (x < cells.length) {
      const c = cells[x]
      let n = 1
      while (x + n < cells.length && cells[x + n] === c) n++
      boxes.push(<Box key={`${y}-${x}`} width={n * 2} height={1} backgroundColor={c} />)
      x += n
    }
    return (
      <Box key={`r${y}`} flexDirection="row" height={1}>
        {boxes}
      </Box>
    )
  })

  const line =
    s.mode === 'ready' ? 'クリックかスペースでジャンプ' : s.mode === 'over' ? 'ぶつかった！ クリックかスペースでもう一度' : ''
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text tabular>
          {s.score} <Text dimColor>さいこう {s.best}</Text>
        </Text>
        <Button key="back" label="もどる" onPress={() => surface.post({ kind: 'back' })} />
      </Box>
      <Text color="#d97757" wrap="truncate">
        {s.noticeLeft > 0 && props.notice ? `★ ${props.notice}` : ' '}
      </Text>
      {rows}
      <Text dimColor wrap="truncate">
        {line || ' '}
      </Text>
    </Box>
  )
}

export default Game

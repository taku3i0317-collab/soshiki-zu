import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, RenderInput } from 'claude-code'

import type { GameProps, PetChara, PetMood, PetRun } from '../../types'
import type { Chara } from './chara'
import { DEFAULT, gameSprites, parseChara } from './chara'
import { PX_H, PX_W, mascotSvg } from './mascot'

// ペット（ドット絵のマスコットとジャンプのミニゲーム）。pane-pet から移したもの。
// ペットの部分はこのフォルダ（hooks/pet/）だけ：外すときは register.tsx の pet で始まる呼び出し（petStart など）と PetSection、
// types の Pet* と pet*、plugin.json の charaFile を消す

const mode = atom({ plugin: 'soshiki-zu', key: 'petMode' } as const, 'pet')
const runs = atom({ plugin: 'soshiki-zu', key: 'petRuns' } as const, [])
const sessions = atom({ plugin: 'soshiki-zu', key: 'petSessions' } as const, [])
const ownTurn = atom({ plugin: 'soshiki-zu', key: 'petOwnTurn' } as const, false)
const flash = atom({ plugin: 'soshiki-zu', key: 'petFlash' } as const, null)
const notice = atom({ plugin: 'soshiki-zu', key: 'petNotice' } as const, { id: 0, text: '' })
const best = atom({ plugin: 'soshiki-zu', key: 'petBest' } as const, 0)
const custom = atom({ plugin: 'soshiki-zu', key: 'petChara' } as const, null)
const now = atom({ plugin: 'soshiki-zu', key: 'petNow' } as const, 0)

// 喜ぶ・転ぶを見せる長さ
const FLASH_MS = 8_000
// 係の取りこぼしを直す間隔
const TICK_MS = 5_000
// ゲームのコマ送りの間隔（ペインの中の時計は 1秒に10回まで確かめた）
const GAME_TICK_MS = 70
const BEST_KEY = 'petBest'

// 時間で変わる表示を、決まった時刻のあとに描き直す
function redrawAfter($: Engine, ms: number) {
  $.clock.after(ms + 100, () => void $.clock.now().then(x => update($, now, () => x)))
}

async function show($: Engine, kind: 'happy' | 'fall', text: string) {
  const t = await $.clock.now()
  await update($, flash, () => ({ kind, text, at: t }))
  await update($, notice, n => ({ id: (n?.id ?? 0) + 1, text }))
  redrawAfter($, FLASH_MS)
}

// 係の返事の1行目が「状態: 失敗」なら転ぶ
const failedByAnswer = (answer: string) => /状態\s*[:：]\s*\**\s*失敗/.test(answer.slice(0, 400))

// 組織図が15秒ごとに読む現場のセッションのうち、動いているもの。動いていたのが止まったら喜ぶ
export async function petSessions($: Engine, running: { id: string; name: string }[]) {
  try {
    const before = await read($, sessions)
    for (const s of before) if (!running.some(r => r.id === s.id)) await show($, 'happy', `${s.name} がひと区切り`)
    await update($, sessions, () => running)
  } catch {}
}

// フックを取りこぼしても（読み込み直し・中断）動いたままにならないよう、エンジンの一覧と突き合わせる
async function tick($: Engine) {
  try {
    const list = await read($, runs)
    if (list.length === 0) return
    const t = await $.clock.now()
    const agents = new Map((await $.agent.list()).map(a => [a.id, String(a.status)]))
    const gone = list.filter(r => t - r.startedAt > 10_000 && !['running', 'pending'].includes(agents.get(r.id) ?? ''))
    if (gone.length === 0) return
    await update($, runs, cur => (cur ?? []).filter(r => !gone.some(g => g.id === r.id)))
    for (const g of gone) await show($, agents.get(g.id) === 'failed' ? 'fall' : 'happy', `${g.name} がおわった`)
  } catch {}
}

async function loadCustom($: Engine, file: string) {
  if (file === '') return update($, custom, () => null)
  try {
    const c = parseChara(await $.fs.read(file))
    await update($, custom, () => (c === null ? null : (JSON.parse(JSON.stringify(c)) as PetChara)))
  } catch {
    await update($, custom, () => null)
  }
}

// 下の petXxx は、組織図の同じ名前のフック（register.tsx）の中から呼ぶ（エンジンは1つのイベントに1つのフックだけ）

let timer: { cancel: () => void } | undefined

export async function petStart($: Engine, charaFile: string) {
  try {
    await loadCustom($, charaFile)
    const stored = await $.store.get(BEST_KEY)
    if (typeof stored === 'number') await update($, best, () => stored)
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => void tick($))
  } catch {}
}

// このセッション自身のターンが始まった
export async function petTurnStart($: Engine) {
  await update($, ownTurn, () => true)
}

// 係が呼ばれた（呼び出しのあと。agentId が分かったもの）
export async function petSpawned($: Engine, id: string, name: string) {
  try {
    const run: PetRun = { id, name, startedAt: await $.clock.now() }
    await update($, runs, cur => [...(cur ?? []).filter(x => x.id !== run.id), run])
  } catch {}
}

// ターンが終わった：秘書なら考え中をやめ、係なら喜ぶ／転ぶ
export async function petTurnComplete(
  $: Engine,
  e: { agentId?: string; isAborted: boolean; reason: string; answer?: string },
) {
  try {
    if (e.agentId === undefined) {
      await update($, ownTurn, () => false)
      return
    }
    const id = e.agentId
    const run = (await read($, runs)).find(x => x.id === id)
    if (run === undefined) return
    await update($, runs, cur => (cur ?? []).filter(x => x.id !== id))
    if (e.isAborted) return
    const failed = e.reason === 'error' || failedByAnswer(e.answer ?? '')
    await show($, failed ? 'fall' : 'happy', failed ? `${run.name} でつまずいた` : `${run.name} がおわった`)
  } catch {}
}

// ゲームの部品から：もどる・さいこう点
export async function petMessage($: Engine, data: unknown) {
  const d = data as { kind?: string; best?: number } | null
  if (d?.kind === 'back') await update($, mode, () => 'pet')
  else if (d?.kind === 'best' && typeof d.best === 'number') {
    const b = d.best
    await update($, best, x => Math.max(x ?? 0, b))
    await $.store.set(BEST_KEY, await read($, best))
  }
}

/** ペインのいちばん上：マスコット（48px）と一言と「あそぶ」。ゲームのあいだはゲーム（「もどる」でマスコット） */
export async function PetSection($: Engine, e: RenderInput<'Pane'>) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const Svg = 'Svg' in ui ? ui.Svg : undefined
  const Client = 'Client' in ui ? ui.Client : undefined
  const c = await read($, custom)
  const chara: Chara = c === null ? DEFAULT : c

  if ((await read($, mode)) === 'game' && Client) {
    const n = await read($, notice)
    const props: GameProps = {
      sprites: (({ run, jump }) => ({ run: run.map(g => [...g]), jump: [...jump] }))(gameSprites(chara)),
      palette: { ...chara.palette },
      tickMs: GAME_TICK_MS,
      best: await read($, best),
      notice: n.text || null,
      noticeId: n.id,
    }
    return <Client key="game" module="./game.tsx" props={props} />
  }

  // 状態で気分を決める（喜ぶ・転ぶ → 作業 → 寝る）
  const clock = Math.max(await read($, now), await $.clock.now())
  const list = await read($, runs)
  const live = await read($, sessions)
  const isOwn = await read($, ownTurn)
  const f = await read($, flash)
  const busy = list.length + live.length + (isOwn ? 1 : 0)
  const mood: PetMood = f !== null && clock - f.at < FLASH_MS ? f.kind : busy > 0 ? 'work' : 'sleep'
  const say =
    mood === 'happy' || mood === 'fall'
      ? (f?.text ?? '')
      : mood === 'work'
        ? [list.length > 0 ? `係 ${list.length}` : '', live.length > 0 ? `現場 ${live.length}` : '', isOwn ? '考え中' : '']
            .filter(Boolean)
            .join(' · ')
        : 'すやすや'

  // 絵（Svg）は押せる部品にできないので、横の「あそぶ」でゲームにする
  const mascot = (
    <Box flexDirection="row" gap="sm" alignItems="center">
      {Svg ? (
        <Svg source={mascotSvg(chara, mood)} alt={`${chara.name}：${say}`} width={PX_W} height={PX_H} isInteractive />
      ) : null}
      <Box flexDirection="column" flexShrink={1}>
        <Text dimColor size="caption" wrap="truncate-end">
          {say || ' '}
        </Text>
        {Client && (
          <Button key="play" plain onPress={() => void update($, mode, () => 'game')}>
            <Text size="caption">あそぶ</Text>
          </Button>
        )}
      </Box>
    </Box>
  )
  return mascot
}

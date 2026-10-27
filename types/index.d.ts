/** 名簿の1行：係名・立場（agents/ の名前）・使う PM */
export type Kakari = { name: string; role: string; pm: string }

/** PM 1つ：名前と、status/index.md の「動」の1行 */
export type Pm = { name: string; doing: string }

/** 外の現場（status/制作.md の台帳の見出し）：名前と部門 */
export type Genba = { name: string; bumon: string }

/** 動かない部分。roles/roster.md の無いフォルダでは null */
export type Chart = { pms: Pm[]; kakari: Kakari[]; genba: Genba[] }

/** 係の1回の呼び出し。state は「動いている」か、終わったあとの状態 */
export type RunState = 'running' | '完了' | '一部' | '失敗' | '中断' | '終わった'
export type Run = {
  /** Agent 呼び出しの id（始まった直後に agentId に変わる） */
  id: string
  /** 係名（役割カードのファイル名）。カードが無い呼び出しは立場の名前 */
  name: string
  /** 立場（researcher など） */
  role: string
  /** 役割カードがあったか（無いのは係でない呼び出し） */
  hasCard: boolean
  description: string
  /** 出力先（work/<係名>/…）。書いていなければ空 */
  out: string
  startedAt: number
  endedAt: number | null
  state: RunState
  /** 終わったときのトークンの合計（入力・キャッシュ・出力）。エンジンが数えたものだけ。動いている間は無い */
  tokens?: number
}

/** 使用量の枠1つ：名前・使った割合・戻る時刻（ミリ秒） */
export type Window = { label: string; pct: number; resetsAt: number | null }

/**
 * 使用量。five・week はエンジンの数字（無ければアプリの数字）。models はアプリの「週・モデル別」。
 * ctx はこのセッション（秘書）の会話の長さ、usd はこのセッションの料金。取れないものは null
 */
export type Usage = {
  five: Window | null
  week: Window | null
  models: Window[]
  ctx: { tokens: number; percent: number } | null
  usd: number | null
}

/** 秘書が立てた現場のセッション（アプリのセッション一覧から）。folder は現場の名前（依頼中の行から。無ければフォルダ名） */
export type Session = {
  id: string
  folder: string
  title: string
  isRunning: boolean
  lastActivityAt: number
  /** 会話の長さ（アプリが教えてくれるのは動いている間だけ）。取れなければ null */
  ctx: { tokens: number; percent: number } | null
}

/** 「## 依頼中」の1行：現場の名前（「ehon（ehon-kobo）」なら2つ）と、何の作業か */
export type Irai = { names: string[]; what: string }

/**
 * 現場のセッションの見え方。sessions が null のときは一覧が取れていない（note に理由）。
 * irai は台帳の依頼中（取れなくても出せる）
 */
export type Sessions = { sessions: Session[] | null; note: string; irai: Irai[] }

/**
 * 記録のボタン1つ：今日の最後の記録の時刻、それが「なし」か、目安を過ぎているか（kiroku-botan と同じ読み方）。
 * every は「間隔」の表にある（毎日ではない）か。group・skipText は「## ボタン」の表のまとまり・なしの言い方（無ければ空）
 */
export type Item = {
  name: string
  at: string | null
  skipped: boolean
  isLate: boolean
  every: boolean
  group: string
  skipText: string
}

/** 次の予定1つ：時刻の書いてある今日の定例か、7日以内の課題の締め切り。at は時計の値、label は見せる時刻 */
export type Soon = { what: string; at: number; label: string }

/** 組織図の下の記録。status/生活.md が無いフォルダでは null */
export type Today = { items: Item[]; soon: Soon[] }

/**
 * 「あなた待ち」の1件：どこの（部門・現場の名前）、なぜ（返事＝本人の返事待ち、手＝本人の手待ち、現場＝止まっているセッション）、
 * 本人がやること（text）、その中の打つコマンド（そのままの形）、どこから読んだか
 */
export type Matsu = {
  id: string
  where: string
  kind: '返事' | '手' | '現場'
  text: string
  commands: string[]
  from: 'status' | 'handoff' | 'session'
}

/** 開いている枝：`pm:<PM名>`・`recent`・`genba`・`usage`・`hoka`（記録のほか）。書かれていない枝は決まりの開き方 */
export type Open = Record<string, boolean>

// ── ペット（hooks/pet/。外すときはここから下の Pet* と PluginState の pet* も消す）──

export type PetMood = 'work' | 'sleep' | 'happy' | 'fall'

/** 動いている係（このセッションのサブエージェント） */
export type PetRun = { id: string; name: string; startedAt: number }

/** 終わった・失敗したときに、しばらく喜ぶ／転ぶ */
export type PetFlash = { kind: 'happy' | 'fall'; text: string; at: number }

export type PetNotice = { id: number; text: string }

/** 差しかえたキャラ（charaFile の JSON を読んだもの） */
export type PetChara = {
  name: string
  palette: Record<string, string>
  eye: string
  stand: string[]
  poses?: Partial<Record<'work' | 'sleep' | 'happy' | 'fall', string[]>>
}

/** ゲームの部品（Client）に渡すもの */
export type GameProps = {
  sprites: { run: string[][]; jump: string[] }
  palette: Record<string, string>
  tickMs: number
  best: number
  notice: string | null
  noticeId: number
}

declare module 'claude-code' {
  interface PluginState {
    'soshiki-zu': {
      chart: Chart | null
      runs: Run[]
      now: number
      open: Open
      sessions: Sessions
      /** 本人がペインを閉じたか（閉じたら勝手に開き直さない。/soshiki で戻る） */
      closedByPerson: boolean
      usage: Usage | null
      kiroku: Today | null
      /** あなた待ち（status と現場の HANDOFF から。止まっているセッションは描くときに足す） */
      matsu: Matsu[]
      petMode: 'pet' | 'game'
      petRuns: PetRun[]
      /** 動いている現場のセッション（組織図の一覧から） */
      petSessions: { id: string; name: string }[]
      petOwnTurn: boolean
      petFlash: PetFlash | null
      petNotice: PetNotice
      petBest: number
      petChara: PetChara | null
      /** 時間で変わる表示（喜ぶ・転ぶの終わり）を描き直すための時計 */
      petNow: number
    }
  }
}

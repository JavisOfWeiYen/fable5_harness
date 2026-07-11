# Fable 5 Harness

**給 Claude Code 的營運制度包。** 一套安裝進 `~/.claude/` 的規則、rubric 與自訂 agent，讓每個
Claude Code session 都以「指揮官」模式運作：主對話不下場做粗活、「完成」必須有執行證據、
每個容易搞砸的判斷題都有明文規範。以 Opus 為主力調校，同樣適用 Sonnet。

> 原始版本由一個 Claude Fable 5 session 一次性建立——把一個較強模型 session 的判斷力，寫成
> 之後每個 session（無論主力跑 Opus 或 Sonnet）都能逐條執行的規則、rubric 和模板；再由另一個
> fresh-context agent 對抗審查、修正 16 個問題。本 repo 是該產出的 Opus-first 發佈版。

## 這套在解決什麼問題

幾乎每個 Claude Code 用戶都會遇到的三個根因（完整診斷見 `home-claude/docs/00-harness-diagnosis.md`）：

1. **主對話自己下場做粗活。** 整檔讀大檔案、反覆看截圖、批次改檔都發生在主對話裡，幾次就把
   context 撐爆觸發壓縮；壓縮後模型開始忘記先前講過的約束、重複做過的事。
2. **沒有常駐制度。** 沒有 CLAUDE.md 時，每個新 session 都要重新摸索專案怎麼跑、怎麼驗證、
   有什麼偏好；學到的教訓下個 session 就消失。
3. **「完成」由模型自己說了算。** 「程式看起來沒問題」不是證據；模型越小越容易高報完成度。

這個 repo 就是對應的解法：一份精簡的 `~/.claude/CLAUDE.md` 路由器 ＋ `docs/` 制度文件 ＋
三個自訂 agent。

## 安裝

> **支援範圍：** 本套件針對 WSL、macOS、Linux 上的 Claude Code。Windows 原生／PowerShell
> 環境目前不支援；Windows 使用者建議在 WSL 內安裝與使用。選配 hooks 為 POSIX sh + jq，同樣
> 只適用 WSL/macOS/Linux。

需求：已安裝 Claude Code（建議主力模型用 Opus）。

```bash
git clone https://github.com/JavisOfWeiYen/fable5_harness.git
cd fable5_harness
```

在 repo 資料夾裡打開 Claude Code，說一句「幫我安裝這個」即可——根目錄的 bootstrap `CLAUDE.md`
會自動載入，把 Claude 導向 `install_harness.md` 開始安裝。若沒自動開始，把這句貼給它：

> 讀取 install_harness.md，照著裡面的步驟安裝

安裝時 Claude 會：備份既有設定 → 複製檔案到 `~/.claude/` → 問幾個問題（成本傾向、主要用途、
語言偏好、互動風格〔全自主或節點回報〕、有沒有 Fable 5 權限、要不要裝選配 hooks）→ 用你這台機器的實況填好佔位 → 驗證結果。檔案已預先通用化：
規則與範例不綁定任何作業系統或專案類型，不會裝出錯誤的環境指令；未填的佔位會被驗證步驟（Step 4）擋下，安裝時不要猜測填值。

之後要更新：在 package 目錄 `git pull` 拿新版，對 Claude 說「讀取 upgrade_harness.md，照著升級」。
升級走逐 hunk 移植，不會覆蓋你機器上已個人化的檔案。裝完的 clone 建議留著，升級最省事
（刪掉也行——安裝時 Handoff 已記錄 package commit，重新 clone 後仍能精準 diff）。

> **permission allowlist 一步請保守**：只放確定唯讀／冪等的指令。這套會自主執行可逆步驟、
> 平行派出背景 agent——allowlist 放什麼，整個 agent 艦隊就能無人值守做什麼。寧可多幾個
> permission prompt，也不要放任何會寫檔、刪檔、對外送出或改設定的指令；清單就在
> `~/.claude/settings.json`，之後隨時可以檢視與收窄。

**裝完重啟一次 Claude Code**（自訂 agent 要重啟才會註冊）。之後 `~/.claude/CLAUDE.md` 每個
session 自動載入，不需再做任何事。

### 關於 Fable 5

這套原本以 Fable 5 為派工階梯頂端；本 repo 已改成 **opus 為預設頂端（建議 high effort）**，
`fable` 則是**安裝時可選**——安裝精靈會問你有沒有 Fable 5 權限，有就保留 fable 當頂端、沒有就
移除該列。所以不論你能不能用 Fable 5，同一份都裝得起來。

## 檔案一覽

| 檔案 | 作用 |
|---|---|
| `home-claude/CLAUDE.md` | 全域路由器（約 60 行）：5 條觸發規則（何時去讀哪份文件）＋ 6 條鐵律。刻意短到每個 session 都會完整讀完 |
| `home-claude/docs/00-harness-diagnosis.md` | 上述三大診斷與修法——整套規則的「為什麼」 |
| `home-claude/docs/10-model-dispatch.md` | 派工守則：指揮官不下場、派工必帶三件套（目標動機／驗收條件／回報格式）、模型升降級階梯（錯幾次升級、驗證過的模式降級批量做、每個做法最多重試兩輪）、驗證不自驗 |
| `home-claude/docs/20-judgment-rubrics.md` | 判斷力 rubric：何時升級模型、何時算真的完成、何時該停下問使用者、什麼訊號代表方向錯了該換路、品質底線。每條附一個正例一個反例 |
| `home-claude/docs/30-delegation-templates.md` | 五種派工 prompt 模板（搜尋／實作／重構／研究／審查），含驗收條件與回報格式填空、統一的失敗條款 |
| `home-claude/docs/40-maintenance-protocol.md` | 維護協議：模型可以自己改什麼（查證過的事實）、什麼要先問人（任何規則門檻）、教訓寫回哪裡用什麼格式、膨脹到多長要精簡 |
| `home-claude/docs/50-letter-to-future-sessions.md` | 給未來 session 的信：最可能的三種制度退化方式（路由失靈、貪方便鬆綁規則、事實過期被誤判成規則失效）與預防法 |
| `home-claude/agents/verifier.md` | 自訂驗收 agent：fresh-context、只認執行證據（跑測試、實駕頁面、read-back），逐條回報 PASS／FAIL（opus，high effort） |
| `home-claude/agents/implementer.md` | 為 Opus 調校的實作 agent：接規格明確的實作／重構任務，先自己跑過再回報（opus，high effort）。它是「做的人」，仍由 verifier 另外驗收 |
| `home-claude/agents/hard-solver.md` | 為 Opus 調校的難題求解器：常規嘗試卡關後才派、會權衡多種解法、誠實回報信心與殘餘風險（opus，max effort）。刻意昂貴，少用 |
| `CLAUDE.md`（根目錄） | bootstrap 引導檔：在此 repo 資料夾打開 Claude Code 會自動載入，把 Claude 導向 `install_harness.md`。不會被安裝進 `~/.claude/` |
| `install_harness.md` | 安裝與在地化步驟（寫給安裝方的 Claude Code session 讀） |
| `upgrade_harness.md` | 已安裝機器的升級步驟（寫給升級方的 Claude Code session 讀）：逐 hunk 移植、不覆蓋個人化檔、升級後重跑驗證 |
| `optional-hooks.md` | 選配 hooks（安裝時詢問、合併進 `~/.claude/settings.json`；**POSIX sh + jq，僅適用 WSL/macOS/Linux**）：每個 session 第一次派 subagent 前注入「先讀派工守則」提醒；**真的做過事**（派過工或改過檔）的 session 第一次收尾前注入「完成要有執行證據」檢查——把兩個最關鍵的觸發從自律變成機制，純唯讀問答 session 零成本 |
| `hooks.json` | 上述 hooks 的 JSON 範本；由 `optional-hooks.md` 的 append-safe 指令 **merge** 進 `~/.claude/settings.json`。**只能 merge、不可直接覆蓋**（覆蓋會清掉使用者既有的 settings） |
| `index.html` | 本 repo 的單一評估報告：整體評估、安裝前後差異（六個關鍵時刻被改寫）、以及一次實測對照，合為一份卡片式文件。自包含 HTML，瀏覽器直接開。純佐證材料，不會被安裝進 `~/.claude/` |
| `benchmark/` | 有/無 harness 的 A/B 實測素材：共用的 485 行任務 prompt ＋ 兩個完整成品（`default/` 與 `harness/`）。`index.html` 第六節的數據來源，可自行重驗 |

## 裝完之後長什麼樣

- 你照常對話。模型遇到「要派 subagent」「要宣稱完成」「要改制度檔」這類時刻，會被
  CLAUDE.md 的路由表引導去讀對應文件再動手。
- 實質性工作完成後，模型會派一個沒看過過程的 `verifier` agent 拿驗收條件去實測，而不是自己
  說做完了。
- 你糾正過的事，模型會按維護協議把教訓寫回文件（改規則本身則一定先問你）。
- 要模型查多個事實（例如「查這四個變數」）時，委派模板要求逐項附 file:line 與原文引用、
  沒查到的分開列——用可證偽的格式堵住「查一個、猜三個」。你直接口頭問時也建議這樣要求。
- 超過幾分鐘的工作，模型會先出聲——一行說明在做什麼、大約多久、Esc 可中斷；等待 API 重試也會
  明說，不會沉默。安裝時選「節點回報」的人，動手前還會先看到 ≤5 行的計畫、階段間收到一行回報。

## 這套能做到什麼、做不到什麼（誠實定位）

結論先講：**這是一層流程與紀律，不改模型權重，不會讓 Opus/Sonnet 變聰明。** 它做的是讓模型
穩定發揮在自己能力的高端、少犯低級錯。

**會實際改善的（真的）：**
- context 不被主對話撐爆 → 少觸發壓縮 → 不會做到一半忘記先前的約束。
- 「完成」要有執行證據，還要 fresh-context `verifier` 驗收 → 擋掉「看起來沒問題」的高報。
- 判斷題寫成 rubric、有升降級階梯與 max-effort 難題求解器 → 少走冤路、卡關換路而非硬撞。

  一句話：**有紀律的 Opus，穩定贏過沒紀律的 Opus。**

**做不到的：**
- 不會「逼近 Fable 5 的能力」。遇到超出 Opus 推理上限的題，再多鷹架也不會把它變成更大的
  模型——墊高的是「下限與穩定度」，不是「能力天花板」。
- 補不了**品味與模糊判斷**（視覺方向、文風、兩個都不錯的方案選哪個）。所以制度規定：遇到品味
  題，模型必須做出 2–3 個真正不同的候選、附上可直接判斷的證據（截圖、樣張），交由使用者選，
  不准替使用者默默決定。

**中間那個合理的內核：** 在**可拆解、可驗證**的工作上（規格明確的實作、重構、有標準答案的
研究），一個被好好編排的 Opus，產出**可以逼近「一個更強模型一發到底會產出的東西」**——因為
流程把它會犯、而強模型本來也不會犯的錯都攔掉了。這是「在這類任務上，結果逼近」，不是「能力
逼近」，差別很重要。

> 誠實但書：以上是**從機制推理**的定位，不是統計 benchmark。repo 的 `benchmark/` 收錄了一次
> 可重驗的實測對照（共用的 485 行任務 prompt ＋ 有/無 harness 兩個完整成品）：成品分數打平
> （兩邊都 14/14 測試通過、零 console error），差異在過程痕跡（獨立重驗腳本、未驗證項自我
> 申報）——為什麼會這樣、該怎麼讀，見 [`index.html`](index.html) 第六節。

## 由來

原始版本用一個僅此一次的 Claude Fable 5 session 建立，目標刻意設定為「立制度，而不是拿去做
日常任務」——把判斷力外化成之後每個較弱模型 session 都能沿用的檔案，並經 fresh-context agent
對抗審查修正。本 repo 是該產出的 Opus-first 發佈版。

## License

MIT，見 [`LICENSE`](LICENSE)。

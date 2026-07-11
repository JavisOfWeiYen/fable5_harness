# Handling-feel measurements（操控手感量測）

把玩家的主觀回報——「有 harness 版手感較真實順暢、無 harness 版轉彎過度不穩」——轉成可量測、
可重跑的指標。兩邊都直接驅動遊戲自己的物理引擎（`Physics.stepCar`，1/60s 固定步長），輸入
腳本結構相同，速度目標以**各自的極速**正規化（50% / 85%），引擎皆為決定性（三次重複結果
逐位一致）。

## 三種操演

- **step-steer**：長直線達到目標速度後，全舵 2.0 秒再鬆開。看峰值側滑、滑移角、淨旋轉
  （>180° = 打轉）、鬆舵後回穩時間。
- **slalom**：每 0.7 秒交替左右全舵共 6 秒。看 yaw-jerk RMS（越低越順）、平均側滑。
- **recovery**：從全舵側滑狀態鬆開所有輸入。看側滑衰減與回穩耗時。

## 重點結果（85% 極速；完整數據見 `summary.json` 與各 CSV）

| 指標 | default/（無 harness） | harness/（有 harness） |
|---|---|---|
| 峰值側滑速度 | 56.1 m/s | 7.4 m/s |
| 峰值滑移角 | 41° | 7° |
| 全舵 2 秒淨旋轉 | 177°（50% 極速時 191°，**打轉**） | 77°（全程未打轉） |
| 鬆舵回穩時間 | 2.5–2.9 s | 0.45–0.47 s |
| Slalom yaw-jerk RMS | 28–29 | 13–15 |

程式碼層根因：default 在高速下的轉向權限約為 harness 的 2.5 倍（1.56 vs 0.62 rad/s，
`default/physics.js` `steerGainAt` vs `harness/physics.js:160` 速度反比轉向），且其側滑
以慢速衰減注入（`SLIP_GAIN`/`SLIP_RECOVERY_RATE`），harness 則每 tick 連續 scrub 側滑
（`harness/physics.js:146-152`）。兩邊的鍵盤輸入管線相同（皆為瞬時全舵 ±1），差異完全
在物理模型。

## 怎麼重跑

需要 Node + Playwright（Chromium）。在本目錄：

```bash
node drive2.js
```

會對 `../default/` 與 `../harness/` 各跑三種操演 × 兩種速度，輸出 per-tick CSV
（欄位：t, phase, steerCmd, heading, contHeading, yawRate, speed, slide, slipAngle,
x, y, grip, temp, wear, fVel）與 `summary.json`。

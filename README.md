# 七期防線

網頁版單人 FPS。虛構背景:共軍空降臺中,玩家是後備步兵,在七期新市政中心(夏綠地指揮所)守住 6 波進攻,撐到援軍抵達。

> 虛構軍事題材,人物事件純屬虛構。地圖為示意配置,非實際測繪。

## 執行

```bash
python3 -m http.server 5273
```

在專案根目錄執行上面的指令,然後用桌機 Chrome 或 Safari 開 <http://localhost:5273>(必須經由 http,直接點開 index.html 會被 ES module 擋下)。
不支援滑鼠鎖定的內嵌瀏覽器只能用保底操作(游標移動轉視角、靠左右邊緣持續轉向)。

## 操作

| 按鍵 | 動作 | 按鍵 | 動作 |
|---|---|---|---|
| W A S D | 移動 | 滑鼠左鍵 | 射擊 |
| Shift | 衝刺 | 滑鼠右鍵 | 據槍瞄準 |
| C(按住) | 蹲下(躲在沙包後敵人打不到) | R | 裝填 |
| Space | 跳(可跳上車頂、沙包) | 1 / 2 / 滾輪 | 步槍 / 手槍 |
| G | 手榴彈 | Esc | 暫停 |

## 檔案

| 檔案 | 內容 |
|---|---|
| `src/config.js` | **所有可調數值**:玩家、武器、敵人、波次、掉落、無線電台詞 |
| `src/map.js` | 地圖資料:道路、街廓、地標、掩體、重生點(固定亂數種子) |
| `src/core.js` | 純邏輯:射線、碰撞、尋路流場 |
| `src/main.js` | three.js 場景、玩家、武器、敵人 AI、HUD、音效 |
| `index.html` | 選單、HUD、樣式 |
| `tests/core.test.mjs` | `npm test` |
| `docs/decisions/` | 設計決策與可調整項目 |

## 調整數值的 checklist

1. 只改 `src/config.js`,重新整理頁面即生效。
2. 改了地圖(`map.js`)一定要跑 `npm test`——它會檢查出生點/重生點沒有卡在障礙物裡、每個重生點都走得到玩家。
3. 想快轉驗證:開 `http://localhost:5273/?nolock=1`,在主控台用
   `__game.startGame(); __game.step(600)`(推進 10 秒)、`__game.spawnEnemy({type:'heavy',dir:'N'})`、`__game.S`(狀態)。
4. 新增兵種:在 `ENEMY_TYPES` 加一筆 → 在 `WAVES[].units` 使用;外型在 `main.js` 的 `spawnEnemy`。
5. 新增波次:在 `WAVES` 加一筆(`dirs` 可用 N/E/W/S),不用改程式。

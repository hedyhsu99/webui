# myWeb 專案規則

## 專案背景

同學之間約定出遊的行程網站「**老同學，出發吧！**」。每一趟旅行當成一部電影：有人提案（編劇）、有劇本（行程頁）、有上映日（出發日）、大家按讚累積票房。

- **部署**：GitHub Pages，repo `hedyhsu99/webui`，分支 `main`、根目錄 `/`
- **網址**：https://hedyhsu99.github.io/webui/ （`#編號` 直接展開某一部，如 `/webui/#1`）
- **技術**：純靜態 HTML／CSS／JS，**沒有建置步驟、沒有 npm 相依**，每個 HTML 檔單獨可開
- **唯一的外部服務**：Firebase Realtime Database（票房按讚數），見下方「票房」

⚠️ **repo 是公開的**（免費帳號的 GitHub Pages 只支援 public repo），任何人拿到網址都看得到。行程裡**不要放**住宿訂位代號、電話、護照等個人資訊。

---

## 檔案結構

```
myWeb/
├── index.html                  ← 首頁：作品清單（上）＋ 就地展開的行程（下，iframe）
├── hokuriku-autumn-2027.html   ← #1 富山・飛驒・金澤（編劇 江小靜）
├── database.rules.json         ← Firebase RTDB 安全規則（source of truth，見下方）
├── _config.yml                 ← Jekyll 設定：排除開發用檔案不對外發布
└── CLAUDE.md
```

---

## 首頁欄位（電影用語）

| 欄位 | `TRIPS` 屬性 | 意思 | 格式 |
|---|---|---|---|
| # | `no` | 作品編號，新作品接續最大號 | 數字 |
| 日期 | `proposed` | 提案日 | `YYYY-MM-DD` |
| 編劇 | `writer` | 提案人 | 文字 |
| 劇本 | `file`／`emoji`／`title`／`sub`／`tags` | 行程頁與摘要 | `tags[0]` 以金色顯示，放季節 |
| 上映日 | `release` | 出發日 | 只知月份寫 `YYYY-MM`，確定日期寫 `YYYY-MM-DD` |
| 票房 | （自動） | 按讚數 | 由 Firebase 讀取，**不寫在 TRIPS 裡** |

清單依 `no` **由新到舊**排列；頁尾「共 N 部作品」自動計算。

### 新增一部作品

1. 行程頁 HTML 放在根目錄（與 `index.html` 同層）
2. 在 `index.html` 的 `TRIPS` 陣列加一筆
3. 行程頁要符合下方「**被嵌入的行程頁必須遵守**」三條，否則在首頁展開時會出問題
4. 不需要動 Firebase——新作品第一次被按讚時資料會自動建立

---

## 就地展開（iframe）

點清單列不換頁，行程頁載入下方 iframe，頂端資訊列（標題、編劇、上映、票房、新分頁、收合）以 `position:sticky` 固定。

**iframe 高度自動撐開、整頁只有一條捲軸**，這段有個踩過的坑：

> ⚠️ `ResizeObserver` **必須用 iframe 視窗的建構子**（`new frame.contentWindow.ResizeObserver(...)`）。
> 用首頁的 `ResizeObserver` 監看 iframe 內的元素**不會觸發**——高度只量到載入當下（網路字型還沒載完）就停住，iframe 內多出第二條捲軸。
> 本機測試剛好看不出來（測試視窗高度接近內容高度），**上線後才發現**。

本機**雙擊開檔（`file://`）**時瀏覽器禁止讀取 iframe 內容，會退回固定 80vh、框內捲動（細捲軸）。這是預期行為，不是 bug；要測自動高度請起本機 HTTP 伺服器（如 `npx http-server`）。

### 被嵌入的行程頁必須遵守

1. **`<head>` 內加嵌入偵測**，並隱藏「← 所有行程」：
   ```html
   <script>if(window.self!==window.top)document.documentElement.classList.add("embedded");</script>
   ```
   ```css
   .embedded .back{display:none}
   ```
2. **不可用 `scrollIntoView` 做橫向捲動**（例如讓選中的分頁露出來）——嵌入時它會連外層首頁一起垂直捲動，載入時畫面亂跳。改算 `getBoundingClientRect` 調 `scrollLeft`
3. **會被 `scrollIntoView` 捲到頂端的元素要加 `scroll-margin-top`**（約 76px），否則被首頁的固定資訊列蓋住：
   ```css
   .embedded #tabs{scroll-margin-top:76px}
   ```
4. 避免 `100vh`／`min-height:100vh`：iframe 高度隨內容撐開，用 vh 會變成「內容撐高 iframe → vh 變大 → 內容再撐高」

---

## 票房（按讚）

- **儲存**：Firebase Realtime Database，`index.html` 的常數 `LIKES_DB` 填資料庫網址；**留空時按讚鈕停用顯示「—」**，其他功能照常
- **不載入 Firebase SDK**，直接打 REST API：
  - 加減一：`PUT /likes/t{no}.json`，body `{".sv":{"increment":±1}}`（伺服器端原子加總，同時按不會算錯）
  - 即時更新：`EventSource` 訂閱 `/likes.json`（事件 `put`／`patch`）
- **資料 key 加 `t` 前綴**（`t1`、`t2`）：純數字 key 會被 Firebase 當成陣列回傳（`[null, 3]`）
- **一台裝置一部作品讚一次**：記在 localStorage（`webui-liked`），再按一次＝收回。**沒有登入**，換瀏覽器／換裝置就能再按——同學之間這樣就夠，這是刻意的取捨

### ⚠️ 安全規則：`database.rules.json` 是唯一正本

資料庫網址寫在公開的網頁原始碼裡，**安全全靠規則**：只能讀讚數、每次只能 ±1、不可刪除、不可為負、不可寫其他路徑。

- **這個檔案不會自動部署**。改完要到 Firebase Console → Realtime Database → **規則** 分頁貼上 → 發布
- 反過來也一樣：**不要只在 Console 上改**，改了要同步回這個檔案，否則下次貼上時會蓋掉
- 規則裡 `newData.exists()` 放在 `.write` 而非 `.validate`：**刪除（寫入 null）不會觸發 `.validate`**，放錯地方等於允許任何人清空讚數

---

## 部署

- **push 到 `main` 就是部署**，GitHub Pages 約 1～2 分鐘後更新；進度看 repo 的 **Actions** 分頁（`pages build and deployment`）
- 看到舊畫面先按 Ctrl+F5
- `_config.yml` 的 `exclude` 讓 `CLAUDE.md`、`database.rules.json` 不對外發布（GitHub Pages 預設會把 `.md` 轉成網頁）。新增開發用檔案時記得加進去

### Git 注意事項

- `git add` 時的 `LF will be replaced by CRLF` 警告**無害**（Windows 的 `core.autocrlf`），不影響網頁
- commit email 用 GitHub 匿名信箱 `hedyhsu99@users.noreply.github.com`：repo 公開，commit 裡的 email 任何人都看得到

---

## 開發慣例

- 回覆、註解、UI 一律**繁體中文**
- 色系與字型各頁共用（紅葉紅 `--momiji`、霞鶩文楷標題 `--kai`），新頁面沿用，看起來才像同一個網站；深色模式跟隨系統
- 手機優先：清單在 760px 以下改三段式、按鈕至少 40px、iframe 左右貼齊螢幕
- 改完用本機 HTTP 伺服器在**桌面與手機寬度**各看一次再 push

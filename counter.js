/*
 * 共用計數器：Firebase Realtime Database（直接打 REST API，不載入 Firebase SDK）
 *
 * 全站「大家一起累計」的數字都走這裡：首頁的票房（按讚）、行程頁每家店的「N 人想吃」。
 * 用一般 <script src="counter.js"> 載入（不用 ES module：module 在本機雙擊開檔 file:// 時會被瀏覽器擋掉）。
 *
 * 一般用法（高階）——一組「可以按、可以收回」的計數：
 *   const g = Counter.group("likes", "webui-liked", () => 重畫畫面());
 *   g.count("t1")   目前人數　　g.has("t1")   這台裝置按過沒　　g.busy("t1")   送出中（按鈕要停用）
 *   g.counts()      全部人數 { key: n }
 *   g.toggle("t1")  按一下／收回；畫面先更新（樂觀更新），送出失敗會自動還原並跳提示
 *
 * 底層（通常不需要直接用）：
 *   Counter.watch(path, map => …)   訂閱 path 底下所有計數，有人按就收到最新完整對照表
 *   await Counter.add(path, ±1)     加減一，回傳伺服器加總後的值；被規則拒絕時丟出 Counter.Denied
 *
 * 設計取捨：
 * - 加減一用伺服器端原子運算 {".sv":{"increment":±1}}，兩人同時按也不會算錯
 * - 「按過了沒」記在這台裝置的 localStorage，一台裝置一個 key 算一人，再按一次＝收回。
 *   沒有登入，換瀏覽器／換裝置就能再按——同學之間這樣就夠，這是刻意的取捨
 * - 能寫哪些路徑、每次只能 ±1 等限制都在 database.rules.json；新增路徑要先改規則並貼到 Firebase Console
 * - key 不要用純數字（如 "1"、"2"）：Firebase 會把連續數字 key 當成陣列回傳，所以票房用 t1、想吃用 d0f1
 */
const Counter = (() => {
  const DB = "https://mydb-95f1a-default-rtdb.asia-southeast1.firebasedatabase.app";

  class Denied extends Error {}

  function watch(path, onChange) {
    let map = {};
    const url = `${DB}/${path}.json`;
    if (!("EventSource" in window)) {   // 極舊瀏覽器：只讀一次，不即時更新
      fetch(url).then(r => r.json()).then(d => onChange(map = d || {})).catch(() => {});
      return;
    }
    // EventSource 事件格式：{ path: "/" 或 "/某key", data }；第一次收到全部，之後只收異動
    const es = new EventSource(url);
    const apply = e => {
      const { path: p, data } = JSON.parse(e.data);
      if (p === "/") map = e.type === "patch" ? { ...map, ...data } : (data || {});
      else map = { ...map, [p.slice(1)]: data };
      onChange(map);
    };
    es.addEventListener("put", apply);
    es.addEventListener("patch", apply);
  }

  async function add(path, delta) {
    const r = await fetch(`${DB}/${path}.json`, {
      method: "PUT", body: JSON.stringify({ ".sv": { increment: delta } })
    });
    if (r.status === 401) throw new Denied("permission denied");
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function group(path, storageKey, onChange) {
    let counts = {};
    let mine = new Set();
    try { mine = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]")); } catch (e) {}
    const saveMine = () => { try { localStorage.setItem(storageKey, JSON.stringify([...mine])); } catch (e) {} };
    const busy = new Set();   // 送出中的 key，避免連點
    const bump = (k, d) => { counts = { ...counts, [k]: Math.max(0, (counts[k] || 0) + d) }; };

    async function toggle(k) {
      if (busy.has(k)) return;
      const on = !mine.has(k), delta = on ? 1 : -1;
      on ? mine.add(k) : mine.delete(k);
      bump(k, delta);
      busy.add(k);
      onChange();
      try {
        const v = await add(`${path}/${k}`, delta);
        if (typeof v === "number") counts = { ...counts, [k]: v };   // 以伺服器加總後的值為準
        saveMine();
      } catch (e) {
        if (!on && e instanceof Denied) {
          saveMine();   // 收回被拒＝伺服器上已經是 0（例如很舊的紀錄），直接當作已收回
        } else {
          on ? mine.delete(k) : mine.add(k);
          bump(k, -delta);
          alert(e instanceof Denied ? "這個功能尚未開放。" : "沒有送出，請稍後再試。");
        }
      } finally {
        busy.delete(k);
        onChange();
      }
    }

    watch(path, map => { counts = map; onChange(); });

    return {
      count: k => counts[k] || 0,
      counts: () => counts,
      has: k => mine.has(k),
      busy: k => busy.has(k),
      toggle
    };
  }

  return { group, watch, add, Denied };
})();

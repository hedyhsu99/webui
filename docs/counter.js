/*
 * 共用計數器：Firebase Realtime Database（直接打 REST API，不載入 Firebase SDK）
 *
 * 全站「大家一起按」的功能都走這裡，頁面只負責畫面。資料庫網址也只寫在這裡。
 * 用一般 <script src="counter.js"> 載入（不用 ES module：module 在本機雙擊開檔 file:// 時會被瀏覽器擋掉）。
 *
 * ── 兩種用法 ──
 * 1) Counter.group：只記人數、匿名（首頁票房）
 *      const g = Counter.group("likes", "webui-liked", 重畫);
 *      g.count(k)  g.has(k)  g.busy(k)  g.counts()  g.toggle(k)
 *    「按過了沒」記在這台裝置的 localStorage，一台裝置算一人。
 *
 * 2) Counter.roster：記「誰」按了（行程頁想吃）
 *      const r = Counter.roster("wantBy/hokuriku-autumn-2027", 重畫);
 *      r.names(k) 名單　r.count(k) 人數　r.has(k) 我在不在名單上　r.busy(k)　r.people() 參與過的所有人　r.toggle(k)
 *    第一次按時會請使用者輸入名字（Counter.myName()／Counter.askName()），全站共用、存在這台裝置。
 *    Firebase 資料：{path}/{k}/{名字} = true；人數＝名單長度。
 *
 * 兩者的 toggle 都是：畫面先更新（樂觀更新）→ 送出 → 失敗自動還原並跳提示；送出中擋連點。
 *
 * ── 設計取捨 ──
 * - 沒有登入：匿名計數換裝置就能再按；名單的名字是自己填的，可以冒充。同學之間這樣就夠，這是刻意的取捨
 * - 能寫哪些路徑、寫什麼值都由 database.rules.json 限制；新增路徑要先改規則並貼到 Firebase Console
 * - key 不要用純數字（如 "1"、"2"）：Firebase 會把連續數字 key 當成陣列回傳，所以票房用 t1、想吃用 d0f1
 */
const Counter = (() => {
  const DB = "https://mydb-95f1a-default-rtdb.asia-southeast1.firebasedatabase.app";
  const NAME_KEY = "webui-name";

  class Denied extends Error {}

  // 路徑每一段都要編碼（名字是中文、可能有空白）
  const url = path => `${DB}/${path.split("/").map(encodeURIComponent).join("/")}.json`;

  // 不可變地在巢狀物件 obj 的 keys 位置放入 val；val 為 null 代表刪除（連帶清掉變空的上層）
  function setIn(obj, keys, val) {
    if (!keys.length) return val;
    const [k, ...rest] = keys;
    const base = obj && typeof obj === "object" ? obj : {};
    const child = setIn(base[k], rest, val);
    const out = { ...base };
    if (child === null || child === undefined || (typeof child === "object" && !Object.keys(child).length)) delete out[k];
    else out[k] = child;
    return out;
  }

  // 訂閱 path 底下的資料，有任何異動就呼叫 onChange(最新完整資料)
  function watch(path, onChange) {
    let data = {};
    if (!("EventSource" in window)) {   // 極舊瀏覽器：只讀一次，不即時更新
      fetch(url(path)).then(r => r.json()).then(d => onChange(data = d || {})).catch(() => {});
      return;
    }
    // EventSource 事件：{ path: "/" 或 "/a/b", data }；put＝整個取代，patch＝合併子節點
    const es = new EventSource(url(path));
    const apply = e => {
      const msg = JSON.parse(e.data);
      const keys = msg.path.split("/").filter(Boolean);
      if (e.type === "patch") {
        for (const [k, v] of Object.entries(msg.data || {})) data = setIn(data, [...keys, ...k.split("/")], v);
      } else {
        data = setIn(data, keys, msg.data);
      }
      onChange(data || {});
    };
    es.addEventListener("put", apply);
    es.addEventListener("patch", apply);
  }

  async function send(path, method, body) {
    const r = await fetch(url(path), { method, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) throw new Denied("permission denied");
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  // 加減一：伺服器端原子運算，兩人同時按也不會算錯；回傳加總後的值
  const add = (path, delta) => send(path, "PUT", { ".sv": { increment: delta } });

  // ── 名字（roster 用）──
  // Firebase key 不可含 . # $ [ ] /，也限制長度（與 database.rules.json 一致：1～20 字）
  const cleanName = s => String(s || "").replace(/[.#$\[\]\/]/g, "").trim().slice(0, 20);
  function myName() { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } }
  function askName() {
    const n = cleanName(prompt("請輸入你的名字（大家會看到誰想吃）：", myName()));
    if (n) try { localStorage.setItem(NAME_KEY, n); } catch (e) {}
    return n;
  }

  const failMsg = e => alert(e instanceof Denied ? "這個功能尚未開放。" : "沒有送出，請稍後再試。");

  function group(path, storageKey, onChange) {
    let counts = {};
    let mine = new Set();
    try { mine = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]")); } catch (e) {}
    const saveMine = () => { try { localStorage.setItem(storageKey, JSON.stringify([...mine])); } catch (e) {} };
    const busy = new Set();
    const bump = (k, d) => { counts = { ...counts, [k]: Math.max(0, (counts[k] || 0) + d) }; };

    async function toggle(k) {
      if (busy.has(k)) return;
      const on = !mine.has(k), delta = on ? 1 : -1;
      on ? mine.add(k) : mine.delete(k);
      bump(k, delta); busy.add(k); onChange();
      try {
        const v = await add(`${path}/${k}`, delta);
        if (typeof v === "number") counts = { ...counts, [k]: v };   // 以伺服器加總後的值為準
        saveMine();
      } catch (e) {
        if (!on && e instanceof Denied) saveMine();   // 收回被拒＝伺服器上已是 0，直接當作已收回
        else { on ? mine.delete(k) : mine.add(k); bump(k, -delta); failMsg(e); }
      } finally {
        busy.delete(k); onChange();
      }
    }

    watch(path, d => { counts = d; onChange(); });
    return { count: k => counts[k] || 0, counts: () => counts, has: k => mine.has(k), busy: k => busy.has(k), toggle };
  }

  function roster(path, onChange) {
    let data = {};   // { k: { 名字: true, ... } }
    const busy = new Set();
    const names = k => Object.keys(data[k] || {});

    async function toggle(k) {
      if (busy.has(k)) return;
      const me = myName() || askName();
      if (!me) return;   // 使用者取消輸入名字
      const on = !(data[k] && data[k][me]);
      data = setIn(data, [k, me], on ? true : null);
      busy.add(k); onChange();
      try {
        await send(`${path}/${k}/${me}`, on ? "PUT" : "DELETE", on ? true : undefined);
      } catch (e) {
        data = setIn(data, [k, me], on ? null : true);
        failMsg(e);
      } finally {
        busy.delete(k); onChange();
      }
    }

    watch(path, d => { data = d; onChange(); });
    return {
      names,
      count: k => names(k).length,
      has: k => !!myName() && names(k).includes(myName()),
      busy: k => busy.has(k),
      keys: () => Object.keys(data),
      people: () => [...new Set(Object.values(data).flatMap(o => Object.keys(o || {})))],   // 參與過的所有人
      toggle
    };
  }

  return { group, roster, myName, askName, watch, add, Denied };
})();

// 麻雀エンジン: 向聴数・受け入れ・期待値・危険度・役/点数計算
// 牌種 0-8:萬 9-17:筒 18-26:索 27-33:東南西北白發中
(function (root) {
  'use strict';

  const NAMES = [];
  const SUIT_CH = ['m', 'p', 's'];
  for (let s = 0; s < 3; s++) for (let n = 1; n <= 9; n++) NAMES.push(n + SUIT_CH[s]);
  const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
  for (const h of HONOR_NAMES) NAMES.push(h);
  const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function tileLabel(k, red) {
    if (k >= 27) return HONOR_NAMES[k - 27];
    const n = k % 9 + 1, s = Math.floor(k / 9);
    return (red ? '赤' : '') + n + ['萬', '筒', '索'][s];
  }
  const isHonor = k => k >= 27;
  const isTerminal = k => k < 27 && (k % 9 === 0 || k % 9 === 8);
  const isYaochu = k => k >= 27 || k % 9 === 0 || k % 9 === 8;
  const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  // 牌ID 0-135: kind = id>>2, 赤5 = 各5の0番
  const kindOf = id => id >> 2;
  const isRedId = id => (id === 16 || id === 52 || id === 88);

  // ---------------- 向聴数 ----------------
  const suitCache = new Map();
  function analyzeSuit(a) {
    const res = { nh: [-1, -1, -1, -1, -1], h: [-1, -1, -1, -1, -1] };
    (function rec(i, m, t, hd) {
      while (i < 9 && a[i] === 0) i++;
      if (i >= 9) {
        const tbl = hd ? res.h : res.nh;
        const mm = m > 4 ? 4 : m;
        if (t > tbl[mm]) tbl[mm] = t;
        return;
      }
      if (a[i] >= 3) { a[i] -= 3; rec(i, m + 1, t, hd); a[i] += 3; }
      if (i <= 6 && a[i + 1] && a[i + 2]) { a[i]--; a[i + 1]--; a[i + 2]--; rec(i, m + 1, t, hd); a[i]++; a[i + 1]++; a[i + 2]++; }
      if (!hd && a[i] >= 2) { a[i] -= 2; rec(i, m, t, 1); a[i] += 2; }
      if (a[i] >= 2) { a[i] -= 2; rec(i, m, t + 1, hd); a[i] += 2; }
      if (i <= 7 && a[i + 1]) { a[i]--; a[i + 1]--; rec(i, m, t + 1, hd); a[i]++; a[i + 1]++; }
      if (i <= 6 && a[i + 2]) { a[i]--; a[i + 2]--; rec(i, m, t + 1, hd); a[i]++; a[i + 2]++; }
      a[i]--; rec(i, m, t, hd); a[i]++;
    })(0, 0, 0, 0);
    return res;
  }
  function suitTable(c, off) {
    let key = 0;
    for (let i = 0; i < 9; i++) key = key * 5 + c[off + i];
    let r = suitCache.get(key);
    if (!r) { r = analyzeSuit(c.slice(off, off + 9)); suitCache.set(key, r); }
    return r;
  }
  const honorCache = new Map();
  function honorTable(c) {
    let key = 0;
    for (let i = 27; i < 34; i++) key = key * 5 + c[i];
    let r = honorCache.get(key);
    if (r) return r;
    // 字牌は各牌独立: m,t,head を DP
    let best = [[0, -1, -1, -1, -1], [-1, -1, -1, -1, -1]]; // best[h][m] = max t
    for (let i = 27; i < 34; i++) {
      const n = c[i];
      const opts = []; // [m,t,h]
      if (n === 0 || n === 1) opts.push([0, 0, 0]);
      else if (n === 2) { opts.push([0, 1, 0]); opts.push([0, 0, 1]); }
      else { opts.push([1, 0, 0]); opts.push([0, 1, 0]); opts.push([0, 0, 1]); }
      const nb = [[-1, -1, -1, -1, -1], [-1, -1, -1, -1, -1]];
      for (let h = 0; h < 2; h++) for (let m = 0; m <= 4; m++) {
        if (best[h][m] < 0) continue;
        for (const [om, ot, oh] of opts) {
          const h2 = h + oh; if (h2 > 1) continue;
          const m2 = Math.min(4, m + om);
          const t2 = best[h][m] + ot;
          if (t2 > nb[h2][m2]) nb[h2][m2] = t2;
        }
      }
      best = nb;
    }
    r = { nh: best[0], h: best[1] };
    honorCache.set(key, r);
    return r;
  }
  function shantenNormal(c) {
    let best = [[0, -1, -1, -1, -1], [-1, -1, -1, -1, -1]];
    const groups = [suitTable(c, 0), suitTable(c, 9), suitTable(c, 18), honorTable(c)];
    for (const g of groups) {
      const nb = [[-1, -1, -1, -1, -1], [-1, -1, -1, -1, -1]];
      for (let h = 0; h < 2; h++) for (let m = 0; m <= 4; m++) {
        const bt = best[h][m]; if (bt < 0) continue;
        for (let gm = 0; gm <= 4; gm++) {
          const m2 = m + gm > 4 ? 4 : m + gm;
          const tn = g.nh[gm];
          if (tn >= 0 && bt + tn > nb[h][m2]) nb[h][m2] = bt + tn;
          if (h === 0) { const th = g.h[gm]; if (th >= 0 && bt + th > nb[1][m2]) nb[1][m2] = bt + th; }
        }
      }
      best = nb;
    }
    let s = 8;
    for (let h = 0; h < 2; h++) for (let m = 0; m <= 4; m++) {
      const t = best[h][m]; if (t < 0) continue;
      const v = 8 - 2 * m - Math.min(t, 4 - m) - h;
      if (v < s) s = v;
    }
    return s;
  }
  function shantenChiitoi(c) {
    let pairs = 0, kinds = 0;
    for (let i = 0; i < 34; i++) { if (c[i] >= 2) pairs++; if (c[i] >= 1) kinds++; }
    return 6 - pairs + Math.max(0, 7 - kinds);
  }
  function shantenKokushi(c) {
    let k = 0, p = 0;
    for (const i of YAOCHU) { if (c[i]) { k++; if (c[i] >= 2) p = 1; } }
    return 13 - k - p;
  }
  function shanten(c) {
    return Math.min(shantenNormal(c), shantenChiitoi(c), shantenKokushi(c));
  }

  // 受け入れ: 13枚の手 c, 残り枚数 remain
  function ukeire(c, remain, s) {
    if (s === undefined) s = shanten(c);
    let n = 0; const tiles = [];
    for (let t = 0; t < 34; t++) {
      if (remain[t] <= 0 || c[t] >= 4) continue;
      c[t]++;
      if (shanten(c) < s) { n += remain[t]; tiles.push(t); }
      c[t]--;
    }
    return { n, tiles, s };
  }

  // 有効牌を引いた後、最善の打牌をしたときの平均受け入れ（好形変化・待ちの質）
  function nextUkeire(c, remain, uk) {
    let tot = 0, wsum = 0;
    for (const t of uk.tiles) {
      const r = remain[t];
      c[t]++; remain[t]--;
      let bestN = 0;
      for (let d = 0; d < 34; d++) {
        if (!c[d]) continue;
        c[d]--;
        const s2 = shanten(c);
        if (s2 === uk.s - 1) {
          const u2 = ukeire(c, remain, s2).n;
          if (u2 > bestN) bestN = u2;
        }
        c[d]++;
      }
      c[t]--; remain[t]++;
      tot += r * bestN; wsum += r;
    }
    return wsum ? tot / wsum : 0;
  }

  // ---------------- 和了率の近似 ----------------
  // stages: u[j] = j向聴での有効牌枚数 (j=0は待ち枚数)
  function winProb(s, uList, W, T, turnIdx) {
    if (s < 0) return { p: 1, alive: 0 };
    let dist = new Array(s + 1).fill(0); dist[s] = 1;
    let pWin = 0, alive = 0;
    W = Math.max(W, 10);
    for (let k = 0; k < T; k++) {
      const hazard = 0.03 + 0.004 * (turnIdx + k); // 他家の和了で局が終わる
      const nd = new Array(s + 1).fill(0);
      for (let j = 0; j <= s; j++) {
        const pr = dist[j]; if (!pr) continue;
        alive += pr;
        if (j === 0) {
          const w = Math.min(0.85, 2.0 * uList[0] / W);
          pWin += pr * w;
          nd[0] += pr * (1 - w) * (1 - hazard);
        } else {
          const a = Math.min(0.95, uList[j] / W);
          nd[j - 1] += pr * a * (1 - hazard);
          nd[j] += pr * (1 - a) * (1 - hazard);
        }
      }
      dist = nd;
    }
    return { p: pWin, alive };
  }

  // 翻→点（子・符は平均的な値）
  const HAN_PTS = [0, 1300, 2600, 5200, 8000, 8000, 12000, 12000, 16000, 16000, 16000, 24000, 24000, 32000];
  function hanToPoints(h, dealer) {
    if (h <= 0) return 0;
    if (h >= 13) return dealer ? 48000 : 32000;
    const lo = Math.floor(h), f = h - lo;
    const v = HAN_PTS[lo] + (HAN_PTS[Math.min(13, lo + 1)] - HAN_PTS[lo]) * f;
    return v * (dealer ? 1.5 : 1);
  }

  // 13枚の手の打点ポテンシャル（翻の期待値的な概算）
  function handValueHan(c, ctx, redKept) {
    let han = 1.35; // リーチ + ツモ/裏/一発の平均
    for (const d of ctx.doraKinds) han += c[d];
    han += redKept;
    const yh = yakuhaiKinds(ctx);
    for (const k of yh) { if (c[k] >= 3) han += 1; else if (c[k] === 2) han += 0.3; }
    let yao = 0, honors = 0; const suitCnt = [0, 0, 0];
    for (let i = 0; i < 34; i++) {
      if (!c[i]) continue;
      if (isYaochu(i)) yao += c[i];
      if (i >= 27) honors += c[i]; else suitCnt[Math.floor(i / 9)] += c[i];
    }
    if (yao === 0) han += 0.9; else if (yao === 1) han += 0.45; else if (yao === 2) han += 0.15;
    const main = Math.max(...suitCnt), total = suitCnt[0] + suitCnt[1] + suitCnt[2];
    const off = total - main;
    if (off === 0) han += honors ? 2.4 : 4.5;
    else if (off === 1) han += honors ? 1.0 : 1.6;
    else if (off === 2) han += 0.35;
    return han;
  }
  function yakuhaiKinds(ctx) {
    // 二重で数える（ダブ東など）
    return [31, 32, 33, ctx.seatWind, ctx.roundWind];
  }

  // ---------------- 危険度 ----------------
  // opp: { safe: Set<kind>, dealer: bool }, remain: 自分から見えていない枚数
  function tileDanger(t, opp, remain) {
    if (opp.safe.has(t)) return 0;
    const rem = x => Math.max(0, remain[x]);
    if (t >= 27) {
      const r = rem(t);
      return r >= 3 ? 0.06 : r === 2 ? 0.035 : r === 1 ? 0.012 : 0;
    }
    const b = t - t % 9, n = t % 9;
    const w2 = (a, c) => (rem(b + a) / 4) * (rem(b + c) / 4);
    let ry = 0, kp = 0;
    // 形(n+1,n+2): 待ち n と n+3
    if (n <= 5) { if (!opp.safe.has(b + n + 3)) ry += w2(n + 1, n + 2); }
    else if (n === 6) kp += w2(7, 8); // ペンチャン89
    // 形(n-2,n-1): 待ち n-3 と n
    if (n >= 3) { if (!opp.safe.has(b + n - 3)) ry += w2(n - 2, n - 1); }
    else if (n === 2) kp += w2(0, 1); // ペンチャン12
    if (n >= 1 && n <= 7) kp += w2(n - 1, n + 1); // カンチャン
    const r = rem(t);
    const sp = r >= 3 ? 0.03 : r === 2 ? 0.02 : r === 1 ? 0.01 : 0;
    return 0.08 * ry + 0.025 * kp + sp;
  }
  function dealInRate(t, opps, remain) {
    let safe = 1;
    for (const o of opps) safe *= 1 - tileDanger(t, o, remain);
    return 1 - safe;
  }

  // ---------------- 打牌候補の評価 ----------------
  // ctx: { hand: [ids] (14枚), visible: counts34 (自分の手牌含む全見え), wallLeft, turnIdx,
  //        doraKinds, seatWind, roundWind, dealer, riichiOpps: [{safe:Set, dealer}] }
  function evaluateDiscards(ctx) {
    const c = new Array(34).fill(0);
    for (const id of ctx.hand) c[kindOf(id)]++;
    const remain = new Array(34);
    for (let i = 0; i < 34; i++) remain[i] = Math.max(0, 4 - ctx.visible[i]);
    let W = 0; for (let i = 0; i < 34; i++) W += remain[i];
    const T = Math.max(0, Math.floor(ctx.wallLeft / 4));
    const redTotal = ctx.hand.filter(isRedId).length;
    const opps = ctx.riichiOpps || [];

    // 候補: 牌種ごと（赤5と黒5は別候補）
    const cands = [];
    const seen = new Set();
    for (const id of ctx.hand) {
      const k = kindOf(id), red = isRedId(id);
      const key = k * 2 + (red ? 1 : 0);
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ id, kind: k, red });
    }
    const memo = new Map();
    const res = [];
    for (const cd of cands) {
      c[cd.kind]--;
      let base = memo.get(cd.kind);
      if (!base) {
        const s = shanten(c);
        const uk = ukeire(c, remain, s);
        let u2 = 0;
        if (s >= 1) u2 = nextUkeire(c, remain, uk);
        const uList = [];
        for (let j = 0; j <= Math.max(0, s); j++) {
          if (j === s) uList[j] = uk.n;
          else if (j === s - 1) uList[j] = u2;
          else uList[j] = j === 0 ? 6 : j === 1 ? 14 : 28;
        }
        const wp = winProb(s, uList, W, T, ctx.turnIdx || 0);
        base = { s, u: uk.n, tiles: uk.tiles, u2, pWin: wp.p, alive: wp.alive };
        memo.set(cd.kind, base);
      }
      const redKept = redTotal - (cd.red ? 1 : 0);
      const han = handValueHan(c, ctx, redKept);
      c[cd.kind]++;
      const pts = hanToPoints(han, ctx.dealer);
      const atk = base.pWin * pts;
      let deal = 0, value = atk, mode = 'attack';
      if (opps.length) {
        deal = dealInRate(cd.kind, opps, remain);
        const L = opps.reduce((a, o) => a + (o.dealer ? 9000 : 6000), 0) / opps.length;
        const push = atk - deal * L - base.alive * 0.03 * opps.length * L;
        const fold = -deal * L - T * 0.004 * opps.length * L;
        if (fold > push) { value = fold; mode = 'fold'; } else value = push;
      }
      res.push({ id: cd.id, kind: cd.kind, red: cd.red, s: base.s, u: base.u, tiles: base.tiles, u2: base.u2,
        pWin: base.pWin, han, pts, atk, deal, value, mode });
    }
    res.sort((a, b) => b.value - a.value || a.s - b.s || b.u - a.u);
    return res;
  }

  // ---------------- 和了判定・役・点数 ----------------
  function decompose(c) {
    const out = [];
    for (let h = 0; h < 34; h++) {
      if (c[h] < 2) continue;
      c[h] -= 2;
      const ms = [];
      (function rec(i) {
        while (i < 34 && c[i] === 0) i++;
        if (i >= 34) { out.push({ head: h, m: ms.slice() }); return; }
        if (c[i] >= 3) { c[i] -= 3; ms.push(['t', i]); rec(i); ms.pop(); c[i] += 3; }
        if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
          c[i]--; c[i + 1]--; c[i + 2]--; ms.push(['s', i]); rec(i); ms.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
        }
      })(0);
      c[h] += 2;
    }
    return out;
  }
  function isComplete(c) { return shanten(c) === -1; }
  function waitsOf(c13) {
    const w = [];
    for (let t = 0; t < 34; t++) { if (c13[t] >= 4) continue; c13[t]++; if (isComplete(c13)) w.push(t); c13[t]--; }
    return w;
  }

  // opt: { winTile, tsumo, riichi, ippatsu, seatWind, roundWind, doraKinds, uraKinds, red, dealer, haitei }
  function scoreHand(c, opt) {
    const yakumanList = [];
    let best = null;
    const dragons = [31, 32, 33], winds = [27, 28, 29, 30];
    const total = c.reduce((a, b) => a + b, 0);
    if (total !== 14 || !isComplete(c)) return null;
    let yaoAll = true, allHonor = true, allTerm = true; const suits = new Set(); let hasHonor = false;
    for (let i = 0; i < 34; i++) {
      if (!c[i]) continue;
      if (!isYaochu(i)) yaoAll = false;
      if (i < 27) { allHonor = false; suits.add(Math.floor(i / 9)); } else hasHonor = true;
      if (!isTerminal(i)) allTerm = false;
    }
    const doraCnt = () => {
      let d = 0; for (const k of opt.doraKinds) d += c[k];
      d += opt.red || 0;
      if (opt.riichi) for (const k of opt.uraKinds || []) d += c[k];
      return d;
    };
    const finish = (yaku, fu, isYakuman) => {
      let han = 0;
      for (const [, h] of yaku) han += h;
      if (!isYakuman) {
        if (han === 0) return null;
        const d = doraCnt();
        const dd = [];
        if (d) dd.push(['ドラ', d]);
        han += d;
        yaku = yaku.concat(dd);
      }
      let basePts;
      if (isYakuman) basePts = 8000 * (han / 13);
      else if (han >= 13) basePts = 8000;
      else if (han >= 11) basePts = 6000;
      else if (han >= 8) basePts = 4000;
      else if (han >= 6) basePts = 3000;
      else { basePts = fu * Math.pow(2, han + 2); if (han >= 5 || basePts > 2000) basePts = 2000; }
      const up = x => Math.ceil(x / 100) * 100;
      let pay;
      if (opt.tsumo) {
        if (opt.dealer) { const e = up(basePts * 2); pay = { total: e * 3, each: e }; }
        else { const d = up(basePts * 2), o = up(basePts); pay = { total: d + o * 2, dealerPay: d, otherPay: o }; }
      } else pay = { total: up(basePts * (opt.dealer ? 6 : 4)) };
      return { yaku, han: isYakuman ? han : han, fu, yakuman: isYakuman, points: pay.total, pay, limit: basePts };
    };
    const commonYaku = () => {
      const y = [];
      if (opt.riichi) y.push(['立直', 1]);
      if (opt.ippatsu) y.push(['一発', 1]);
      if (opt.tsumo) y.push(['門前清自摸和', 1]);
      if (opt.haitei) y.push([opt.tsumo ? '海底摸月' : '河底撈魚', 1]);
      return y;
    };
    // 国士無双
    if (shantenKokushi(c) === -1) return finish([['国士無双', 13]], 0, true);
    // 字一色・清老頭 (七対子形も含む)
    const chiitoi = shantenChiitoi(c) === -1;
    const decs = decompose(c);
    if (allHonor) yakumanList.push(['字一色', 13]);
    if (allTerm) yakumanList.push(['清老頭', 13]);
    for (const dec of decs) {
      // 和了牌の位置候補
      const places = [];
      if (dec.head === opt.winTile) places.push({ kind: 'tanki' });
      dec.m.forEach((m, idx) => {
        if (m[0] === 't' && m[1] === opt.winTile) places.push({ kind: 'shanpon', idx });
        if (m[0] === 's' && opt.winTile >= m[1] && opt.winTile <= m[1] + 2) {
          const pos = opt.winTile - m[1];
          let w;
          if (pos === 1) w = 'kanchan';
          else if (pos === 0) w = (m[1] % 9 === 6) ? 'penchan' : 'ryanmen';
          else w = (m[1] % 9 === 0) ? 'penchan' : 'ryanmen';
          places.push({ kind: w, idx });
        }
      });
      for (const pl of places) {
        const y = [];
        const ym = yakumanList.slice();
        const ankou = dec.m.filter((m, i) => m[0] === 't' && !(pl.kind === 'shanpon' && pl.idx === i && !opt.tsumo)).length;
        const trip = dec.m.filter(m => m[0] === 't');
        const seqs = dec.m.filter(m => m[0] === 's');
        if (ankou === 4) ym.push([pl.kind === 'tanki' ? '四暗刻単騎' : '四暗刻', pl.kind === 'tanki' ? 26 : 13]);
        const dragonTrip = trip.filter(m => dragons.includes(m[1])).length;
        if (dragonTrip === 3) ym.push(['大三元', 13]);
        const windTrip = trip.filter(m => winds.includes(m[1])).length;
        if (windTrip === 4) ym.push(['大四喜', 26]);
        else if (windTrip === 3 && winds.includes(dec.head)) ym.push(['小四喜', 13]);
        if (ym.length) {
          const r = finish(ym, 0, true);
          if (!best || r.points > best.points) best = r;
          continue;
        }
        y.push(...commonYaku());
        const yaoInAll = dec.m.every(m => m[0] === 't' ? isYaochu(m[1]) : (m[1] % 9 === 0 || m[1] % 9 === 6)) && isYaochu(dec.head);
        if (yaoAll && !allHonor) y.push(['混老頭', 2]);
        if (!dec.m.some(m => m[0] === 't' ? isYaochu(m[1]) : (m[1] % 9 === 0 || m[1] % 9 === 6)) && !isYaochu(dec.head)) y.push(['断幺九', 1]);
        const yhSet = [31, 32, 33];
        const valueWind = k => (k === opt.seatWind ? 1 : 0) + (k === opt.roundWind ? 1 : 0);
        for (const m of trip) {
          if (yhSet.includes(m[1])) y.push(['役牌 ' + HONOR_NAMES[m[1] - 27], 1]);
          const vw = valueWind(m[1]);
          if (vw) y.push(['役牌 ' + HONOR_NAMES[m[1] - 27], vw]);
        }
        const headYaku = yhSet.includes(dec.head) || valueWind(dec.head) > 0;
        const pinfu = seqs.length === 4 && !headYaku && pl.kind === 'ryanmen';
        if (pinfu) y.push(['平和', 1]);
        // 一盃口/二盃口
        const seqKeys = seqs.map(m => m[1]).sort((a, b) => a - b);
        let pk = 0; const used = new Array(seqKeys.length).fill(false);
        for (let i = 0; i < seqKeys.length; i++) {
          if (used[i]) continue;
          for (let j = i + 1; j < seqKeys.length; j++) if (!used[j] && seqKeys[j] === seqKeys[i]) { used[i] = used[j] = true; pk++; break; }
        }
        if (pk === 2) y.push(['二盃口', 3]); else if (pk === 1) y.push(['一盃口', 1]);
        // 三色同順
        for (let n = 0; n < 7; n++) if ([0, 9, 18].every(o => seqKeys.includes(o + n))) { y.push(['三色同順', 2]); break; }
        // 三色同刻
        for (let n = 0; n < 9; n++) if ([0, 9, 18].every(o => trip.some(m => m[1] === o + n))) { y.push(['三色同刻', 2]); break; }
        // 一気通貫
        for (const o of [0, 9, 18]) if ([0, 3, 6].every(d => seqKeys.includes(o + d))) { y.push(['一気通貫', 2]); break; }
        // 対々和・三暗刻
        if (trip.length === 4) y.push(['対々和', 2]);
        if (ankou === 3) y.push(['三暗刻', 2]);
        if (dragonTrip === 2 && dragons.includes(dec.head)) y.push(['小三元', 2]);
        // チャンタ・純チャン
        if (yaoInAll && seqs.length > 0) {
          if (hasHonor) y.push(['混全帯幺九', 2]); else y.push(['純全帯幺九', 3]);
        }
        // 混一色・清一色
        if (suits.size === 1) { if (hasHonor) y.push(['混一色', 3]); else y.push(['清一色', 6]); }
        // 符
        let fu;
        if (pinfu) fu = opt.tsumo ? 20 : 30;
        else {
          fu = 20 + (opt.tsumo ? 2 : 10);
          dec.m.forEach((m, i) => {
            if (m[0] !== 't') return;
            const open = pl.kind === 'shanpon' && pl.idx === i && !opt.tsumo;
            let f = open ? 2 : 4;
            if (isYaochu(m[1])) f *= 2;
            fu += f;
          });
          if (dragons.includes(dec.head)) fu += 2;
          fu += 2 * valueWind(dec.head);
          if (pl.kind === 'kanchan' || pl.kind === 'penchan' || pl.kind === 'tanki') fu += 2;
          fu = Math.ceil(fu / 10) * 10;
        }
        const r = finish(y, fu, false);
        if (r && (!best || r.points > best.points || (r.points === best.points && r.han > best.han))) best = r;
      }
    }
    if (chiitoi) {
      if (yakumanList.length) { const r = finish(yakumanList, 0, true); if (!best || r.points > best.points) best = r; }
      const y = commonYaku();
      y.push(['七対子', 2]);
      if (yaoAll && !allHonor) y.push(['混老頭', 2]);
      if ([...Array(34).keys()].every(i => !c[i] || !isYaochu(i))) y.push(['断幺九', 1]);
      if (suits.size === 1) { if (hasHonor) y.push(['混一色', 3]); else y.push(['清一色', 6]); }
      const r = finish(y, 25, false);
      if (r && (!best || r.points > best.points)) best = r;
    }
    return best;
  }

  function doraFromIndicator(k) {
    if (k < 27) return k - k % 9 + (k % 9 + 1) % 9;
    if (k <= 30) return 27 + (k - 27 + 1) % 4;
    return 31 + (k - 31 + 1) % 3;
  }

  const API = { NAMES, HONOR_NAMES, KANJI_NUM, tileLabel, kindOf, isRedId, isYaochu, shanten, shantenNormal,
    shantenChiitoi, shantenKokushi, ukeire, nextUkeire, winProb, hanToPoints, handValueHan, tileDanger, dealInRate,
    evaluateDiscards, decompose, isComplete, waitsOf, scoreHand, doraFromIndicator };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Engine = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);

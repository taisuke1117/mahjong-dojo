/* 牌効率道場 — ゲーム進行・bot・判定・UI */
(function () {
  'use strict';
  const E = window.Engine;
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const kindOf = E.kindOf, isRed = E.isRedId;
  const SEAT_NAMES = ['自分', '下家', '対面', '上家'];
  const WIND_CH = ['東', '南', '西', '北'];

  // ---------- 保存 ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* noop */ } }
  };
  const settings = Object.assign({ strict: 1, speed: 1, showAll: true, mode: 'normal', janki: false }, store.get('mjdojo-settings', {}));
  const records = store.get('mjdojo-records', {});
  const recKey = () => 'sudden' + (settings.janki ? '-janki' : '');
  const isSudden = () => settings.mode === 'sudden';
  const defaultStats = () => ({ hands: 0, discards: 0, best: 0, ok: 0, meh: 0, bad: 0, rage: 0, wins: 0, dealins: 0, winPts: 0, dealPts: 0, streak: 0, bestStreak: 0 });
  let stats = Object.assign(defaultStats(), store.get('mjdojo-stats', {}));
  const saveStats = () => store.set('mjdojo-stats', stats);
  const SPEEDS = [650, 330, 120, 2000];
  const botWait = () => settings.speed === 3 ? 1400 + Math.random() * 600 : SPEEDS[settings.speed];

  // ---------- 状態 ----------
  let G = null;
  function newGame() {
    G = { handNo: store.get('mjdojo-handno', 0), scores: store.get('mjdojo-scores', [25000, 25000, 25000, 25000]), pot: 0 };
  }
  const counts = ids => { const c = new Array(34).fill(0); for (const id of ids) c[kindOf(id)]++; return c; };
  const sortIds = ids => ids.slice().sort((a, b) => kindOf(a) - kindOf(b) || (isRed(b) - isRed(a)) || a - b);
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function startHand() {
    const wall = shuffle([...Array(136).keys()]);
    G.dead = wall.splice(wall.length - 14);
    G.doraInd = [G.dead[4]];
    G.uraInd = [G.dead[9]];
    G.wall = wall;
    G.dealer = G.handNo % 4;
    G.roundWind = 27 + (Math.floor(G.handNo / 4) % 2);
    G.players = [0, 1, 2, 3].map(i => ({
      idx: i, hand: [], river: [], riichi: false, ippatsu: false, safe: new Set(),
      tempFuriten: false, riichiFuriten: false, bot: i !== 0,
      seatWind: 27 + ((i - G.dealer + 4) % 4)
    }));
    for (let r = 0; r < 13; r++) for (let i = 0; i < 4; i++) G.players[(G.dealer + i) % 4].hand.push(G.wall.shift());
    G.players.forEach(p => { p.hand = sortIds(p.hand); });
    G.turn = G.dealer;
    G.drawn = null; G.lastDiscard = null; G.myTurns = 0; G.over = false;
    G.feedback = null; G.eval = null;
    hideModal();
    render();
    loop();
  }
  const doraKinds = (inds) => inds.map(id => E.doraFromIndicator(kindOf(id)));

  function visibleFor(pIdx) {
    const v = new Array(34).fill(0);
    for (const id of G.players[pIdx].hand) v[kindOf(id)]++;
    for (const p of G.players) for (const r of p.river) v[kindOf(r.id)]++;
    for (const id of G.doraInd) v[kindOf(id)]++;
    return v;
  }
  function riichiOppsFor(pIdx) {
    return G.players.filter(p => p.idx !== pIdx && p.riichi).map(p => ({ safe: p.safe, dealer: p.idx === G.dealer, idx: p.idx }));
  }
  function scoreFor(pIdx, winId, tsumo) {
    const P = G.players[pIdx];
    const ids = tsumo ? P.hand : P.hand.concat([winId]);
    const c = counts(ids);
    if (!E.isComplete(c)) return null;
    return E.scoreHand(c, {
      winTile: kindOf(winId), tsumo, riichi: P.riichi, ippatsu: P.ippatsu,
      seatWind: P.seatWind, roundWind: G.roundWind, doraKinds: doraKinds(G.doraInd),
      uraKinds: doraKinds(G.uraInd), red: ids.filter(isRed).length, dealer: pIdx === G.dealer,
      haitei: G.wall.length === 0
    });
  }
  function waitsFor(pIdx) {
    const c = counts(G.players[pIdx].hand);
    if (E.shanten(c) !== 0) return [];
    return E.waitsOf(c);
  }
  function isFuriten(pIdx) {
    const P = G.players[pIdx];
    if (P.tempFuriten || P.riichiFuriten) return true;
    const w = waitsFor(pIdx);
    return P.river.some(r => w.includes(kindOf(r.id)));
  }

  // ---------- 進行 ----------
  async function loop() {
    const myHand = G;
    while (!G.over && G === myHand) {
      const pi = G.turn, P = G.players[pi];
      if (G.wall.length === 0) return ryuukyoku();
      const id = G.wall.shift();
      P.hand.push(id);
      G.drawn = id;
      let act;
      if (pi === 0) {
        render();
        act = await playerTurn();
      } else {
        render();
        await sleep(botWait());
        if (G !== myHand || G.over) return;
        act = botTurn(pi);
      }
      if (G !== myHand) return;
      if (act.type === 'tsumo') return win(pi, null, id);
      if (act.riichi) {
        P.riichi = true; P.ippatsu = true; P.riichiPending = true;
        G.scores[pi] -= 1000; G.pot += 1000;
      }
      doDiscard(pi, act.id);
      render();
      const ron = await checkRon(pi, act.id);
      if (G !== myHand || G.over) return;
      if (ron !== null) return win(ron, pi, act.id);
      G.turn = (pi + 1) % 4;
    }
  }
  function doDiscard(pi, id) {
    const P = G.players[pi];
    const i = P.hand.indexOf(id);
    P.hand.splice(i, 1);
    P.hand = sortIds(P.hand);
    const isRiichiTile = !!P.riichiPending;
    if (P.ippatsu && !isRiichiTile) P.ippatsu = false;
    P.riichiPending = false;
    P.river.push({ id, riichi: isRiichiTile });
    const k = kindOf(id);
    P.safe.add(k);
    for (const q of G.players) if (q.riichi && q.idx !== pi) q.safe.add(k);
    if (pi === 0) P.tempFuriten = false;
    G.lastDiscard = { pi, id };
    G.drawn = null;
  }
  async function checkRon(from, id) {
    const k = kindOf(id);
    for (let i = 1; i < 4; i++) {
      const q = (from + i) % 4, Q = G.players[q];
      const c = counts(Q.hand); c[k]++;
      if (!E.isComplete(c)) continue;
      if (isFuriten(q)) continue;
      const sc = scoreFor(q, id, false);
      if (!sc) continue;
      if (q !== 0) return q;
      const yes = await askRon(sc);
      if (yes) return 0;
      // 見逃し
      Q.tempFuriten = true;
      if (Q.riichi) Q.riichiFuriten = true;
      judgeMissedWin('ロン');
      if (isSudden()) { gameOver('和了り見逃し', G.feedback.msg); return null; }
    }
    return null;
  }

  // ---------- bot ----------
  function botTurn(pi) {
    const P = G.players[pi];
    const c = counts(P.hand);
    if (E.isComplete(c) && scoreFor(pi, G.drawn, true)) return { type: 'tsumo' };
    if (P.riichi) return { type: 'discard', id: G.drawn };
    const vis = visibleFor(pi);
    const remain = vis.map(v => Math.max(0, 4 - v));
    const opps = riichiOppsFor(pi);
    const dk = doraKinds(G.doraInd);
    const cands = [];
    for (let k = 0; k < 34; k++) {
      if (!c[k]) continue;
      c[k]--;
      const s = E.shanten(c);
      const u = s <= 3 ? E.ukeire(c, remain, s).n : 0;
      c[k]++;
      const danger = opps.length ? E.dealInRate(k, opps, remain) : 0;
      cands.push({ k, s, u, danger });
    }
    const minS = Math.min(...cands.map(x => x.s));
    const fold = opps.length && (minS >= 2 || (minS === 1 && G.wall.length < 36));
    let pick;
    if (fold) {
      cands.sort((a, b) => a.danger - b.danger || a.s - b.s);
      pick = cands[0];
    } else {
      const yakuhai = [31, 32, 33, P.seatWind, G.roundWind];
      const sc = x => -x.s * 1000 + x.u - (dk.includes(x.k) ? 5 : 0)
        + (x.k >= 27 && !yakuhai.includes(x.k) && c[x.k] === 1 ? 1.5 : 0)
        + (x.k >= 27 && yakuhai.includes(x.k) && c[x.k] === 1 ? 0.8 : 0)
        - x.danger * 300 + Math.random() * 0.3;
      cands.sort((a, b) => sc(b) - sc(a));
      pick = cands[0];
    }
    const ids = P.hand.filter(id => kindOf(id) === pick.k).sort((a, b) => isRed(a) - isRed(b));
    const riichi = !fold && pick.s === 0 && G.wall.length >= 4 && G.scores[pi] >= 1000;
    return { type: 'discard', id: ids[0], riichi };
  }

  // ---------- プレイヤー ----------
  let resolveTurn = null;
  let riichiMode = false;
  let tenpaiKinds = null;
  function playerTurn() {
    return new Promise(resolve => {
      const P = G.players[0];
      G.canTsumo = !!scoreFor(0, G.drawn, true) && E.isComplete(counts(P.hand));
      riichiMode = false;
      tenpaiKinds = null;
      G.eval = null; G.evalPromise = null;
      if (P.riichi) {
        G.myTurnActive = true;
        if (!G.canTsumo) {
          render();
          setTimeout(() => { G.myTurnActive = false; resolve({ type: 'discard', id: G.drawn }); }, Math.min(800, Math.max(250, SPEEDS[settings.speed])));
          return;
        }
        resolveTurn = resolve;
        render();
        return;
      }
      // リーチ可能か
      const c = counts(P.hand);
      tenpaiKinds = new Set();
      for (let k = 0; k < 34; k++) { if (!c[k]) continue; c[k]--; if (E.shanten(c) === 0) tenpaiKinds.add(k); c[k]++; }
      G.canRiichi = tenpaiKinds.size > 0 && G.wall.length >= 4 && G.scores[0] >= 1000;
      G.myTurnActive = true;
      resolveTurn = resolve;
      G.turnStart = performance.now();
      G.late = false;
      const token = G.turnToken = (G.turnToken || 0) + 1;
      render();
      if (settings.janki) {
        startTimerBar();
        setTimeout(() => {
          if (G.turnToken !== token || !G.myTurnActive || G.over) return;
          G.late = true;
          const L = settings.strict;
          flash(JANKI_MSG.late[L]);
          shake();
          stats.janki = (stats.janki || 0) + 1; saveStats();
          if (isSudden()) gameOver('打牌が2秒を超えた', JANKI_MSG.late[L]);
        }, 2000);
      }
      computeEval();
    });
  }
  // 判定はWeb Workerで裏計算（UIを止めない）
  let worker = null, reqId = 0;
  const pending = new Map();
  try {
    if (location.protocol.startsWith('http')) {
      worker = new Worker('worker.js');
      worker.onmessage = e => { const f = pending.get(e.data.id); if (f) { pending.delete(e.data.id); f(e.data); } };
      worker.onerror = () => { worker = null; };
    }
  } catch (e) { worker = null; }
  function evalCtx() {
    const P = G.players[0];
    return {
      hand: P.hand.slice(), visible: visibleFor(0), wallLeft: G.wall.length, turnIdx: G.myTurns,
      doraKinds: doraKinds(G.doraInd), seatWind: P.seatWind, roundWind: G.roundWind,
      dealer: G.dealer === 0, riichiOpps: riichiOppsFor(0)
    };
  }
  function computeEval() {
    const g = G, ctx = evalCtx();
    const t0 = performance.now();
    if (worker) {
      g.evalPromise = new Promise(res => {
        const id = ++reqId;
        pending.set(id, d => { g.eval = d.ev; g.evalMs = performance.now() - t0; res(); });
        worker.postMessage({ id, ctx });
      });
    } else {
      g.eval = E.evaluateDiscards2(ctx);
      g.evalMs = performance.now() - t0;
      g.evalPromise = Promise.resolve();
    }
    return g.evalPromise;
  }
  async function onTileTap(id) {
    if (!G || !G.myTurnActive || !resolveTurn || G.judging) return;
    const tapT = performance.now();
    const P = G.players[0];
    if (P.riichi) {
      if (id !== G.drawn) return;
      if (G.canTsumo) { P.riichiFuriten = true; judgeMissedWin('ツモ'); }
    } else if (riichiMode && !tenpaiKinds.has(kindOf(id))) {
      flash('テンパイが崩れる牌はリーチ宣言牌にできません');
      return;
    }
    G.turnToken = (G.turnToken || 0) + 1; // 2秒タイマーを無効化
    stopTimerBar();
    if (!P.riichi) {
      if (G.canTsumo) judgeMissedWin('ツモ');
      else {
        G.judging = true;
        if (!G.evalPromise) computeEval();
        if (!G.eval) { $('#status').textContent = '判定中…'; await G.evalPromise; }
        G.judging = false;
        judge(id, tapT);
      }
      G.myTurns++;
    }
    if (isSudden() && G.feedback && G.feedback.fail && !G.over) {
      resolveTurn = null; G.myTurnActive = false;
      render();
      gameOver(G.feedback.failReason, G.feedback.msg);
      return;
    }
    if (G.over || !resolveTurn) return;
    const r = resolveTurn; resolveTurn = null; G.myTurnActive = false;
    r({ type: 'discard', id, riichi: riichiMode && !P.riichi });
    riichiMode = false;
  }
  function onTsumo() {
    if (!resolveTurn || !G.canTsumo) return;
    const r = resolveTurn; resolveTurn = null; G.myTurnActive = false;
    r({ type: 'tsumo' });
  }
  let ronResolve = null;
  function askRon(sc) {
    return new Promise(res => {
      ronResolve = res;
      G.ronOffer = sc;
      render();
    });
  }
  function answerRon(yes) {
    if (!ronResolve) return;
    const r = ronResolve; ronResolve = null; G.ronOffer = null;
    render();
    r(yes);
  }

  // ---------- 判定 ----------
  const MSG = {
    shanten: [
      'あれ、向聴数が戻っちゃったよ。{best}切りなら{bs}向聴のまま進めたね',
      '向聴戻してどうすんの。{best}切りでしょ',
      'は？向聴戻し？手牌ちゃんと見えてる？{best}切りなんだけど'],
    torazu: [
      '{cs}向聴に進めたけど、ここは{best}切りで形を残す方が期待値が高いよ',
      '進めるのはいいけど待ち・打点が悪すぎ。{best}切りで構えた方が得',
      '目先の向聴数に飛びつくな。{best}切りで構える場面だぞ'],
    ukeire: [
      '受け入れが{uc}枚になっちゃった。{best}切りなら{ub}枚（同じ{bs}向聴）',
      '同じ{bs}向聴で受け入れ{uc}枚 vs {ub}枚。{best}切りでしょ',
      '{uc}枚？{best}切りなら{ub}枚あるんだが？牌効率イチからやり直し'],
    danger: [
      '{who}のリーチに{cls}の{tile}は危ないよ（放銃率 約{dc}%）。{best}なら約{db}%',
      '{who}のリーチに{cls}{tile}ぶっ放し？放銃率 約{dc}%だよ。{best}で回って',
      '{who}のリーチ見えてる？{cls}の{tile}とか約{dc}%で刺さるぞ。{best}'],
    fold: [
      'この手で{who}のリーチに押すのは損かも。{best}が安全だよ（{bcls}）',
      'その手で押す？期待値マイナスだよ。{best}（{bcls}）でオリ',
      '押し引き壊れてる？その手で勝負になるわけないでしょ。{best}（{bcls}）'],
    push: [
      'この手なら押して良かったよ。{best}切りで前に出よう',
      'オリすぎ。この手は{best}切りで押す場面',
      'ビビりすぎ。この手でオリてどうすんの。{best}で押せ'],
    value: [
      '和了率は近いけど打点が下がっちゃったね。{best}切りなら打点を保てたよ',
      'なんで打点捨てるの？{best}切りでしょ',
      'ドラ・役をドブに捨てるな。{best}一択'],
    shape: [
      '受け入れは近いけど、{best}切りの方が良い待ちになりやすいよ',
      '{best}切りの方が良形になりやすい。形を見て',
      '形が見えてない。{best}切りの方が明確に好形だぞ'],
    generic: [
      '{best}切りの方が良かったね',
      '{best}切りでしょ、ここは',
      'なんでそれ？{best}切り以外ありえない']
  };
  const MILD = ['ちょっと損。{best}切りの方が少しだけ良い', '惜しい、{best}切りの方が少し得', '微妙に損。{best}切りな'];
  const GOOD = [['完璧！', 'ナイス。最善手', '正解。その調子'], ['いいね', 'OK', 'まあ許す']];
  const RAGE_PREFIX = ['', 'ちょっと待って。', 'おい！！'];
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] !== undefined ? v[k] : '');
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const pct = x => (x * 100).toFixed(x < 0.1 ? 1 : 0);

  function judge(id, tapT) {
    const ev = G.eval; if (!ev || !ev.length) return;
    const k = kindOf(id), red = isRed(id);
    const chosen = ev.find(x => x.kind === k && x.red === red) || ev.find(x => x.kind === k);
    // 雀鬼ルール: 禁止打牌は最善候補から外す（全部禁止なら仕方なし）
    const best = ev.find(x => !jankiIllegal(x)) || ev[0];
    const violations = [];
    const L = settings.strict;
    const ill = jankiIllegal(chosen);
    if (ill && jankiIllegal(best) === null) { violations.push(JANKI_MSG[ill][L]); stats.janki = (stats.janki || 0) + 1; }
    if (settings.janki && ((tapT || performance.now()) - G.turnStart > 2000)) {
      violations.push(JANKI_MSG.late[L]);
      if (!G.late) stats.janki = (stats.janki || 0) + 1;
    }
    const diff = best.value - chosen.value;
    const scale = Math.max(250, Math.abs(best.value));
    const rel = diff / scale;
    let grade;
    if (chosen === best || diff <= 1) grade = 'best';
    else if (diff < 40 || rel < 0.06) grade = 'ok';
    else if (diff < 200 && rel < 0.25) grade = 'meh';
    else grade = (diff > 800 && rel > 0.5 ? 'rage' : 'bad');
    // 向聴を進めた打牌は「構え」の判断なので甘めに（近似の誤差も考慮）
    if (chosen.s < best.s && (grade === 'bad' || grade === 'rage') && rel < 0.4) grade = 'meh';
    if (!best.exact && !chosen.exact && chosen.s === best.s && (grade === 'bad' || grade === 'rage') && rel < 0.35) grade = 'meh';

    const bestName = E.tileLabel(best.kind, best.red), chName = E.tileLabel(chosen.kind, chosen.red);
    const sName = x => x === 0 ? 'テンパイ' : x + '向聴';
    const v = { best: bestName, tile: chName, uc: chosen.u, ub: best.u, bs: best.s, cs: chosen.s,
      dc: pct(chosen.deal), db: pct(best.deal) };
    // 危険の内訳（誰に対して危ないか）
    if (chosen.dealBy && chosen.dealBy.length) {
      const worst = chosen.dealBy.slice().sort((a, b) => b.d - a.d)[0];
      v.who = SEAT_NAMES[worst.idx]; v.cls = worst.cls;
      const bw = best.dealBy.slice().sort((a, b) => b.d - a.d)[0];
      v.bcls = best.dealBy.every(o => o.safe) ? (best.dealBy.length > 1 ? 'リーチ者全員に現物' : SEAT_NAMES[best.dealBy[0].idx] + 'に現物') : (SEAT_NAMES[bw.idx] + 'に' + bw.cls);
    }
    let reason = 'generic';
    const anyRiichi = chosen.dealBy && chosen.dealBy.length;
    if (anyRiichi && chosen.deal - best.deal > 0.02) reason = best.mode === 'fold' ? 'fold' : 'danger';
    else if (anyRiichi && chosen.mode === 'fold' && best.mode !== 'fold' && chosen.deal < best.deal) reason = 'push';
    else if (chosen.s > best.s) reason = 'shanten';
    else if (chosen.s < best.s) reason = 'torazu';
    else if (chosen.u < best.u - 1 && chosen.pWin < best.pWin * 0.95) reason = 'ukeire';
    else if (chosen.pts < best.pts * 0.88) reason = 'value';
    else if (chosen.pWin < best.pWin) reason = 'shape';
    // 根拠の数字
    const why = [];
    why.push(`${chName}: ${sName(chosen.s)} 受入${chosen.u}枚 和了率${pct(chosen.pWin)}% 打点${Math.round(chosen.pts / 100) * 100}`);
    why.push(`${bestName}: ${sName(best.s)} 受入${best.u}枚 和了率${pct(best.pWin)}% 打点${Math.round(best.pts / 100) * 100}`);
    if (anyRiichi) {
      const fmt = x => x.dealBy.map(o => `${SEAT_NAMES[o.idx]}に${o.cls}`).join('・');
      why.push(`危険度 ${chName}: ${fmt(chosen)}（約${pct(chosen.deal)}%） / ${bestName}: ${fmt(best)}（約${pct(best.deal)}%）`);
    }
    let msg;
    if (grade === 'best') msg = pick(GOOD[0]);
    else if (grade === 'ok') msg = pick(GOOD[1]) + (settings.strict > 0 ? `（最善は${bestName}切り）` : '');
    else if (grade === 'meh') msg = fill(MILD[L], v);
    else msg = (grade === 'rage' ? RAGE_PREFIX[L] : '') + fill(MSG[reason][L], v);
    stats.discards++;
    const badMove = grade === 'bad' || grade === 'rage';
    let label = null;
    if (violations.length) {
      label = '雀鬼流違反';
      msg = violations.join(' ／ ') + (badMove || grade === 'meh' ? `<br><small>さらに：${msg}</small>` : '');
    }
    stats[grade]++;
    if (!violations.length && (grade === 'best' || grade === 'ok')) { stats.streak++; stats.bestStreak = Math.max(stats.bestStreak, stats.streak); }
    else if (badMove || violations.length) stats.streak = 0;
    saveStats();
    G.feedback = { grade: violations.length && !badMove ? 'bad' : grade, msg, label, chosen, best, ev: ev.slice(), ms: G.evalMs, reason,
      why: grade === 'best' ? [] : why, violations: [],
      fail: badMove || violations.length > 0,
      failReason: violations.length ? '雀鬼流違反' : '悪手' };
    if (badMove || violations.length) shake();
  }
  function jankiIllegal(x) {
    if (!settings.janki || !x) return null;
    if (G.myTurns === 0 && x.kind >= 27) return 'first';
    const dk = doraKinds(G.doraInd);
    if (x.s > 0 && (dk.includes(x.kind) || x.red)) return 'dora';
    return null;
  }
  const JANKI_MSG = {
    first: ['1打目に字牌は切らないのが雀鬼流だよ', '1打目に字牌切り？雀鬼流では禁止だぞ', '第一打に字牌？雀鬼流なら即破門だぞ'],
    dora: ['テンパイしてないのにドラは切らないのが雀鬼流だよ', 'ノーテンでドラ切り？雀鬼流違反', 'ノーテンでドラ切るとか雀鬼流ナメてんの？'],
    late: ['打牌は2秒以内に！', '遅い！2秒以内に切れ', '遅すぎ。考えてる暇なんてないぞ']
  };
  function startTimerBar() {
    const el = $('#timer'); if (!el) return;
    el.classList.add('on');
    const bar = el.firstElementChild;
    bar.style.transition = 'none'; bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = 'width 2s linear'; bar.style.width = '0%';
  }
  function stopTimerBar() {
    const el = $('#timer'); if (!el) return;
    el.classList.remove('on');
  }
  function gameOver(reason, msg) {
    G.over = true; G.myTurnActive = false; resolveTurn = null;
    stopTimerBar();
    const key = recKey();
    const prev = records[key] || 0;
    const run = G.run || 0;
    const isNew = run > prev;
    if (isNew) { records[key] = run; store.set('mjdojo-records', records); }
    render();
    const ev = G.feedback && G.feedback.ev;
    const f = G.feedback;
    setTimeout(() => showModal(`<h2 class="bad">終了：${reason}</h2>
      <p class="go-msg">${msg || ''}</p>
      ${reason === '悪手' && f && f.best && f.ev ? `<p class="go-msg">最善は <b>${E.tileLabel(f.best.kind, f.best.red)}</b> 切りでした</p>` : ''}
      <div class="pts">記録 <b>${run}局</b></div>
      <div class="ura">${isNew ? '自己ベスト更新！' : `自己ベスト ${prev}局`}（${settings.janki ? '雀鬼ルールあり' : '通常ルール'}）</div>
      <button class="b big" data-act="newrun">もう一度</button>`), 450);
  }
  function judgeMissedWin(kind) {
    const L = settings.strict;
    const msgs = ['和了れたよ！見逃しはもったいない', `${kind}できるのに見逃すな！`, `は？？${kind}あるのに見逃し？？和了り方忘れた？`];
    stats.discards++; stats.rage++; stats.streak = 0; saveStats();
    G.feedback = { grade: 'rage', msg: msgs[L], ev: null, fail: true, failReason: '和了り見逃し' };
    shake();
  }

  // ---------- 和了・流局 ----------
  function win(wi, from, id) {
    G.over = true; G.myTurnActive = false;
    const sc = scoreFor(wi, id, from === null);
    const W = G.players[wi];
    if (from === null) {
      if (wi === G.dealer) for (let i = 0; i < 4; i++) { if (i !== wi) G.scores[i] -= sc.pay.each; }
      else for (let i = 0; i < 4; i++) { if (i === wi) continue; G.scores[i] -= (i === G.dealer ? sc.pay.dealerPay : sc.pay.otherPay); }
    } else G.scores[from] -= sc.points;
    G.scores[wi] += sc.points + G.pot;
    const pot = G.pot; G.pot = 0;
    stats.hands++;
    if (isSudden()) G.run = (G.run || 0) + 1;
    if (wi === 0) { stats.wins++; stats.winPts += sc.points; }
    if (from === 0) { stats.dealins++; stats.dealPts += sc.points; }
    saveStats();
    const winIds = from === null ? W.hand : W.hand.concat([id]);
    const title = (wi === 0 ? 'あなた' : SEAT_NAMES[wi]) + (from === null ? ' ツモ' : ` ロン（${from === 0 ? 'あなた' : SEAT_NAMES[from]}から）`);
    showResult({ title, good: wi === 0, bad: from === 0, sc, winIds, winTile: id, pot });
  }
  function ryuukyoku() {
    G.over = true; G.myTurnActive = false;
    const ten = G.players.map(p => E.shanten(counts(p.hand)) === 0);
    const n = ten.filter(Boolean).length;
    if (n > 0 && n < 4) for (let i = 0; i < 4; i++) G.scores[i] += ten[i] ? 3000 / n : -3000 / (4 - n);
    stats.hands++; saveStats();
    if (isSudden()) G.run = (G.run || 0) + 1;
    showResult({ title: '流局', ten });
  }
  function nextHand() {
    G.handNo++;
    if (G.scores.some(s => s < 0)) G.scores = [25000, 25000, 25000, 25000];
    store.set('mjdojo-handno', G.handNo);
    store.set('mjdojo-scores', G.scores);
    startHand();
  }

  // ---------- 描画 ----------
  function tileHTML(id, opts = {}) {
    const k = typeof id === 'number' ? kindOf(id) : id.k;
    const red = typeof id === 'number' ? isRed(id) : !!id.red;
    let face;
    if (k >= 27) {
      const ch = E.HONOR_NAMES[k - 27];
      const cls = k === 31 ? 'haku' : k === 32 ? 'hatsu' : k === 33 ? 'chun' : 'wind';
      face = `<span class="hon ${cls}">${k === 31 ? '' : ch}</span>`;
    } else {
      const s = Math.floor(k / 9), n = k % 9 + 1;
      if (s === 0) face = `<span class="num man">${E.KANJI_NUM[n - 1]}</span><span class="suit man">萬</span>`;
      else if (s === 1) face = `<span class="num pin">${n}</span><span class="suit pin">●</span>`;
      else face = `<span class="num sou">${n}</span><span class="suit sou">索</span>`;
    }
    const cls = ['tile', opts.cls || '', red ? 'red' : '', opts.riichi ? 'rtile' : ''].join(' ');
    const data = typeof id === 'number' && opts.tap ? ` data-id="${id}"` : '';
    return `<div class="${cls}"${data}>${face}</div>`;
  }
  function render() {
    if (!G || !G.players) return;
    const me = G.players[0];
    const wind = WIND_CH[G.roundWind - 27];
    $('#info').innerHTML = `<b>${wind}${G.dealer + 1}局</b><span>残り <b>${G.wall.length}</b></span>
      <span class="dora">ドラ表示 ${G.doraInd.map(id => tileHTML(id, { cls: 'xs' })).join('')}</span>
      <span>供託 ${G.pot / 1000}</span>
      ${settings.janki ? '<span class="chip janki">雀鬼</span>' : ''}
      ${isSudden() ? `<span class="chip sd">一発終了 ${G.run || 0}局 / 最高${records[recKey()] || 0}</span>` : ''}`;
    // 河
    const order = [2, 3, 1, 0];
    $('#rivers').innerHTML = order.map(i => {
      const P = G.players[i];
      const last = G.lastDiscard && G.lastDiscard.pi === i;
      const tiles = P.river.map((r, j) => tileHTML(r.id, { cls: 'sm' + (last && j === P.river.length - 1 ? ' last' : ''), riichi: r.riichi })).join('');
      const turn = G.turn === i && !G.over ? ' turn' : '';
      return `<div class="river${P.riichi ? ' is-riichi' : ''}${turn}">
        <div class="rl"><span class="seat">${WIND_CH[P.seatWind - 27]}</span><span class="nm">${SEAT_NAMES[i]}</span>
        <span class="pt">${G.scores[i]}</span>${P.riichi ? '<span class="rb">リーチ</span>' : ''}</div>
        <div class="rt">${tiles}</div>${turn && i !== 0 && settings.speed === 3 ? '<div class="rtimer"></div>' : ''}</div>`;
    }).join('');
    // 手牌
    let hand = me.hand.slice();
    let drawnId = (G.turn === 0 && G.drawn !== null && hand.includes(G.drawn)) ? G.drawn : null;
    if (drawnId !== null) { hand.splice(hand.indexOf(drawnId), 1); }
    hand = sortIds(hand);
    const active = G.myTurnActive;
    const dim = id => active && riichiMode && tenpaiKinds && !tenpaiKinds.has(kindOf(id)) ? ' dim' : '';
    const lock = id => me.riichi && id !== drawnId ? ' dim' : '';
    $('#hand').innerHTML = hand.map(id => tileHTML(id, { tap: true, cls: 'hd' + dim(id) + (me.riichi ? ' dim' : '') })).join('') +
      (drawnId !== null ? `<div class="gap"></div>` + tileHTML(drawnId, { tap: true, cls: 'hd drawn' + dim(drawnId) + lock(drawnId) }) : '');
    $('#hand').classList.toggle('active', !!active);
    // ボタン
    const btns = [];
    if (G.ronOffer) {
      btns.push(`<button class="b ron" data-act="ron">ロン（${G.ronOffer.points}点）</button>`);
      btns.push(`<button class="b sub" data-act="skip">見逃す</button>`);
    } else if (active) {
      if (G.canTsumo) btns.push(`<button class="b ron" data-act="tsumo">ツモ</button>`);
      if (!me.riichi && G.canRiichi) btns.push(`<button class="b riichi${riichiMode ? ' on' : ''}" data-act="riichi">${riichiMode ? 'リーチ取消' : 'リーチ'}</button>`);
      if (me.riichi && G.canTsumo) btns.push(`<button class="b sub" data-act="tsumogiri">ツモ切り</button>`);
    }
    $('#actions').innerHTML = btns.join('');
    $('#status').textContent = G.over ? '' : G.ronOffer ? 'ロンできます' : active ? (me.riichi ? 'リーチ中' : (riichiMode ? 'リーチ宣言牌を選んでください' : 'あなたの番：切る牌をタップ')) : `${SEAT_NAMES[G.turn]}の番…`;
    renderFeedback();
  }
  const GRADE_UI = { best: ['◎', '最善'], ok: ['○', '許容'], meh: ['△', '疑問手'], bad: ['✕', '悪手'], rage: ['✕✕', '大悪手'] };
  function renderFeedback() {
    const f = G.feedback, el = $('#feedback');
    if (!f) { el.className = 'fb empty'; el.innerHTML = '<div class="fb-hint">切った牌をその都度AIが判定します</div>'; return; }
    if (!settings.showAll && (f.grade === 'best' || f.grade === 'ok') && !(f.violations && f.violations.length)) { el.className = 'fb empty'; el.innerHTML = `<div class="fb-hint">${GRADE_UI[f.grade][0]} ${f.msg}</div>`; return; }
    const [mark, label0] = GRADE_UI[f.grade];
    const label = f.label || label0;
    let detail = '';
    if (f.ev) {
      const rows = f.ev.slice(0, 6);
      if (!rows.includes(f.chosen)) rows.push(f.chosen);
      const anyDeal = f.ev.some(x => x.deal > 0);
      detail = `<table><tr><th>打牌</th><th>向聴</th><th>受入</th><th>和了率</th><th>打点</th>${anyDeal ? '<th>放銃</th>' : ''}<th>評価</th></tr>` +
        rows.map(x => `<tr class="${x === f.chosen ? 'me' : ''}${x === f.best ? ' bst' : ''}">
          <td>${tileHTML({ k: x.kind, red: x.red }, { cls: 'xs' })}</td><td>${x.s < 0 ? '和' : x.s}</td><td>${x.u}</td>
          <td>${pct(x.pWin)}%${x.exact ? '' : '<small>≈</small>'}</td><td>${Math.round(x.pts / 100) * 100}</td>
          ${anyDeal ? `<td>${pct(x.deal)}%<br><small>${(x.dealBy || []).map(o => o.cls).join('/')}</small></td>` : ''}<td>${x.mode === 'fold' ? 'オリ ' : ''}${Math.round(x.value)}</td></tr>`).join('') +
        `</table>${f.why && f.why.length ? `<div class="why">${f.why.map(w => `<div>${w}</div>`).join('')}</div>` : ''}
        <div class="fb-note">評価＝和了率×打点−放銃リスク（点の期待値）。2向聴以内は残り${Math.min(18, Math.floor((G.wall ? G.wall.length : 0) / 4))}巡ほどのツモを読み切り、実際の役・ドラで点数計算（リーチ前提）。≈は近似。計算 ${f.ms ? f.ms.toFixed(0) : '-'}ms</div>`;
    }
    const vio = f.violations && f.violations.length ? `<div class="vio">雀鬼流違反：${f.violations.join(' / ')}</div>` : '';
    el.className = 'fb g-' + (vio && (f.grade === 'best' || f.grade === 'ok' || f.grade === 'meh') ? 'bad' : f.grade);
    el.innerHTML = `<div class="fb-top"><div class="mark">${mark}</div><div class="fb-msg"><div class="lbl">${label}</div>${f.msg}${vio}</div>
      ${detail ? '<button class="more" data-act="detail">詳細</button>' : ''}</div><div class="fb-detail${G.showDetail ? ' open' : ''}">${detail}</div>`;
  }
  function shake() {
    const el = $('#app');
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    if (navigator.vibrate) try { navigator.vibrate(settings.strict === 2 ? [80, 40, 120] : 60); } catch (e) { /* noop */ }
  }
  let flashTimer;
  function flash(t) {
    const el = $('#toast'); el.textContent = t; el.classList.add('on');
    clearTimeout(flashTimer); flashTimer = setTimeout(() => el.classList.remove('on'), 1800);
  }

  // ---------- モーダル ----------
  function showModal(html) { $('#modal-body').innerHTML = html; $('#modal').classList.add('on'); }
  function hideModal() { $('#modal').classList.remove('on'); }
  function showResult(r) {
    render();
    let body = `<h2 class="${r.good ? 'good' : r.bad ? 'bad' : ''}">${r.title}</h2>`;
    if (r.sc) {
      body += `<div class="rhand">${sortIds(r.winIds.filter(x => x !== r.winTile)).map(id => tileHTML(id, { cls: 'sm' })).join('')}<span class="gap"></span>${tileHTML(r.winTile, { cls: 'sm last' })}</div>`;
      body += `<ul class="yaku">${r.sc.yaku.map(([n, h]) => `<li><span>${n}</span><span>${r.sc.yakuman ? '役満' : h + '翻'}</span></li>`).join('')}</ul>`;
      body += `<div class="pts">${r.sc.yakuman ? '' : `${r.sc.han}翻${r.sc.fu}符 `}<b>${r.sc.points}点</b>${r.pot ? `（＋供託${r.pot}）` : ''}</div>`;
      body += `<div class="ura">裏ドラ表示 ${G.uraInd.map(id => tileHTML(id, { cls: 'xs' })).join('')}</div>`;
    } else {
      body += `<ul class="yaku">${G.players.map((p, i) => `<li><span>${SEAT_NAMES[i]}</span><span>${r.ten[i] ? 'テンパイ' : 'ノーテン'}</span></li>`).join('')}</ul>`;
    }
    body += `<details><summary>他家の手牌を見る</summary>${[1, 2, 3].map(i => `<div class="oh"><span>${SEAT_NAMES[i]}</span><div>${G.players[i].hand.map(id => tileHTML(id, { cls: 'xs' })).join('')}</div></div>`).join('')}</details>`;
    if (isSudden()) body += `<div class="ura">一発終了モード：ノーミス <b>${G.run}局</b> 達成中</div>`;
    body += `<button class="b big" data-act="next">次の局へ</button>`;
    setTimeout(() => showModal(body), 500);
  }
  function showStats() {
    const s = stats, total = s.discards || 1;
    const pct = x => (x / total * 100).toFixed(1) + '%';
    showModal(`<h2>成績</h2><ul class="yaku">
      <li><span>局数</span><span>${s.hands}</span></li>
      <li><span>判定した打牌</span><span>${s.discards}</span></li>
      <li><span>◎ 最善</span><span>${pct(s.best)}</span></li>
      <li><span>○ 許容</span><span>${pct(s.ok)}</span></li>
      <li><span>△ 疑問手</span><span>${pct(s.meh)}</span></li>
      <li><span>✕ 悪手</span><span>${pct(s.bad + s.rage)}</span></li>
      <li><span>雀鬼流違反</span><span>${s.janki || 0}回</span></li>
      <li><span>一発終了 最高記録</span><span>通常 ${records.sudden || 0}局 / 雀鬼 ${records['sudden-janki'] || 0}局</span></li>
      <li><span>連続ノーミス（最高）</span><span>${s.streak}（${s.bestStreak}）</span></li>
      <li><span>和了率</span><span>${s.hands ? (s.wins / s.hands * 100).toFixed(1) : 0}%</span></li>
      <li><span>放銃率</span><span>${s.hands ? (s.dealins / s.hands * 100).toFixed(1) : 0}%</span></li>
      <li><span>平均和了打点</span><span>${s.wins ? Math.round(s.winPts / s.wins) : 0}</span></li>
    </ul><button class="b sub" data-act="reset-stats">成績をリセット</button><button class="b big" data-act="close">閉じる</button>`);
  }
  function showSettings() {
    const opt = (name, val, cur, label) => `<button class="seg${cur === val ? ' on' : ''}" data-set="${name}" data-val="${val}">${label}</button>`;
    showModal(`<h2>設定</h2>
      <div class="set"><div>怒り方</div><div class="segs">${opt('strict', 0, settings.strict, '優しめ')}${opt('strict', 1, settings.strict, '辛口')}${opt('strict', 2, settings.strict, 'ボロクソ')}</div></div>
      <div class="set"><div>botの速さ</div><div class="segs">${opt('speed', 0, settings.speed, 'ゆっくり')}${opt('speed', 1, settings.speed, '普通')}${opt('speed', 2, settings.speed, '速い')}${opt('speed', 3, settings.speed, '雀鬼(2秒)')}</div></div>
      <div class="set"><div>良い手の判定も表示</div><div class="segs">${opt('showAll', true, settings.showAll, 'する')}${opt('showAll', false, settings.showAll, '悪手だけ')}</div></div>
      <div class="set"><div>ゲームモード</div><div class="segs">${opt('mode', 'normal', settings.mode, '通常')}${opt('mode', 'sudden', settings.mode, '一発終了')}</div></div>
      <div class="set"><div>雀鬼ルール（2秒打牌・1打目字牌禁止・ノーテンのドラ切り禁止）</div><div class="segs">${opt('janki', false, settings.janki, 'なし')}${opt('janki', true, settings.janki, 'あり')}</div></div>
      ${G.pendingRestart ? '<p class="note warn">モードを変えたので、閉じると新しく始まります</p>' : ''}
      <p class="note">一発終了：✕悪手・和了り見逃し・（雀鬼ルールありなら）雀鬼流違反で即終了。何局ノーミスで打てるかを競います。<br>ルール：赤ドラ3枚・鳴きなし・一局ごとに親が回る東南の繰り返し。点数が0未満になると全員25000点に戻ります。</p>
      <button class="b sub" data-act="restart">この局をやり直す</button>
      <button class="b big" data-act="close">閉じる</button>`);
  }

  // ---------- イベント ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-id],[data-act],[data-set]');
    if (!t) return;
    if (t.dataset.id !== undefined && t.closest('#hand')) return onTileTap(+t.dataset.id);
    if (t.dataset.set) {
      const name = t.dataset.set; let val = t.dataset.val;
      val = val === 'true' ? true : val === 'false' ? false : +val;
      if ((name === 'mode' || name === 'janki') && settings[name] !== val) G.pendingRestart = true;
      if (name === 'janki' && val === true) settings.speed = 3;
      settings[name] = val; store.set('mjdojo-settings', settings);
      showSettings(); render(); return;
    }
    switch (t.dataset.act) {
      case 'riichi': riichiMode = !riichiMode; render(); break;
      case 'tsumo': onTsumo(); break;
      case 'tsumogiri': onTileTap(G.drawn); break;
      case 'ron': answerRon(true); break;
      case 'skip': answerRon(false); break;
      case 'detail': G.showDetail = !G.showDetail; renderFeedback(); break;
      case 'next': nextHand(); break;
      case 'close': hideModal(); if (G.pendingRestart) { G.pendingRestart = false; newRun(); } break;
      case 'newrun': newRun(); break;
      case 'stats': showStats(); break;
      case 'settings': showSettings(); break;
      case 'reset-stats': stats = defaultStats(); saveStats(); showStats(); break;
      case 'restart': hideModal(); resolveTurn = null; ronResolve = null; G.ronOffer = null; G.over = true; G = Object.assign(G, {}); restartHand(); break;
    }
  });
  function newRun() {
    resolveTurn = null; ronResolve = null; stopTimerBar();
    if (G) { G.over = true; G.ronOffer = null; }
    G = { handNo: 0, scores: [25000, 25000, 25000, 25000], pot: 0, run: 0 };
    store.set('mjdojo-handno', 0); store.set('mjdojo-scores', G.scores);
    startHand();
  }
  function restartHand() {
    if (isSudden()) return newRun();
    const keep = { handNo: G.handNo, scores: G.scores, pot: 0 };
    G = keep;
    startHand();
  }

  newGame();
  startHand();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* noop */ });
  }
  window.__G = () => G;
})();

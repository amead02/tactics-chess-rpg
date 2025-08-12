
/* tc_ai_engine.js — EV-aware tChess AI
   Exposes: window.tcAI = { pick(state, opts), shouldDefend(state, ctx) }
   Works with the page structure in your current build (v2.8.2-left).
   No dependencies.
*/
(function () {
  const W = 'w', B = 'b';
  const PIECE_HP = { P:2, N:4, B:4, R:6, Q:8, K:0 };
  function baseDmgOf(type, accelerated){ 
    const base = {P:1,N:2,B:2,R:3,Q:4,K:0}[type] || 0;
    return base + (accelerated ? 1 : 0);
  }
  const PVAL = {P:1, N:3, B:3, R:5, Q:9, K:100};

  function deepClone(x){ return JSON.parse(JSON.stringify(x)); }
  function inBounds(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
  function opp(color){ return color===W?B:W; }
  function sqKey(r,c){ return String.fromCharCode(97+c)+(8-r); }

  // -------- Board helpers (work on state snapshots) --------
  function findKing(board, color){
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      const p=board[r][c]; if(p && p.type==='K' && p.color===color) return {r,c};
    } return null;
  }
  function rayClear(board, r,c, tr,tc){
    const dr = Math.sign(tr-r), dc = Math.sign(tc-c);
    let nr=r+dr, nc=c+dc;
    while(nr!==tr || nc!==tc){
      if(!inBounds(nr,nc)) return false;
      if(board[nr][nc]) return false;
      nr+=dr; nc+=dc;
    }
    return true;
  }
  function pieceAttacks(board, fr,fc, tr,tc){
    const p=board[fr][fc]; if(!p) return false;
    const dr=tr-fr, dc=tc-fc, adr=Math.abs(dr), adc=Math.abs(dc);
    switch(p.type){
      case 'P': {
        const dir = (p.color===W? -1: +1);
        return (dr===dir && Math.abs(dc)===1);
      }
      case 'N': return (adr===2 && adc===1)||(adr===1 && adc===2);
      case 'K': return (adr<=1 && adc<=1 && (adr||adc));
      case 'B': return (adr===adc) && rayClear(board, fr,fc,tr,tc);
      case 'R': return ((dr===0||dc===0) && rayClear(board, fr,fc,tr,tc));
      case 'Q': return (((adr===adc) || (dr===0||dc===0)) && rayClear(board, fr,fc,tr,tc));
    }
    return false;
  }
  function isSquareAttacked(board, r,c, byColor){
    for(let rr=0; rr<8; rr++) for(let cc=0; cc<8; cc++){
      const p=board[rr][cc]; if(!p || p.color!==byColor) continue;
      if(pieceAttacks(board, rr,cc, r,c)) return true;
    }
    return false;
  }
  function simulateQuiet(board, from, to){
    const nb = deepClone(board);
    const p = nb[from.r][from.c]; if(!p) return null;
    nb[to.r][to.c] = deepClone(p);
    nb[from.r][from.c] = null;
    // promotions (mirror game.html behavior → promote to Queen on reach)
    if(p.type==='P'){
      if((p.color===W && to.r===0) || (p.color===B && to.r===7)){
        nb[to.r][to.c].type='Q';
        nb[to.r][to.c].hp=PIECE_HP.Q;
      }
    }
    return nb;
  }

  // Pseudo-legal generator (quiet + captures) for standard chess moves.
  function genPseudo(board, r,c){
    const p=board[r][c]; if(!p) return [];
    const moves = [];
    const color = p.color;
    if(p.type==='P'){
      const dir=color===W?-1:+1;
      // forward
      const fr=r+dir;
      if(inBounds(fr,c) && !board[fr][c]){
        moves.push({from:{r,c}, to:{r:fr,c}, capture:false});
        const startRow = (color===W?6:1);
        if(r===startRow && !board[fr+dir]?.[c]){
          moves.push({from:{r,c}, to:{r:fr+dir,c}, capture:false});
        }
      }
      // captures
      for(const dc of [-1,1]){
        const tr=r+dir, tc=c+dc;
        if(!inBounds(tr,tc)) continue;
        const t=board[tr][tc];
        if(t && t.color!==color) moves.push({from:{r,c}, to:{r:tr,c:tc}, capture:true});
      }
    } else if(p.type==='N'){
      const deltas=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for(const [dr,dc] of deltas){
        const tr=r+dr, tc=c+dc; if(!inBounds(tr,tc)) continue;
        const t=board[tr][tc];
        if(!t) moves.push({from:{r,c}, to:{r:tr,c:tc}, capture:false});
        else if(t.color!==color) moves.push({from:{r,c}, to:{r:tr,c:tc}, capture:true});
      }
    } else if(p.type==='K'){
      for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++){
        if(!dr && !dc) continue;
        const tr=r+dr, tc=c+dc; if(!inBounds(tr,tc)) continue;
        const t=board[tr][tc];
        if(!t) moves.push({from:{r,c}, to:{r:tr,c:tc}, capture:false});
        else if(t.color!==color) moves.push({from:{r,c}, to:{r:tr,c:tc}, capture:true});
      }
    } else {
      const rays = (p.type==='B') ? [[-1,-1],[-1,1],[1,-1],[1,1]]
                : (p.type==='R') ? [[-1,0],[1,0],[0,-1],[0,1]]
                : [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]; // Q
      for(const [dr,dc] of rays){
        let tr=r+dr, tc=c+dc;
        while(inBounds(tr,tc)){
          const t=board[tr][tc];
          if(!t){ moves.push({from:{r,c}, to:{r:tr,c:tc}, capture:false}); }
          else { if(t.color!==color) moves.push({from:{r,c}, to:{r:tr,c:tc}, capture:true}); break; }
          tr+=dr; tc+=dc;
        }
      }
    }
    return moves;
  }

  function moveKeepsKingSafe(board, move){
    const color = board[move.from.r][move.from.c].color;
    const nb = simulateQuiet(board, move.from, move.to);
    if(!nb) return false;
    const k = findKing(nb, color);
    return k && !isSquareAttacked(nb, k.r, k.c, opp(color));
  }

  function allLegal(board, color){
    const out=[];
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      const p=board[r][c]; if(!p || p.color!==color) continue;
      const ms = genPseudo(board, r,c);
      for(const m of ms) if(moveKeepsKingSafe(board, m)) out.push(m);
    }
    return out;
  }

  // Attacking pieces giving check
  function attackersOfKing(board, color){
    const k = findKing(board, color); if(!k) return [];
    const e = opp(color);
    const list=[];
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      const p=board[r][c]; if(!p || p.color!==e) continue;
      if(pieceAttacks(board, r,c, k.r,k.c)) list.push({r,c});
    }
    return list;
  }
function interposeSquares(attackerPos, kingPos){
    // Determine the direction from the attacker to the king and list every square between them.
    const dr = kingPos.r - attackerPos.r;
    const dc = kingPos.c - attackerPos.c;
    const adr = Math.abs(dr), adc = Math.abs(dc);
    let sdr = 0, sdc = 0;
    if (dr === 0 && dc !== 0) {
      // Horizontal attack
      sdr = 0;
      sdc = dc > 0 ? 1 : -1;
    } else if (dc === 0 && dr !== 0) {
      // Vertical attack
      sdr = dr > 0 ? 1 : -1;
      sdc = 0;
    } else if (adr === adc) {
      // Diagonal attack
      sdr = dr > 0 ? 1 : -1;
      sdc = dc > 0 ? 1 : -1;
    } else {
      // Knights and other non-sliding attacks cannot be blocked
      return [];
    }
    const squares = [];
    let nr = attackerPos.r + sdr;
    let nc = attackerPos.c + sdc;
    while (nr !== kingPos.r || nc !== kingPos.c) {
      squares.push({ r: nr, c: nc });
      nr += sdr;
      nc += sdc;
    }
    // Do not remove any squares; include all squares between attacker and king.
    return squares;
  }

  // Strict RPG legal moves while in check (no RNG to escape).
  function strictRPGMoves(state, color){
    const {board, accelerated} = state;
    const std = allLegal(board, color);
    if(!isInCheck(board, color)) return std;
    const atkList = attackersOfKing(board, color);
    if(atkList.length>1){
      // double check → king must move
      return std.filter(m => board[m.from.r][m.from.c].type==='K');
    }
    const atk = atkList[0], atkP = board[atk.r][atk.c];
    const kpos = findKing(board, color);
    const blocks = interposeSquares({r:atk.r, c:atk.c}, kpos);
    const legal = std.filter(m => {
      const p=board[m.from.r][m.from.c];
      if(p.type==='K') return true;
      if(m.capture){
        if(m.to.r===atk.r && m.to.c===atk.c){
          // Must be lethal via BASE (deterministic), no Defend allowed
          return baseDmgOf(p.type, accelerated) >= (atkP.hp ?? PIECE_HP[atkP.type]);
        }
        return false;
      } else {
        return blocks.some(s => s.r===m.to.r && s.c===m.to.c);
      }
    });
    // Annotate forced base + defendLocked if it's the capture of the checker
    return legal.map(m => {
      const p=board[m.from.r][m.from.c];
      if(p.type!=='K' && m.capture && m.to.r===atk.r && m.to.c===atk.c){
        m.forced='base'; m.defendLocked=true;
      }
      return m;
    });
  }

  function isInCheck(board, color){
    const k=findKing(board, color); if(!k) return false;
    return isSquareAttacked(board, k.r, k.c, opp(color));
  }

  // -------- Evaluation --------
  function hpFrac(p){ if(p.type==='K') return 1; const max=PIECE_HP[p.type]; return (p.hp ?? max)/max; }
  function materialEval(board){
    let w=0,b=0;
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      const p=board[r][c]; if(!p) continue;
      const v = (PVAL[p.type]||0) * hpFrac(p);
      if(p.color===W) w+=v; else b+=v;
    }
    return b-w; // from Black's perspective
  }
  function mobilityEval(board){
    const wm = allLegal(board, W).length;
    const bm = allLegal(board, B).length;
    return 0.02*(bm-wm);
  }
  function kingSafety(board){
    // Penalize if king is attacked
    return (isInCheck(board, B)? -0.5:0) + (isInCheck(board, W)? +0.5:0);
  }
  function centerBias(move){
    const dx=Math.abs(move.to.c-3.5), dy=Math.abs(move.to.r-3.5);
    return 0.01*(3.5 - Math.hypot(dx,dy));
  }

  function willOpponentDefend(state, ctx){
    // ctx: { attackType, attacker, defender, lethal, baseDmg, superDmg, forcedBaseEscape }
    const defCount = state.defends[W]; // opponent is White in your game
    if(defCount<=0) return 0.0;
    if(ctx.forcedBaseEscape) return 0.0; // not allowed to Defend
    const v = (PVAL[ctx.defender.type]||0);
    // Base propensity: more likely to defend lethal hits on high value pieces
    let p = 0.0;
    if(ctx.lethal){
      p = Math.min(0.95, 0.20 + 0.10*v); // Q~1.1→clamped, R~0.7, minor ~0.5
    } else {
      const frac = Math.min(1, (ctx.baseDmg)/(ctx.defender.hp||PIECE_HP[ctx.defender.type]));
      p = 0.08 + 0.25*frac + 0.05*(v>=5?1:0); // higher if big chunk
    }
    // Conserve tokens: reduce p when many pieces remain and early phase
    const totalHP = totalSideHP(state.board, W);
    const conserve = totalHP>18? 0.8 : totalHP>10? 0.9 : 1.0;
    p *= conserve;
    // Save one for endgame if >1 left
    if(defCount>=2) p *= 0.85;
    return Math.max(0, Math.min(0.98, p));
  }

  function totalSideHP(board, color){
    let sum=0;
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      const p=board[r][c]; if(p && p.color===color && p.type!=='K') sum += (p.hp ?? PIECE_HP[p.type]);
    }
    return sum;
  }

  function expectedCaptureGain(state, move, attackType){
    // Return {ev, choose:'base'|'super', detail:{}}
    const {board, accelerated} = state;
    const atk = board[move.from.r][move.from.c];
    const def = board[move.to.r][move.to.c];
    if(!atk || !def) return {ev:-1, detail:{reason:'no_atk_or_def'}};
    if(def.type==='K') return {ev:-1, detail:{reason:'king_illegal'}};

    const bD = baseDmgOf(atk.type, accelerated);
    const sD = 2*bD;
    const defHP = def.hp ?? PIECE_HP[def.type];
    const lethalBase = (bD >= defHP);
    const lethalSuper = (sD >= defHP);
    const forcedBaseEscape = !!move.defendLocked || (move.forced==='base');

    // Opponent defend propensity pUse; block chance 0.5 if used
    const pUseBase = willOpponentDefend(state, {attackType:'base', attacker:atk, defender:def, lethal:lethalBase, baseDmg:bD, superDmg:sD, forcedBaseEscape});
    const pUseSuper = willOpponentDefend(state, {attackType:'super', attacker:atk, defender:def, lethal:lethalSuper, baseDmg:bD, superDmg:sD, forcedBaseEscape});

    const pBlock = 0.5;
    const pHitSuper = 0.4;

    // Expected kill probabilities
    const pKillBase = lethalBase ? (forcedBaseEscape ? 1.0 : (1 - pUseBase*pBlock)) : 0.0;
    const pKillSuper = lethalSuper ? (forcedBaseEscape ? pHitSuper : pHitSuper*(1 - pUseSuper*pBlock)) : 0.0;

    // Expected chip values (non-lethal)
    const expDmgBase = (!lethalBase) ? (bD * (forcedBaseEscape ? 1.0 : (1 - pUseBase*pBlock))) : 0.0;
    const expDmgSuper = (!lethalSuper) ? (sD * (forcedBaseEscape ? pHitSuper : pHitSuper*(1 - pUseSuper*pBlock))) : 0.0;

    const defMaxHP = PIECE_HP[def.type];
    const chipWeight = 0.6 * (PVAL[def.type]||0) / (defMaxHP||1);
    const valKill = (PVAL[def.type]||0);
    const valChipBase = chipWeight * expDmgBase;
    const valChipSuper = chipWeight * expDmgSuper;

    // Hanging penalty if bounce leaves our attacker exposed
    const originThreat = isSquareAttacked(board, move.from.r, move.from.c, W) ? 1 : 0;
    const hangFactor = (PVAL[atk.type]||0) * 0.35 * originThreat;
    const pBounceBase = 1 - pKillBase - (expDmgBase>0? 0.0:0.0); // crude
    const pBounceSuper = 1 - pKillSuper - (expDmgSuper>0? 0.0:0.0);

    const evBase = pKillBase*valKill + valChipBase - pBounceBase*hangFactor;
    const evSuper = pKillSuper*valKill + valChipSuper - pBounceSuper*hangFactor;

    const choose = (evSuper - evBase > 0.35) ? 'super' : 'base';
    return { ev: (attackType ? (attackType==='base'? evBase: evSuper) : Math.max(evBase, evSuper)),
             choose, detail:{pKillBase, pKillSuper, valKill, valChipBase, valChipSuper, hangFactor, lethalBase, lethalSuper, bD, sD, pUseBase, pUseSuper, forcedBaseEscape} };
  }

  function evaluateState(board){
    return materialEval(board) + mobilityEval(board) + kingSafety(board);
  }

  function pick(state, opts){
    const depth = (opts && opts.depth) || 1; // only 1-ply for speed
    const color = B; // AI is Black in your page
    const board = state.board;
    const inChk = isInCheck(board, color);
    const moves = inChk ? strictRPGMoves(state, color) : allLegal(board, color);
    if(moves.length===0) return null;

    // Prioritize captures via EV; otherwise best quiet by simple eval + center bias
    let best = null, bestScore = -1e9, bestDebug=null;
    for(const m of moves){
      // Skip illegal captures against the king entirely
      if(m.capture){
        const defPiece = state.board[m.to.r][m.to.c];
        if(defPiece && defPiece.type==='K'){
          // Never select moves that attack a king
          continue;
        }
        const {ev, choose, detail} = expectedCaptureGain(state, m);
        if(ev > bestScore){
          bestScore = ev;
          best = {from:m.from, to:m.to, attackType: (inChk && m.forced==='base') ? 'base' : choose};
          bestDebug = { kind:'capture', ev, detail, from:sqKey(m.from.r,m.from.c), to:sqKey(m.to.r,m.to.c) };
        }
      }
    }
    if(best) return {...best, debug: bestDebug};

    // Quiet moves: prefer centralization & better evaluation
    for(const m of moves){
      if(m.capture) continue;
      const nb = simulateQuiet(board, m.from, m.to);
      if(!nb) continue;
      const evalScore = evaluateState(nb) + centerBias(m);
      if(evalScore > bestScore){
        bestScore = evalScore;
        best = {from:m.from, to:m.to, attackType:'base'};
        bestDebug = { kind:'quiet', eval:evalScore, from:sqKey(m.from.r,m.from.c), to:sqKey(m.to.r,m.to.c) };
      }
    }
    return best ? {...best, debug: bestDebug} : null;
  }

  function shouldDefend(state, ctx){
    // ctx: { attackType, attacker, defender, defendLocked }
    if(ctx.defendLocked) return {use:false, reason:'locked'};
    const defCount = state.defends[B]; // AI's tokens (Black)
    if(defCount<=0) return {use:false, reason:'none_left'};

    const accelerated = !!state.accelerated;
    const bD = baseDmgOf(ctx.attacker.type, accelerated);
    const sD = 2*bD;
    const defHP = ctx.defender.hp || PIECE_HP[ctx.defender.type];
    const wouldKill = (ctx.attackType==='base' ? (bD>=defHP) : (sD>=defHP && Math.random()<0.4)); // approximate

    const v = PVAL[ctx.defender.type]||0;
    let scoreToSave = 0;

    if(wouldKill){
      scoreToSave = v * 1.0; // full piece
    } else {
      const dmg = (ctx.attackType==='base') ? bD : (0.4*sD); // expected
      const frac = Math.min(1, dmg/(defHP||1));
      scoreToSave = v * 0.6 * frac;
    }

    // Token economy: prefer saving at least 1 for endgame; scale by remaining HP on board
    const hpTheyHave = totalSideHP(state.board, B);
    const scarcity = (defCount>=2 ? 0.85 : 1.0) * (hpTheyHave>14? 0.85 : hpTheyHave>8? 0.95 : 1.0);
    const threshold = 0.55; // tweakable
    const decisionValue = (scoreToSave * scarcity);

    const use = decisionValue >= threshold;
    return {use, reason: use? 'worth_token':'save_token', decisionValue, scoreToSave, scarcity};
  }

  // Export API
  window.tcAI = { pick, shouldDefend };
})();

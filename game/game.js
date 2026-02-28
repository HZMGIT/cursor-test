/* ============================================================
 *  中国象棋 (Chinese Chess / Xiangqi)
 *  完整单页游戏 - 含AI对战、悔棋、将军/将死检测
 * ============================================================ */

(function () {
  'use strict';

  // ===================== 常量 =====================
  const GRID  = 70;   // 棋盘格子间距
  const PAD   = 50;   // 画布内边距
  const PR    = 30;   // 棋子半径
  const COLS  = 9;
  const ROWS  = 10;
  const CW    = PAD * 2 + (COLS - 1) * GRID; // 660
  const CH    = PAD * 2 + (ROWS - 1) * GRID; // 730

  // 棋子编号
  const EMPTY = 0;
  const R_KING = 1, R_ADVISOR = 2, R_ELEPHANT = 3, R_HORSE = 4;
  const R_CHARIOT = 5, R_CANNON = 6, R_SOLDIER = 7;
  const B_KING = 8, B_ADVISOR = 9, B_ELEPHANT = 10, B_HORSE = 11;
  const B_CHARIOT = 12, B_CANNON = 13, B_SOLDIER = 14;

  // 棋子中文名
  const PIECE_CHAR = {
    [R_KING]: '帅', [R_ADVISOR]: '仕', [R_ELEPHANT]: '相',
    [R_HORSE]: '马', [R_CHARIOT]: '车', [R_CANNON]: '炮', [R_SOLDIER]: '兵',
    [B_KING]: '将', [B_ADVISOR]: '士', [B_ELEPHANT]: '象',
    [B_HORSE]: '马', [B_CHARIOT]: '车', [B_CANNON]: '炮', [B_SOLDIER]: '卒'
  };

  // AI 估值 - 棋子基础分
  const PIECE_VAL = {
    [R_KING]: 10000, [R_ADVISOR]: 120, [R_ELEPHANT]: 120,
    [R_HORSE]: 300,  [R_CHARIOT]: 600, [R_CANNON]: 300, [R_SOLDIER]: 30,
    [B_KING]: 10000, [B_ADVISOR]: 120, [B_ELEPHANT]: 120,
    [B_HORSE]: 300,  [B_CHARIOT]: 600, [B_CANNON]: 300, [B_SOLDIER]: 30
  };

  // 初始棋盘 (row 0=顶部黑方, row 9=底部红方)
  const INIT_BOARD = [
    [B_CHARIOT, B_HORSE, B_ELEPHANT, B_ADVISOR, B_KING, B_ADVISOR, B_ELEPHANT, B_HORSE, B_CHARIOT],
    [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
    [EMPTY, B_CANNON, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, B_CANNON, EMPTY],
    [B_SOLDIER, EMPTY, B_SOLDIER, EMPTY, B_SOLDIER, EMPTY, B_SOLDIER, EMPTY, B_SOLDIER],
    [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
    [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
    [R_SOLDIER, EMPTY, R_SOLDIER, EMPTY, R_SOLDIER, EMPTY, R_SOLDIER, EMPTY, R_SOLDIER],
    [EMPTY, R_CANNON, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, R_CANNON, EMPTY],
    [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
    [R_CHARIOT, R_HORSE, R_ELEPHANT, R_ADVISOR, R_KING, R_ADVISOR, R_ELEPHANT, R_HORSE, R_CHARIOT]
  ];

  // 马的移动偏移量及蹩脚位
  const HORSE_MOVES = [
    { dc: -1, dr: -2, bc: 0, br: -1 },
    { dc:  1, dr: -2, bc: 0, br: -1 },
    { dc:  2, dr: -1, bc: 1, br:  0 },
    { dc:  2, dr:  1, bc: 1, br:  0 },
    { dc:  1, dr:  2, bc: 0, br:  1 },
    { dc: -1, dr:  2, bc: 0, br:  1 },
    { dc: -2, dr:  1, bc:-1, br:  0 },
    { dc: -2, dr: -1, bc:-1, br:  0 }
  ];

  // 象的移动偏移量及塞象眼位
  const ELEPHANT_MOVES = [
    { dc: -2, dr: -2, bc: -1, br: -1 },
    { dc:  2, dr: -2, bc:  1, br: -1 },
    { dc: -2, dr:  2, bc: -1, br:  1 },
    { dc:  2, dr:  2, bc:  1, br:  1 }
  ];

  // 星位标记位置
  const STAR_POS = [
    [1, 2], [7, 2], [1, 7], [7, 7],
    [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
    [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]
  ];

  // ===================== 工具函数 =====================
  function isRed(p)   { return p >= 1 && p <= 7; }
  function isBlack(p) { return p >= 8 && p <= 14; }
  function colorOf(p) { return isRed(p) ? 'red' : isBlack(p) ? 'black' : null; }
  function isEnemy(a, b) { return (isRed(a) && isBlack(b)) || (isBlack(a) && isRed(b)); }
  function isFriend(a, b) { return a && b && !isEnemy(a, b); }
  function opposite(c) { return c === 'red' ? 'black' : 'red'; }
  function onBoard(c, r) { return c >= 0 && c <= 8 && r >= 0 && r <= 9; }
  function pieceType(p) { return p <= 7 ? p : p - 7; } // 归一化 1~7
  function bToP(col, row) { return { x: PAD + col * GRID, y: PAD + row * GRID }; }
  function centerBonus(col) { return (4 - Math.abs(col - 4)) * 2; }
  function cloneBoard(b) { return b.map(r => r.slice()); }

  function findKing(board, color) {
    const k = color === 'red' ? R_KING : B_KING;
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 9; c++)
        if (board[r][c] === k) return { col: c, row: r };
    return null;
  }

  // ===================== 走法生成 =====================
  function getRawMoves(board, col, row) {
    const p = board[row][col];
    if (p === EMPTY) return [];
    const t = pieceType(p);
    switch (t) {
      case 1: return kingMoves(board, col, row, p);
      case 2: return advisorMoves(board, col, row, p);
      case 3: return elephantMoves(board, col, row, p);
      case 4: return horseMoves(board, col, row, p);
      case 5: return chariotMoves(board, col, row, p);
      case 6: return cannonMoves(board, col, row, p);
      case 7: return soldierMoves(board, col, row, p);
      default: return [];
    }
  }

  function addIf(moves, board, nc, nr, piece) {
    if (!onBoard(nc, nr)) return;
    const t = board[nr][nc];
    if (t === EMPTY || isEnemy(piece, t)) moves.push({ col: nc, row: nr });
  }

  function kingMoves(board, col, row, p) {
    const moves = [];
    const red = isRed(p);
    const rMin = red ? 7 : 0, rMax = red ? 9 : 2;
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nc = col + dc, nr = row + dr;
      if (nc >= 3 && nc <= 5 && nr >= rMin && nr <= rMax)
        addIf(moves, board, nc, nr, p);
    }
    return moves;
  }

  function advisorMoves(board, col, row, p) {
    const moves = [];
    const red = isRed(p);
    const rMin = red ? 7 : 0, rMax = red ? 9 : 2;
    for (const [dc, dr] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nc = col + dc, nr = row + dr;
      if (nc >= 3 && nc <= 5 && nr >= rMin && nr <= rMax)
        addIf(moves, board, nc, nr, p);
    }
    return moves;
  }

  function elephantMoves(board, col, row, p) {
    const moves = [];
    const red = isRed(p);
    for (const em of ELEPHANT_MOVES) {
      const nc = col + em.dc, nr = row + em.dr;
      if (!onBoard(nc, nr)) continue;
      if (red && nr < 5) continue;   // 红象不过河
      if (!red && nr > 4) continue;  // 黑象不过河
      if (board[row + em.br][col + em.bc] !== EMPTY) continue; // 塞象眼
      addIf(moves, board, nc, nr, p);
    }
    return moves;
  }

  function horseMoves(board, col, row, p) {
    const moves = [];
    for (const hm of HORSE_MOVES) {
      const nc = col + hm.dc, nr = row + hm.dr;
      if (!onBoard(nc, nr)) continue;
      if (board[row + hm.br][col + hm.bc] !== EMPTY) continue; // 蹩马腿
      addIf(moves, board, nc, nr, p);
    }
    return moves;
  }

  function chariotMoves(board, col, row, p) {
    const moves = [];
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      let c = col + dc, r = row + dr;
      while (onBoard(c, r)) {
        const t = board[r][c];
        if (t === EMPTY) { moves.push({ col: c, row: r }); }
        else { if (isEnemy(p, t)) moves.push({ col: c, row: r }); break; }
        c += dc; r += dr;
      }
    }
    return moves;
  }

  function cannonMoves(board, col, row, p) {
    const moves = [];
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      let c = col + dc, r = row + dr;
      let jumped = false;
      while (onBoard(c, r)) {
        const t = board[r][c];
        if (!jumped) {
          if (t === EMPTY) moves.push({ col: c, row: r });
          else jumped = true; // 找到炮架
        } else {
          if (t !== EMPTY) {
            if (isEnemy(p, t)) moves.push({ col: c, row: r });
            break;
          }
        }
        c += dc; r += dr;
      }
    }
    return moves;
  }

  function soldierMoves(board, col, row, p) {
    const moves = [];
    const red = isRed(p);
    const fwd = red ? -1 : 1;
    addIf(moves, board, col, row + fwd, p);
    const crossed = red ? row <= 4 : row >= 5;
    if (crossed) {
      addIf(moves, board, col - 1, row, p);
      addIf(moves, board, col + 1, row, p);
    }
    return moves;
  }

  // ===================== 将军检测 (高效版) =====================
  function isInCheck(board, color) {
    const kp = findKing(board, color);
    if (!kp) return true;
    const kc = kp.col, kr = kp.row;
    const red = color === 'red';
    const eChariot = red ? B_CHARIOT : R_CHARIOT;
    const eCannon  = red ? B_CANNON  : R_CANNON;
    const eHorse   = red ? B_HORSE   : R_HORSE;
    const eKing    = red ? B_KING    : R_KING;
    const eSoldier = red ? B_SOLDIER : R_SOLDIER;

    // 1. 车 / 将帅对脸 / 炮 —— 四个方向扫描
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      let cnt = 0, c = kc + dc, r = kr + dr;
      while (onBoard(c, r)) {
        const t = board[r][c];
        if (t !== EMPTY) {
          if (cnt === 0) {
            if (t === eChariot || t === eKing) return true;
            cnt++;
          } else {
            if (t === eCannon) return true;
            break;
          }
        }
        c += dc; r += dr;
      }
    }

    // 2. 马威胁
    for (const hm of HORSE_MOVES) {
      const hc = kc - hm.dc, hr = kr - hm.dr;
      if (!onBoard(hc, hr)) continue;
      if (board[hr][hc] !== eHorse) continue;
      // 验证马腿: 马从 (hc,hr)→(kc,kr), 根据偏移判断阻挡位
      const dx = hm.dc, dy = hm.dr; // kc-hc, kr-hr
      let blkC, blkR;
      if (Math.abs(dy) > Math.abs(dx)) { blkC = hc; blkR = hr + Math.sign(dy); }
      else { blkC = hc + Math.sign(dx); blkR = hr; }
      if (board[blkR][blkC] === EMPTY) return true;
    }

    // 3. 兵/卒威胁
    if (red) {
      // 黑卒攻击红帅
      if (kr > 0 && board[kr - 1][kc] === eSoldier) return true;
      if (kc > 0 && board[kr][kc - 1] === eSoldier && kr >= 5) return true;
      if (kc < 8 && board[kr][kc + 1] === eSoldier && kr >= 5) return true;
    } else {
      // 红兵攻击黑将
      if (kr < 9 && board[kr + 1][kc] === eSoldier) return true;
      if (kc > 0 && board[kr][kc - 1] === eSoldier && kr <= 4) return true;
      if (kc < 8 && board[kr][kc + 1] === eSoldier && kr <= 4) return true;
    }

    return false;
  }

  // ===================== 合法性检测 =====================
  function isMoveLegal(board, fc, fr, tc, tr) {
    const piece = board[fr][fc];
    const captured = board[tr][tc];
    const color = colorOf(piece);
    board[tr][tc] = piece;
    board[fr][fc] = EMPTY;
    const legal = !isInCheck(board, color);
    board[fr][fc] = piece;
    board[tr][tc] = captured;
    return legal;
  }

  function getValidMoves(board, col, row) {
    const raw = getRawMoves(board, col, row);
    return raw.filter(m => isMoveLegal(board, col, row, m.col, m.row));
  }

  function getAllValidMoves(board, color) {
    const moves = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] !== EMPTY && colorOf(board[r][c]) === color) {
          const vm = getValidMoves(board, c, r);
          for (const m of vm) {
            moves.push({ fromCol: c, fromRow: r, toCol: m.col, toRow: m.row });
          }
        }
      }
    }
    return moves;
  }

  // ===================== AI (Negamax + Alpha-Beta) =====================
  const AI_DEPTH = 3;

  function evaluate(board) {
    let score = 0;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p === EMPTY) continue;
        let v = PIECE_VAL[p];
        // 位置加分
        switch (p) {
          case R_SOLDIER: if (r <= 4) v += 40 + (4 - r) * 10 + centerBonus(c); break;
          case B_SOLDIER: if (r >= 5) v += 40 + (r - 5) * 10 + centerBonus(c); break;
          case R_HORSE: case B_HORSE: v += centerBonus(c) * 3; break;
          case R_CHARIOT: if (r <= 4) v += 15; break;
          case B_CHARIOT: if (r >= 5) v += 15; break;
          case R_CANNON: case B_CANNON: v += centerBonus(c); break;
        }
        score += isRed(p) ? v : -v;
      }
    }
    return score; // 正值对红方有利
  }

  function negamax(board, depth, alpha, beta, color) {
    if (depth === 0) {
      const e = evaluate(board);
      return color === 'red' ? e : -e;
    }
    const moves = getAllValidMoves(board, color);
    if (moves.length === 0) return -99999 + (AI_DEPTH - depth);

    // 走法排序：吃子优先
    moves.sort((a, b) => {
      const va = board[a.toRow][a.toCol] !== EMPTY ? (PIECE_VAL[board[a.toRow][a.toCol]] || 0) : 0;
      const vb = board[b.toRow][b.toCol] !== EMPTY ? (PIECE_VAL[board[b.toRow][b.toCol]] || 0) : 0;
      return vb - va;
    });

    let best = -Infinity;
    for (const mv of moves) {
      const cap = board[mv.toRow][mv.toCol];
      board[mv.toRow][mv.toCol] = board[mv.fromRow][mv.fromCol];
      board[mv.fromRow][mv.fromCol] = EMPTY;
      const s = -negamax(board, depth - 1, -beta, -alpha, opposite(color));
      board[mv.fromRow][mv.fromCol] = board[mv.toRow][mv.toCol];
      board[mv.toRow][mv.toCol] = cap;
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }

  function getBestMove(board, aiColor) {
    const moves = getAllValidMoves(board, aiColor);
    if (moves.length === 0) return null;
    moves.sort((a, b) => {
      const va = board[a.toRow][a.toCol] !== EMPTY ? (PIECE_VAL[board[a.toRow][a.toCol]] || 0) : 0;
      const vb = board[b.toRow][b.toCol] !== EMPTY ? (PIECE_VAL[board[b.toRow][b.toCol]] || 0) : 0;
      return vb - va;
    });
    let bestScore = -Infinity;
    let bestMoves = [moves[0]];
    for (const mv of moves) {
      const cap = board[mv.toRow][mv.toCol];
      board[mv.toRow][mv.toCol] = board[mv.fromRow][mv.fromCol];
      board[mv.fromRow][mv.fromCol] = EMPTY;
      const s = -negamax(board, AI_DEPTH - 1, -Infinity, Infinity, opposite(aiColor));
      board[mv.fromRow][mv.fromCol] = board[mv.toRow][mv.toCol];
      board[mv.toRow][mv.toCol] = cap;
      if (s > bestScore) { bestScore = s; bestMoves = [mv]; }
      else if (s === bestScore) bestMoves.push(mv);
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  // ===================== 游戏 UI 类 =====================
  class ChineseChess {
    constructor() {
      this.canvas = document.getElementById('chessBoard');
      this.ctx    = this.canvas.getContext('2d');
      this.board  = [];
      this.turn   = 'red';
      this.sel    = null;       // { col, row }
      this.validM = [];         // 当前选中棋子的合法走法
      this.history = [];        // 走棋历史
      this.lastMove = null;     // 上一步
      this.gameOver = false;
      this.aiOn   = false;
      this.aiColor = 'black';
      this.redCaptured = [];    // 红方吃掉的子
      this.blackCaptured = [];  // 黑方吃掉的子
      this.init();
    }

    init() {
      this.resetGame();
      this.bindEvents();
    }

    resetGame() {
      this.board = INIT_BOARD.map(r => r.slice());
      this.turn = 'red';
      this.sel = null;
      this.validM = [];
      this.history = [];
      this.lastMove = null;
      this.gameOver = false;
      this.redCaptured = [];
      this.blackCaptured = [];
      this.updateCaptured();
      document.getElementById('moveList').innerHTML = '';
      this.setStatus('红方先行');
      this.render();
    }

    bindEvents() {
      this.canvas.addEventListener('click', e => this.onClick(e));
      document.getElementById('newGame').addEventListener('click', () => this.resetGame());
      document.getElementById('undoMove').addEventListener('click', () => this.undo());
      document.getElementById('toggleAI').addEventListener('click', () => this.toggleAI());
    }

    // ---- 渲染 ----
    render() {
      this.drawBoard();
      this.drawLastMove();
      this.drawSelection();
      this.drawValidMoves();
      this.drawPieces();
    }

    drawBoard() {
      const ctx = this.ctx;
      // 背景
      ctx.fillStyle = '#f0d9a8';
      ctx.fillRect(0, 0, CW, CH);

      ctx.strokeStyle = '#4a3728';
      ctx.lineWidth = 2;

      // 外框
      ctx.strokeRect(PAD - 3, PAD - 3, (COLS - 1) * GRID + 6, (ROWS - 1) * GRID + 6);

      ctx.lineWidth = 1;
      ctx.strokeStyle = '#4a3728';

      // 横线
      for (let r = 0; r < ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(PAD, PAD + r * GRID);
        ctx.lineTo(PAD + 8 * GRID, PAD + r * GRID);
        ctx.stroke();
      }
      // 竖线 (河界中断)
      for (let c = 0; c < COLS; c++) {
        if (c === 0 || c === 8) {
          ctx.beginPath();
          ctx.moveTo(PAD + c * GRID, PAD);
          ctx.lineTo(PAD + c * GRID, PAD + 9 * GRID);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(PAD + c * GRID, PAD);
          ctx.lineTo(PAD + c * GRID, PAD + 4 * GRID);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(PAD + c * GRID, PAD + 5 * GRID);
          ctx.lineTo(PAD + c * GRID, PAD + 9 * GRID);
          ctx.stroke();
        }
      }

      // 九宫斜线
      ctx.beginPath();
      ctx.moveTo(PAD + 3 * GRID, PAD);
      ctx.lineTo(PAD + 5 * GRID, PAD + 2 * GRID);
      ctx.moveTo(PAD + 5 * GRID, PAD);
      ctx.lineTo(PAD + 3 * GRID, PAD + 2 * GRID);
      ctx.moveTo(PAD + 3 * GRID, PAD + 7 * GRID);
      ctx.lineTo(PAD + 5 * GRID, PAD + 9 * GRID);
      ctx.moveTo(PAD + 5 * GRID, PAD + 7 * GRID);
      ctx.lineTo(PAD + 3 * GRID, PAD + 9 * GRID);
      ctx.stroke();

      // 河界文字
      ctx.save();
      ctx.font = 'bold 30px "KaiTi", "STKaiti", "楷体", serif';
      ctx.fillStyle = '#6b4e2a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ry = PAD + 4.5 * GRID;
      ctx.fillText('楚 河', PAD + 2 * GRID, ry);
      ctx.fillText('汉 界', PAD + 6 * GRID, ry);
      ctx.restore();

      // 星位标记
      for (const [sc, sr] of STAR_POS) this.drawStar(sc, sr);
    }

    drawStar(col, row) {
      const ctx = this.ctx;
      const { x, y } = bToP(col, row);
      const d = 5, len = 12;
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#4a3728';
      const segments = [];
      if (col > 0) {
        segments.push([x - d, y - d, x - d - len, y - d], [x - d, y - d, x - d, y - d - len]);
        segments.push([x - d, y + d, x - d - len, y + d], [x - d, y + d, x - d, y + d + len]);
      }
      if (col < 8) {
        segments.push([x + d, y - d, x + d + len, y - d], [x + d, y - d, x + d, y - d - len]);
        segments.push([x + d, y + d, x + d + len, y + d], [x + d, y + d, x + d, y + d + len]);
      }
      for (const [x1, y1, x2, y2] of segments) {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }

    drawPieces() {
      for (let r = 0; r < 10; r++)
        for (let c = 0; c < 9; c++)
          if (this.board[r][c] !== EMPTY) this.drawPiece(c, r, this.board[r][c]);
    }

    drawPiece(col, row, piece) {
      const ctx = this.ctx;
      const { x, y } = bToP(col, row);
      const r = PR;
      const red = isRed(piece);
      const clr = red ? '#b5202a' : '#1a1a2e';

      // 阴影
      ctx.beginPath();
      ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fill();

      // 棋子底色渐变
      const grad = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, r);
      grad.addColorStop(0, '#fff8dc');
      grad.addColorStop(0.7, '#eed9a4');
      grad.addColorStop(1, '#d4b877');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // 外圈
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = clr;
      ctx.stroke();

      // 内圈
      ctx.beginPath();
      ctx.arc(x, y, r - 5, 0, Math.PI * 2);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = clr;
      ctx.stroke();

      // 文字
      ctx.font = `bold ${r + 2}px "KaiTi","STKaiti","楷体","SimSun",serif`;
      ctx.fillStyle = clr;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PIECE_CHAR[piece], x, y + 1);
    }

    drawSelection() {
      if (!this.sel) return;
      const ctx = this.ctx;
      const { x, y } = bToP(this.sel.col, this.sel.row);
      ctx.save();
      ctx.shadowColor = 'rgba(255,215,0,0.8)';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(x, y, PR + 3, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffd700';
      ctx.stroke();
      ctx.restore();
    }

    drawValidMoves() {
      const ctx = this.ctx;
      for (const m of this.validM) {
        const { x, y } = bToP(m.col, m.row);
        const isCapture = this.board[m.row][m.col] !== EMPTY;
        if (isCapture) {
          ctx.beginPath();
          ctx.arc(x, y, PR + 2, 0, Math.PI * 2);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = 'rgba(220,50,50,0.55)';
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,180,80,0.45)';
          ctx.fill();
        }
      }
    }

    drawLastMove() {
      if (!this.lastMove) return;
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(255, 255, 100, 0.25)';
      for (const pos of [
        { col: this.lastMove.fromCol, row: this.lastMove.fromRow },
        { col: this.lastMove.toCol, row: this.lastMove.toRow }
      ]) {
        const { x, y } = bToP(pos.col, pos.row);
        ctx.fillRect(x - GRID / 2 + 2, y - GRID / 2 + 2, GRID - 4, GRID - 4);
      }
    }

    // ---- 交互 ----
    onClick(e) {
      if (this.gameOver) return;
      if (this.aiOn && this.turn === this.aiColor) return;

      const rect = this.canvas.getBoundingClientRect();
      const sx = this.canvas.width / rect.width;
      const sy = this.canvas.height / rect.height;
      const px = (e.clientX - rect.left) * sx;
      const py = (e.clientY - rect.top) * sy;

      const col = Math.round((px - PAD) / GRID);
      const row = Math.round((py - PAD) / GRID);
      if (!onBoard(col, row)) return;
      const { x, y } = bToP(col, row);
      if (Math.hypot(px - x, py - y) > PR + 8) return;

      const piece = this.board[row][col];

      // 已有选中 → 尝试走子
      if (this.sel) {
        if (this.sel.col === col && this.sel.row === row) {
          this.sel = null; this.validM = []; this.render(); return;
        }
        // 点击自己的子 → 重新选中
        if (piece !== EMPTY && colorOf(piece) === this.turn) {
          this.selectPiece(col, row); return;
        }
        // 尝试走到目标位置
        if (this.validM.some(m => m.col === col && m.row === row)) {
          this.executeMove(this.sel.col, this.sel.row, col, row);
          return;
        }
        // 非法位置 → 取消选择
        this.sel = null; this.validM = []; this.render();
        return;
      }

      // 没有选中 → 选择己方棋子
      if (piece !== EMPTY && colorOf(piece) === this.turn) {
        this.selectPiece(col, row);
      }
    }

    selectPiece(col, row) {
      this.sel = { col, row };
      this.validM = getValidMoves(this.board, col, row);
      this.render();
    }

    executeMove(fc, fr, tc, tr) {
      const piece = this.board[fr][fc];
      const captured = this.board[tr][tc];
      const moveRec = {
        fromCol: fc, fromRow: fr, toCol: tc, toRow: tr,
        piece, captured, turn: this.turn
      };
      this.history.push(moveRec);

      // 记录吃子
      if (captured !== EMPTY) {
        if (this.turn === 'red') this.redCaptured.push(captured);
        else this.blackCaptured.push(captured);
        this.updateCaptured();
      }

      this.board[tr][tc] = piece;
      this.board[fr][fc] = EMPTY;
      this.lastMove = moveRec;
      this.sel = null;
      this.validM = [];

      this.addMoveRecord(moveRec);

      // 切换回合并检查胜负
      this.turn = opposite(this.turn);
      const allMoves = getAllValidMoves(this.board, this.turn);
      const inChk = isInCheck(this.board, this.turn);

      if (allMoves.length === 0) {
        this.gameOver = true;
        const winner = opposite(this.turn);
        this.setStatus((winner === 'red' ? '红方' : '黑方') + '获胜！');
        this.render();
        return;
      }
      if (inChk) {
        this.setStatus((this.turn === 'red' ? '红方' : '黑方') + '被将军！');
      } else {
        this.setStatus((this.turn === 'red' ? '红方' : '黑方') + '走棋');
      }

      this.render();

      // AI走棋
      if (this.aiOn && this.turn === this.aiColor && !this.gameOver) {
        setTimeout(() => this.doAIMove(), 100);
      }
    }

    undo() {
      if (this.history.length === 0) return;
      // AI模式下悔两步
      const steps = (this.aiOn && this.history.length >= 2) ? 2 : 1;
      for (let i = 0; i < steps && this.history.length > 0; i++) {
        const mv = this.history.pop();
        this.board[mv.fromRow][mv.fromCol] = mv.piece;
        this.board[mv.toRow][mv.toCol] = mv.captured;
        this.turn = mv.turn;
        if (mv.captured !== EMPTY) {
          if (mv.turn === 'red') this.redCaptured.pop();
          else this.blackCaptured.pop();
        }
      }
      this.updateCaptured();
      this.lastMove = this.history.length > 0 ? this.history[this.history.length - 1] : null;
      this.sel = null;
      this.validM = [];
      this.gameOver = false;
      this.setStatus((this.turn === 'red' ? '红方' : '黑方') + '走棋');
      this.rebuildMoveList();
      this.render();
    }

    toggleAI() {
      this.aiOn = !this.aiOn;
      const btn = document.getElementById('toggleAI');
      if (this.aiOn) {
        btn.textContent = '关闭AI';
        btn.classList.add('active');
        if (this.turn === this.aiColor && !this.gameOver) {
          setTimeout(() => this.doAIMove(), 200);
        }
      } else {
        btn.textContent = '人机对战';
        btn.classList.remove('active');
      }
    }

    doAIMove() {
      if (this.gameOver || this.turn !== this.aiColor) return;
      const mv = getBestMove(this.board, this.aiColor);
      if (mv) this.executeMove(mv.fromCol, mv.fromRow, mv.toCol, mv.toRow);
    }

    // ---- 辅助 ----
    setStatus(msg) {
      document.getElementById('status').textContent = msg;
    }

    updateCaptured() {
      const toStr = arr => arr.map(p => PIECE_CHAR[p]).join(' ');
      const rc = document.getElementById('redCaptured');
      const bc = document.getElementById('blackCaptured');
      if (rc) rc.textContent = toStr(this.redCaptured);
      if (bc) bc.textContent = toStr(this.blackCaptured);
    }

    addMoveRecord(mv) {
      const list = document.getElementById('moveList');
      const div = document.createElement('div');
      const isRd = mv.turn === 'red';
      div.className = 'move-item ' + (isRd ? 'move-red' : 'move-black');
      const idx = this.history.length;
      const label = isRd ? '红' : '黑';
      const name = PIECE_CHAR[mv.piece];
      const capStr = mv.captured !== EMPTY ? ' 吃' + PIECE_CHAR[mv.captured] : '';
      div.textContent = `${idx}. ${label}${name} (${mv.fromCol},${mv.fromRow})→(${mv.toCol},${mv.toRow})${capStr}`;
      list.appendChild(div);
      list.scrollTop = list.scrollHeight;
    }

    rebuildMoveList() {
      const list = document.getElementById('moveList');
      list.innerHTML = '';
      for (let i = 0; i < this.history.length; i++) {
        const mv = this.history[i];
        const div = document.createElement('div');
        const isRd = mv.turn === 'red';
        div.className = 'move-item ' + (isRd ? 'move-red' : 'move-black');
        const label = isRd ? '红' : '黑';
        const name = PIECE_CHAR[mv.piece];
        const capStr = mv.captured !== EMPTY ? ' 吃' + PIECE_CHAR[mv.captured] : '';
        div.textContent = `${i + 1}. ${label}${name} (${mv.fromCol},${mv.fromRow})→(${mv.toCol},${mv.toRow})${capStr}`;
        list.appendChild(div);
      }
      list.scrollTop = list.scrollHeight;
    }
  }

  // ===================== 启动 =====================
  document.addEventListener('DOMContentLoaded', () => { new ChineseChess(); });

})();

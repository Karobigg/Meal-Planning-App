const PIECE_SYMBOLS = {
    wP: "♙", wR: "♖", wN: "♘", wB: "♗", wQ: "♕", wK: "♔",
    bP: "♟", bR: "♜", bN: "♞", bB: "♝", bQ: "♛", bK: "♚"
};

const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
const AI_DEPTH = 3;

class GameState {
    constructor(board, turn, castling, enPassant, halfmove, fullmove) {
        this.board = board;
        this.turn = turn;
        this.castling = { ...castling };
        this.enPassant = enPassant;
        this.halfmove = halfmove;
        this.fullmove = fullmove;
        this.history = [];
    }

    static initial() {
        return GameState.fromFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    }

    static fromFEN(fen) {
        const [piecePlacement, activeColor, castling, enPassant, halfmove, fullmove] = fen.split(" ");
        const rows = piecePlacement.split("/");
        const board = Array.from({ length: 8 }, () => Array(8).fill(null));
        rows.forEach((row, rIndex) => {
            let c = 0;
            for (const ch of row) {
                if (Number.isInteger(Number(ch))) {
                    c += Number(ch);
                } else {
                    const color = ch === ch.toUpperCase() ? "w" : "b";
                    const piece = ch.toUpperCase();
                    board[rIndex][c] = { color, type: piece };
                    c += 1;
                }
            }
        });
        const castlingRights = {
            wK: castling.includes("K"),
            wQ: castling.includes("Q"),
            bK: castling.includes("k"),
            bQ: castling.includes("q")
        };
        const enp = enPassant === "-" ? null : GameState.algebraicToCoord(enPassant);
        return new GameState(board, activeColor, castlingRights, enp, Number(halfmove), Number(fullmove));
    }

    clone() {
        const boardCopy = this.board.map(row => row.map(cell => (cell ? { ...cell } : null)));
        const copy = new GameState(boardCopy, this.turn, this.castling, this.enPassant ? { ...this.enPassant } : null, this.halfmove, this.fullmove);
        copy.history = [...this.history];
        return copy;
    }

    static inBounds(r, c) {
        return r >= 0 && r < 8 && c >= 0 && c < 8;
    }

    static coordToAlgebraic(coord) {
        const file = String.fromCharCode(97 + coord.c);
        const rank = 8 - coord.r;
        return `${file}${rank}`;
    }

    static algebraicToCoord(square) {
        const file = square.charCodeAt(0) - 97;
        const rank = 8 - Number(square[1]);
        return { r: rank, c: file };
    }

    toFEN() {
        const rows = this.board.map(row => {
            let fenRow = "";
            let empty = 0;
            for (const cell of row) {
                if (!cell) {
                    empty += 1;
                } else {
                    if (empty > 0) {
                        fenRow += empty;
                        empty = 0;
                    }
                    const symbol = cell.color === "w" ? cell.type : cell.type.toLowerCase();
                    fenRow += symbol;
                }
            }
            if (empty > 0) fenRow += empty;
            return fenRow;
        }).join("/");
        const castling = `${this.castling.wK ? "K" : ""}${this.castling.wQ ? "Q" : ""}${this.castling.bK ? "k" : ""}${this.castling.bQ ? "q" : ""}` || "-";
        const enp = this.enPassant ? GameState.coordToAlgebraic(this.enPassant) : "-";
        return `${rows} ${this.turn} ${castling} ${enp} ${this.halfmove} ${this.fullmove}`;
    }

    isOwnPiece(cell) {
        return cell && cell.color === this.turn;
    }

    generateMoves() {
        const moves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (!piece || piece.color !== this.turn) continue;
                moves.push(...this.generateMovesForPiece(r, c, piece));
            }
        }
        return moves.filter(m => {
            this.makeMove(m);
            const legal = !this.isInCheck(opposite(this.turn));
            this.undoMove();
            return legal;
        });
    }

    generateMovesForPiece(r, c, piece) {
        const dir = piece.color === "w" ? -1 : 1;
        const moves = [];
        const pushMove = (toR, toC, opts = {}) => {
            moves.push({
                from: { r, c },
                to: { r: toR, c: toC },
                piece: { ...piece },
                captured: opts.captured || null,
                promotion: opts.promotion || null,
                isCastle: opts.isCastle || false,
                isEnPassant: opts.isEnPassant || false,
                prevCastling: null,
                prevEnPassant: null,
                prevHalfmove: null,
                prevFullmove: null
            });
        };

        switch (piece.type) {
            case "P": {
                const startRank = piece.color === "w" ? 6 : 1;
                const forwardOne = { r: r + dir, c };
                if (GameState.inBounds(forwardOne.r, forwardOne.c) && !this.board[forwardOne.r][forwardOne.c]) {
                    const promoRanks = piece.color === "w" ? 0 : 7;
                    if (forwardOne.r === promoRanks) {
                        ["Q", "R", "B", "N"].forEach(promo => pushMove(forwardOne.r, forwardOne.c, { promotion: promo }));
                    } else {
                        pushMove(forwardOne.r, forwardOne.c);
                    }
                    const forwardTwo = { r: r + dir * 2, c };
                    if (r === startRank && !this.board[forwardTwo.r][forwardTwo.c]) {
                        pushMove(forwardTwo.r, forwardTwo.c, { enPassantTarget: { r: r + dir, c } });
                    }
                }
                for (const dc of [-1, 1]) {
                    const target = { r: r + dir, c: c + dc };
                    if (!GameState.inBounds(target.r, target.c)) continue;
                    const targetPiece = this.board[target.r][target.c];
                    if (targetPiece && targetPiece.color !== piece.color) {
                        const promoRanks = piece.color === "w" ? 0 : 7;
                        if (target.r === promoRanks) {
                            ["Q", "R", "B", "N"].forEach(promo => pushMove(target.r, target.c, { promotion: promo, captured: { ...targetPiece } }));
                        } else {
                            pushMove(target.r, target.c, { captured: { ...targetPiece } });
                        }
                    }
                    if (this.enPassant && this.enPassant.r === target.r && this.enPassant.c === target.c) {
                        const capturedPawn = { ...this.board[r][target.c] };
                        pushMove(target.r, target.c, { isEnPassant: true, captured: capturedPawn });
                    }
                }
                break;
            }
            case "N": {
                const jumps = [
                    [2, 1], [2, -1], [-2, 1], [-2, -1],
                    [1, 2], [1, -2], [-1, 2], [-1, -2]
                ];
                for (const [dr, dc] of jumps) {
                    const nr = r + dr, nc = c + dc;
                    if (!GameState.inBounds(nr, nc)) continue;
                    const target = this.board[nr][nc];
                    if (!target || target.color !== piece.color) {
                        pushMove(nr, nc, { captured: target ? { ...target } : null });
                    }
                }
                break;
            }
            case "B":
            case "R":
            case "Q": {
                const directions = [];
                if (piece.type !== "B") directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
                if (piece.type !== "R") directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
                for (const [dr, dc] of directions) {
                    let nr = r + dr, nc = c + dc;
                    while (GameState.inBounds(nr, nc)) {
                        const target = this.board[nr][nc];
                        if (!target) {
                            pushMove(nr, nc);
                        } else {
                            if (target.color !== piece.color) {
                                pushMove(nr, nc, { captured: { ...target } });
                            }
                            break;
                        }
                        nr += dr; nc += dc;
                    }
                }
                break;
            }
            case "K": {
                const deltas = [
                    [1, 0], [-1, 0], [0, 1], [0, -1],
                    [1, 1], [1, -1], [-1, 1], [-1, -1]
                ];
                for (const [dr, dc] of deltas) {
                    const nr = r + dr, nc = c + dc;
                    if (!GameState.inBounds(nr, nc)) continue;
                    const target = this.board[nr][nc];
                    if (!target || target.color !== piece.color) {
                        pushMove(nr, nc, { captured: target ? { ...target } : null });
                    }
                }
                if (piece.color === "w" && r === 7 && c === 4) {
                    if (this.castling.wK && !this.board[7][5] && !this.board[7][6]) {
                        if (!this.isSquareAttacked({ r: 7, c: 4 }, "b") && !this.isSquareAttacked({ r: 7, c: 5 }, "b") && !this.isSquareAttacked({ r: 7, c: 6 }, "b")) {
                            pushMove(7, 6, { isCastle: true });
                        }
                    }
                    if (this.castling.wQ && !this.board[7][3] && !this.board[7][2] && !this.board[7][1]) {
                        if (!this.isSquareAttacked({ r: 7, c: 4 }, "b") && !this.isSquareAttacked({ r: 7, c: 3 }, "b") && !this.isSquareAttacked({ r: 7, c: 2 }, "b")) {
                            pushMove(7, 2, { isCastle: true });
                        }
                    }
                }
                if (piece.color === "b" && r === 0 && c === 4) {
                    if (this.castling.bK && !this.board[0][5] && !this.board[0][6]) {
                        if (!this.isSquareAttacked({ r: 0, c: 4 }, "w") && !this.isSquareAttacked({ r: 0, c: 5 }, "w") && !this.isSquareAttacked({ r: 0, c: 6 }, "w")) {
                            pushMove(0, 6, { isCastle: true });
                        }
                    }
                    if (this.castling.bQ && !this.board[0][3] && !this.board[0][2] && !this.board[0][1]) {
                        if (!this.isSquareAttacked({ r: 0, c: 4 }, "w") && !this.isSquareAttacked({ r: 0, c: 3 }, "w") && !this.isSquareAttacked({ r: 0, c: 2 }, "w")) {
                            pushMove(0, 2, { isCastle: true });
                        }
                    }
                }
                break;
            }
        }
        return moves;
    }

    isSquareAttacked(square, byColor) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (!piece || piece.color !== byColor) continue;
                const moves = this.pseudoMovesForAttack(r, c, piece);
                if (moves.some(m => m.r === square.r && m.c === square.c)) return true;
            }
        }
        return false;
    }

    pseudoMovesForAttack(r, c, piece) {
        const dir = piece.color === "w" ? -1 : 1;
        const targets = [];
        switch (piece.type) {
            case "P":
                for (const dc of [-1, 1]) {
                    const nr = r + dir, nc = c + dc;
                    if (GameState.inBounds(nr, nc)) targets.push({ r: nr, c: nc });
                }
                break;
            case "N":
                [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(([dr, dc]) => {
                    const nr = r + dr, nc = c + dc;
                    if (GameState.inBounds(nr, nc)) targets.push({ r: nr, c: nc });
                });
                break;
            case "B":
            case "R":
            case "Q":
                {
                    const dirs = [];
                    if (piece.type !== "B") dirs.push([1,0],[-1,0],[0,1],[0,-1]);
                    if (piece.type !== "R") dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
                    for (const [dr, dc] of dirs) {
                        let nr = r + dr, nc = c + dc;
                        while (GameState.inBounds(nr, nc)) {
                            targets.push({ r: nr, c: nc });
                            if (this.board[nr][nc]) break;
                            nr += dr; nc += dc;
                        }
                    }
                }
                break;
            case "K":
                [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr, dc]) => {
                    const nr = r + dr, nc = c + dc;
                    if (GameState.inBounds(nr, nc)) targets.push({ r: nr, c: nc });
                });
                break;
        }
        return targets;
    }

    makeMove(move) {
        move.prevCastling = { ...this.castling };
        move.prevEnPassant = this.enPassant ? { ...this.enPassant } : null;
        move.prevHalfmove = this.halfmove;
        move.prevFullmove = this.fullmove;

        const { from, to, isCastle, isEnPassant, promotion } = move;
        const piece = this.board[from.r][from.c];
        this.board[from.r][from.c] = null;

        if (isCastle) {
            if (to.c === 6) {
                const rook = this.board[to.r][7];
                this.board[to.r][5] = rook;
                this.board[to.r][7] = null;
            } else {
                const rook = this.board[to.r][0];
                this.board[to.r][3] = rook;
                this.board[to.r][0] = null;
            }
        }

        if (isEnPassant) {
            const dir = piece.color === "w" ? 1 : -1;
            this.board[to.r + dir][to.c] = null;
        }

        const movedPiece = promotion ? { color: piece.color, type: promotion } : piece;
        this.board[to.r][to.c] = movedPiece;

        this.enPassant = null;
        if (piece.type === "P" && Math.abs(to.r - from.r) === 2) {
            this.enPassant = { r: (to.r + from.r) / 2, c: to.c };
        }

        if (piece.type === "K") {
            if (piece.color === "w") {
                this.castling.wK = false; this.castling.wQ = false;
            } else {
                this.castling.bK = false; this.castling.bQ = false;
            }
        }
        if (piece.type === "R") {
            if (from.r === 7 && from.c === 0) this.castling.wQ = false;
            if (from.r === 7 && from.c === 7) this.castling.wK = false;
            if (from.r === 0 && from.c === 0) this.castling.bQ = false;
            if (from.r === 0 && from.c === 7) this.castling.bK = false;
        }
        if (move.captured && move.captured.type === "R") {
            if (to.r === 7 && to.c === 0) this.castling.wQ = false;
            if (to.r === 7 && to.c === 7) this.castling.wK = false;
            if (to.r === 0 && to.c === 0) this.castling.bQ = false;
            if (to.r === 0 && to.c === 7) this.castling.bK = false;
        }

        this.halfmove = (piece.type === "P" || move.captured) ? 0 : this.halfmove + 1;
        if (this.turn === "b") this.fullmove += 1;
        this.turn = opposite(this.turn);
        this.history.push(move);
    }

    undoMove() {
        const move = this.history.pop();
        if (!move) return;
        const { from, to, isCastle, isEnPassant } = move;
        const piece = this.board[to.r][to.c];
        this.board[from.r][from.c] = { ...piece, type: move.piece.type };
        this.board[to.r][to.c] = null;

        if (isCastle) {
            if (to.c === 6) {
                this.board[to.r][7] = this.board[to.r][5];
                this.board[to.r][5] = null;
            } else {
                this.board[to.r][0] = this.board[to.r][3];
                this.board[to.r][3] = null;
            }
        }

        if (isEnPassant) {
            const dir = piece.color === "w" ? 1 : -1;
            this.board[to.r + dir][to.c] = move.captured;
        } else if (move.captured) {
            this.board[to.r][to.c] = move.captured;
        }

        this.castling = move.prevCastling;
        this.enPassant = move.prevEnPassant;
        this.halfmove = move.prevHalfmove;
        this.fullmove = move.prevFullmove;
        this.turn = opposite(this.turn);
    }

    isInCheck(color) {
        const kingPos = this.findKing(color);
        return this.isSquareAttacked(kingPos, opposite(color));
    }

    findKing(color) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && p.type === "K" && p.color === color) return { r, c };
            }
        }
        throw new Error("King not found");
    }

    gameStatus() {
        const moves = this.generateMoves();
        const inCheck = this.isInCheck(this.turn);
        if (moves.length === 0) {
            return inCheck ? "checkmate" : "stalemate";
        }
        return inCheck ? "check" : "ongoing";
    }
}

function opposite(color) {
    return color === "w" ? "b" : "w";
}

function evaluateBoard(game) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = game.board[r][c];
            if (!piece) continue;
            const value = PIECE_VALUES[piece.type];
            const positional = piece.type === "P" ? (piece.color === "w" ? (6 - r) : (r - 1)) * 5 : 0;
            score += (piece.color === "w" ? 1 : -1) * (value + positional);
        }
    }
    return score;
}

function minimax(game, depth, alpha, beta, maximizing) {
    if (depth === 0) return { score: evaluateBoard(game) };
    const status = game.gameStatus();
    if (status === "checkmate") return { score: maximizing ? -Infinity : Infinity };
    if (status === "stalemate") return { score: 0 };

    const moves = game.generateMoves();
    let bestMove = null;
    if (maximizing) {
        let maxEval = -Infinity;
        for (const move of moves) {
            game.makeMove(move);
            const evalResult = minimax(game, depth - 1, alpha, beta, false).score;
            game.undoMove();
            if (evalResult > maxEval) {
                maxEval = evalResult;
                bestMove = move;
            }
            alpha = Math.max(alpha, evalResult);
            if (beta <= alpha) break;
        }
        return { score: maxEval, move: bestMove };
    } else {
        let minEval = Infinity;
        for (const move of moves) {
            game.makeMove(move);
            const evalResult = minimax(game, depth - 1, alpha, beta, true).score;
            game.undoMove();
            if (evalResult < minEval) {
                minEval = evalResult;
                bestMove = move;
            }
            beta = Math.min(beta, evalResult);
            if (beta <= alpha) break;
        }
        return { score: minEval, move: bestMove };
    }
}

const boardEl = document.getElementById("board");
const turnIndicator = document.getElementById("turn-indicator");
const statusIndicator = document.getElementById("status-indicator");
const resetBtn = document.getElementById("reset-btn");
const aiMoveBtn = document.getElementById("ai-move-btn");
const saveFenBtn = document.getElementById("save-fen-btn");
const loadFenBtn = document.getElementById("load-fen-btn");
const fenInput = document.getElementById("fen-input");
const historyEl = document.getElementById("move-history");
const runTestsBtn = document.getElementById("run-tests-btn");
const testOutput = document.getElementById("test-output");

let game = GameState.initial();
let selected = null;
let legalMoves = [];
let aiThinking = false;

function initBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const square = document.createElement("div");
            square.className = `square ${(r + c) % 2 === 0 ? "light" : "dark"}`;
            square.dataset.row = r;
            square.dataset.col = c;
            square.addEventListener("click", () => onSquareClick(r, c));
            boardEl.appendChild(square);
        }
    }
    render();
}

function render() {
    const allMoves = game.generateMoves();
    const status = game.gameStatus();
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const idx = r * 8 + c;
            const square = boardEl.children[idx];
            square.textContent = "";
            square.classList.remove("highlight", "move-option", "capture-option", "in-check");
            const piece = game.board[r][c];
            if (piece) {
                square.textContent = PIECE_SYMBOLS[`${piece.color}${piece.type}`];
            }
        }
    }
    if (selected) {
        const selIdx = selected.r * 8 + selected.c;
        boardEl.children[selIdx].classList.add("highlight");
        for (const move of legalMoves) {
            const idx = move.to.r * 8 + move.to.c;
            const square = boardEl.children[idx];
            if (move.captured) {
                square.classList.add("capture-option");
            } else {
                square.classList.add("move-option");
            }
        }
    }
    const inCheck = game.isInCheck(game.turn);
    const king = game.findKing(game.turn);
    if (inCheck) {
        boardEl.children[king.r * 8 + king.c].classList.add("in-check");
    }
    turnIndicator.textContent = `Turn: ${game.turn === "w" ? "White" : "Black"}`;
    if (status === "checkmate") {
        statusIndicator.textContent = `Checkmate! ${game.turn === "w" ? "Black" : "White"} wins.`;
    } else if (status === "stalemate") {
        statusIndicator.textContent = "Stalemate.";
    } else if (status === "check") {
        statusIndicator.textContent = "Check.";
    } else {
        statusIndicator.textContent = "Game in progress.";
    }
    updateHistoryDisplay();
}

function onSquareClick(r, c) {
    if (aiThinking) return;
    const piece = game.board[r][c];
    if (selected && legalMoves.some(m => m.to.r === r && m.to.c === c)) {
        const move = legalMoves.find(m => m.to.r === r && m.to.c === c);
        executeMove(move);
        return;
    }
    if (piece && piece.color === game.turn) {
        selected = { r, c };
        legalMoves = game.generateMoves().filter(m => m.from.r === r && m.from.c === c);
    } else {
        selected = null;
        legalMoves = [];
    }
    render();
}

function executeMove(move) {
    if (move.promotion && !move.promotionChosen) {
        const choice = prompt("Promote to (q, r, b, n):", "q");
        const map = { q: "Q", r: "R", b: "B", n: "N" };
        const promo = map[(choice || "q").toLowerCase()] || "Q";
        move.promotion = promo;
        move.promotionChosen = true;
    }
    game.makeMove(move);
    const algebraic = `${GameState.coordToAlgebraic(move.from)}-${GameState.coordToAlgebraic(move.to)}${move.promotion ? `=${move.promotion}` : ""}`;
    historyEl.insertAdjacentHTML("beforeend", `<li>${algebraic}</li>`);
    selected = null;
    legalMoves = [];
    render();
}

function updateHistoryDisplay() {
    historyEl.innerHTML = "";
    game.history.forEach(m => {
        const algebraic = `${GameState.coordToAlgebraic(m.from)}-${GameState.coordToAlgebraic(m.to)}${m.promotion ? `=${m.promotion}` : ""}`;
        const li = document.createElement("li");
        li.textContent = algebraic;
        historyEl.appendChild(li);
    });
}

resetBtn.addEventListener("click", () => {
    game = GameState.initial();
    selected = null;
    legalMoves = [];
    render();
});

aiMoveBtn.addEventListener("click", () => {
    if (aiThinking) return;
    aiThinking = true;
    aiMoveBtn.textContent = "AI Thinking...";
    setTimeout(() => {
        const result = minimax(game, AI_DEPTH, -Infinity, Infinity, game.turn === "w");
        if (result.move) {
            executeMove(result.move);
        }
        aiThinking = false;
        aiMoveBtn.textContent = "AI Move";
    }, 30);
});

saveFenBtn.addEventListener("click", async () => {
    const fen = game.toFEN();
    fenInput.value = fen;
    try {
        await navigator.clipboard.writeText(fen);
        alert("FEN copied to clipboard.");
    } catch (_) {
        alert("Clipboard write failed. FEN placed in input field.");
    }
});

loadFenBtn.addEventListener("click", () => {
    try {
        game = GameState.fromFEN(fenInput.value.trim());
        selected = null;
        legalMoves = [];
        render();
    } catch (e) {
        alert("Invalid FEN");
    }
});

function runTests() {
    const results = [];
    // Illegal move rejection
    const g1 = GameState.initial();
    const illegal = { from: GameState.algebraicToCoord("e2"), to: GameState.algebraicToCoord("e5") };
    const legalSet = g1.generateMoves().some(m => m.from.r === illegal.from.r && m.from.c === illegal.from.c && m.to.r === illegal.to.r && m.to.c === illegal.to.c);
    results.push(legalSet ? "FAIL: Illegal pawn move allowed" : "PASS: Illegal pawn move rejected");

    // King into check prevention
    const g2 = GameState.fromFEN("8/8/8/8/8/8/5r2/4K3 w - - 0 1");
    const kingMoves = g2.generateMoves().filter(m => m.piece.type === "K");
    const intoCheck = kingMoves.some(m => GameState.coordToAlgebraic(m.to) === "e2");
    results.push(intoCheck ? "FAIL: King allowed into check" : "PASS: King prevented from moving into check");

    // Castling restriction while passing through check
    const g3 = GameState.fromFEN("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1");
    const castleMoves = g3.generateMoves().filter(m => m.isCastle && m.from.r === 7);
    const blockedShort = castleMoves.some(m => m.to.c === 6);
    results.push(blockedShort ? "FAIL: Castling allowed through check" : "PASS: Castling correctly blocked when path attacked");

    // Checkmate detection
    const g4 = GameState.fromFEN("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
    results.push(g4.gameStatus() === "checkmate" ? "PASS: Checkmate detected" : "FAIL: Checkmate not detected");

    // Stalemate detection
    const g5 = GameState.fromFEN("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    results.push(g5.gameStatus() === "stalemate" ? "PASS: Stalemate detected" : "FAIL: Stalemate not detected");

    testOutput.textContent = results.join("\n");
}

runTestsBtn.addEventListener("click", runTests);
initBoard();
runTests();

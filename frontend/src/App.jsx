import React, { useState, useEffect, useRef } from 'react';
import Chessground from '@bezalel6/react-chessground';
import '@bezalel6/react-chessground/dist/react-chessground.css';
import { Chess } from 'chess.js';
import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast, RotateCcw } from 'lucide-react';

const App = () => {
    const ENGINE_TIME_MS = 1000;

    // Game State
    const chess = useRef(new Chess());
    const [fen, setFen] = useState(chess.current.fen());
    const [startFen, setStartFen] = useState(chess.current.fen());
    const [lastMove, setLastMove] = useState(null);
    const [history, setHistory] = useState([]); // Array of moves
    const [viewIndex, setViewIndex] = useState(-1); // -1 = start pos, 0 = after 1st move, etc.
    
    // Initialize with safe defaults
    const [config, setConfig] = useState({
        turnColor: 'white',
        movable: {
            free: false,
            color: 'white',
            dests: new Map(),
        },
        draggable: {
            showGhost: true,
        }
    });
    
    // UI State
    const [elo, setElo] = useState(1500);
    const [errorProb, setErrorProb] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serverStatus, setServerStatus] = useState("checking");
    const [debugMsg, setDebugMsg] = useState("Ready");
    const [manualFen, setManualFen] = useState("");
    const [heatmapShapes, setHeatmapShapes] = useState([]);
    const [heatmapLoading, setHeatmapLoading] = useState(false);
    const [heatmapError, setHeatmapError] = useState(null);
    const [heatmapMarkers, setHeatmapMarkers] = useState([]);
    const [heatmapMoves, setHeatmapMoves] = useState([]);
    const [evalScore, setEvalScore] = useState(null);
    const [evalSide, setEvalSide] = useState(null);
    const [evalLoading, setEvalLoading] = useState(false);
    const [evalError, setEvalError] = useState(null);
    const [engineBestMove, setEngineBestMove] = useState(null);
    const predictionAbortRef = useRef(null);
    const heatmapAbortRef = useRef(null);
    const engineRef = useRef(null);
    const engineReadyPromiseRef = useRef(null);
    const engineReadyResolveRef = useRef(null);
    const evalPendingRef = useRef(null);
    const evalRequestIdRef = useRef(0);

    // Initialize board config
    useEffect(() => {
        updateBoardConfig();
        checkApi();
    }, []);

    // Trigger prediction when FEN changes (and we are at the latest position)
    useEffect(() => {
        // Only fetch prediction if we are looking at the latest position
        if (viewIndex === history.length - 1) {
            getPrediction();
            getMoveHeatmap();
            return;
        }

        setHeatmapShapes([]);
        setHeatmapMarkers([]);
        setHeatmapMoves([]);
        setHeatmapError("Heatmap is only shown for the latest position.");
    }, [fen, elo, viewIndex, history.length]);
    
    useEffect(() => {
        return () => {
            if (predictionAbortRef.current) {
                predictionAbortRef.current.abort();
            }
            if (heatmapAbortRef.current) {
                heatmapAbortRef.current.abort();
            }
            if (evalPendingRef.current) {
                evalPendingRef.current.reject(new Error("Evaluation canceled."));
                evalPendingRef.current = null;
            }
            if (engineRef.current) {
                if (typeof engineRef.current.terminate === "function") {
                    engineRef.current.terminate();
                } else {
                    engineRef.current.postMessage("quit");
                }
                engineRef.current = null;
            }
        };
    }, []);

    // Sync FEN to input box for easy copying
    useEffect(() => {
        setManualFen(fen);
    }, [fen]);

    useEffect(() => {
        if (viewIndex !== history.length - 1) {
            return;
        }
        if (!heatmapMoves.length) {
            return;
        }
        try {
            const heatmap = buildHeatmap(heatmapMoves, engineBestMove);
            setHeatmapShapes(heatmap.shapes);
            setHeatmapMarkers(heatmap.markers);
        } catch (error) {
            setHeatmapShapes([]);
            setHeatmapMarkers([]);
            setHeatmapError(error.message);
            setDebugMsg(`Heatmap error: ${error.message}`);
        }
    }, [engineBestMove, heatmapMoves, viewIndex, history.length]);

    useEffect(() => {
        getEvaluation();
    }, [fen]);

    // Handle Time Travel / Navigation
    useEffect(() => {
        updateBoardFromHistory();
    }, [viewIndex, history]);

    const checkApi = () => {
        fetch("http://localhost:8000/")
            .then(res => res.json())
            .then(() => setServerStatus("online"))
            .catch(() => setServerStatus("offline"));
    };

    const getValidatedElo = () => {
        const parsedElo = Number.parseInt(elo, 10);
        if (Number.isNaN(parsedElo)) {
            throw new Error("Elo is required.");
        }
        return parsedElo;
    };

    const getSideToMoveFromFen = (fenValue) => {
        const parts = fenValue.trim().split(" ");
        if (parts.length < 2) {
            throw new Error("FEN missing side-to-move field.");
        }
        if (parts[1] === "w") {
            return "white";
        }
        if (parts[1] === "b") {
            return "black";
        }
        throw new Error("FEN has invalid side-to-move field.");
    };

    const initEngine = async () => {
        if (engineRef.current) {
            return;
        }
        const wasmSupported = typeof WebAssembly === "object"
            && typeof WebAssembly.validate === "function"
            && WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
        if (!wasmSupported) {
            throw new Error("WebAssembly is required for Stockfish.");
        }

        const workerUrl = new URL("stockfish.js/stockfish.wasm.js", import.meta.url);
        const engineInstance = new Worker(workerUrl, { type: "classic" });
        engineRef.current = engineInstance;
        engineReadyPromiseRef.current = new Promise((resolve) => {
            engineReadyResolveRef.current = resolve;
        });
        const handleEngineMessage = (event) => {
            const line = typeof event === "string" ? event : event?.data;
            if (!line) {
                return;
            }
            if (line === "uciok") {
                engineInstance.postMessage("isready");
                return;
            }
            if (line === "readyok") {
                if (engineReadyResolveRef.current) {
                    engineReadyResolveRef.current();
                    engineReadyResolveRef.current = null;
                }
                return;
            }
            if (line.startsWith("info")) {
                const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
                if (scoreMatch && evalPendingRef.current) {
                    evalPendingRef.current.latestScore = {
                        type: scoreMatch[1],
                        value: Number.parseInt(scoreMatch[2], 10)
                    };
                }
                return;
            }
            if (line.startsWith("bestmove")) {
                if (!evalPendingRef.current) {
                    return;
                }
                const pending = evalPendingRef.current;
                evalPendingRef.current = null;
                if (pending.requestId !== evalRequestIdRef.current) {
                    pending.reject(new Error("Evaluation superseded."));
                    return;
                }
                const bestMoveUci = line.split(" ")[1] || "(none)";
                pending.bestMoveUci = bestMoveUci;
                if (!pending.latestScore) {
                    pending.reject(new Error("Engine returned no score."));
                    return;
                }
                pending.resolve({
                    score: pending.latestScore,
                    bestMoveUci: pending.bestMoveUci
                });
            }
        };
        engineInstance.addEventListener("message", handleEngineMessage);
        engineInstance.postMessage("uci");
    };

    const ensureEngineReady = async () => {
        await initEngine();
        if (!engineReadyPromiseRef.current) {
            throw new Error("Engine failed to initialize.");
        }
        await engineReadyPromiseRef.current;
    };

    const runEngineEval = (fenValue) => {
        if (!ENGINE_TIME_MS || ENGINE_TIME_MS <= 0) {
            throw new Error("ENGINE_TIME_MS must be greater than 0.");
        }
        if (!engineRef.current) {
            throw new Error("Engine is not initialized.");
        }
        const requestId = evalRequestIdRef.current + 1;
        evalRequestIdRef.current = requestId;
        if (evalPendingRef.current) {
            evalPendingRef.current.reject(new Error("Evaluation canceled."));
            evalPendingRef.current = null;
        }
        const pendingPromise = new Promise((resolve, reject) => {
            evalPendingRef.current = {
                requestId,
                resolve,
                reject,
                latestScore: null,
                bestMoveUci: null
            };
        });
        engineRef.current.postMessage("stop");
        engineRef.current.postMessage(`position fen ${fenValue}`);
        engineRef.current.postMessage(`go movetime ${ENGINE_TIME_MS}`);
        return pendingPromise;
    };

    const formatEval = (evaluation) => {
        if (!evaluation?.type || typeof evaluation?.value !== "number") {
            throw new Error("Missing evaluation type/value from engine.");
        }
        if (evaluation.type === "mate") {
            if (evaluation.value > 0) {
                return `Mate in ${evaluation.value}`;
            }
            if (evaluation.value < 0) {
                return `Mated in ${Math.abs(evaluation.value)}`;
            }
            return "Mate";
        }
        if (evaluation.type === "cp") {
            const cp = evaluation.value / 100;
            const sign = cp >= 0 ? "+" : "";
            return `${sign}${cp.toFixed(2)}`;
        }
        throw new Error("Unknown evaluation type.");
    };

    const getEvaluation = async () => {
        setEvalLoading(true);
        setEvalError(null);
        setEngineBestMove(null);
        try {
            if (!fen?.trim()) {
                throw new Error("FEN is required.");
            }
            const side = getSideToMoveFromFen(fen);
            await ensureEngineReady();
            const evaluation = await runEngineEval(fen);
            setEvalSide(side);
            setEvalScore(formatEval(evaluation.score));
            if (!evaluation.bestMoveUci) {
                throw new Error("Engine returned no best move.");
            }
            const parsedBestMove = parseUciMove(evaluation.bestMoveUci);
            if (!parsedBestMove) {
                throw new Error("Engine returned no best move.");
            }
            setEngineBestMove(parsedBestMove);
        } catch (error) {
            if (error?.message === "Evaluation canceled." || error?.message === "Evaluation superseded.") {
                return;
            }
            console.error("Error fetching evaluation:", error);
            setEvalScore(null);
            setEvalSide(null);
            setEvalError(error.message);
            setDebugMsg(`Eval error: ${error.message}`);
            setEngineBestMove(null);
        } finally {
            setEvalLoading(false);
        }
    };

    const getPrediction = async () => {
        setLoading(true);
        let controller;
        try {
            if (!fen?.trim()) {
                throw new Error("FEN is required.");
            }
            const parsedElo = getValidatedElo();
            if (predictionAbortRef.current) {
                predictionAbortRef.current.abort();
            }
            controller = new AbortController();
            predictionAbortRef.current = controller;
            const response = await fetch("http://localhost:8000/predict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fen: fen,
                    elo: parsedElo
                }),
                signal: controller.signal
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || data?.error || "Prediction failed.");
            }
            if (typeof data.human_error_probability !== "number") {
                throw new Error("Missing human_error_probability in response.");
            }
            setErrorProb(data.human_error_probability);
        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }
            console.error("Error fetching prediction:", error);
            setErrorProb(null);
            setDebugMsg(`Prediction error: ${error.message}`);
        } finally {
            if (predictionAbortRef.current === controller) {
                predictionAbortRef.current = null;
            }
            setLoading(false);
        }
    };

    const squareToGrid = (square) => {
        if (!/^[a-h][1-8]$/.test(square)) {
            throw new Error(`Invalid square: ${square}`);
        }
        const fileIndex = square.charCodeAt(0) - 97;
        const rank = Number.parseInt(square[1], 10);
        return { row: 9 - rank, col: fileIndex + 1 };
    };

    const parseUciMove = (uci) => {
        if (uci === "(none)" || uci === "0000") {
            return null;
        }
        if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
            throw new Error(`Invalid UCI move: ${uci}`);
        }
        return {
            from: uci.slice(0, 2),
            to: uci.slice(2, 4)
        };
    };

    const buildHeatmap = (moves, bestMove) => {
        if (!Array.isArray(moves)) {
            throw new Error("Missing moves array in response.");
        }
        if (moves.length < 3) {
            throw new Error("Need at least 3 legal moves for heatmap.");
        }
        moves.forEach((move) => {
            if (!move?.from || !move?.to || typeof move?.opponent_error_probability !== "number") {
                throw new Error("Move entry missing from/to/opponent_error_probability.");
            }
            if (typeof move?.opponent_error_delta !== "number") {
                throw new Error("Move entry missing opponent_error_delta.");
            }
        });

        const sorted = [...moves].sort((a, b) => b.opponent_error_delta - a.opponent_error_delta);
        const topOne = sorted[0];
        const topTwo = sorted[1];
        const bottomOne = sorted[sorted.length - 1];
        const selected = [
            { move: topOne, label: "1", color: "#4ade80", brush: "green" },
            { move: topTwo, label: "2", color: "#4ade80", brush: "green" },
            { move: bottomOne, label: "3", color: "#f87171", brush: "red" }
        ];

        const shapes = selected.map((entry) => ({
            orig: entry.move.from,
            dest: entry.move.to,
            brush: entry.brush
        }));

        const markers = selected.map((entry) => ({
            square: entry.move.to,
            label: entry.label,
            color: entry.color,
            grid: squareToGrid(entry.move.to)
        }));

        if (bestMove) {
            const matchingMarker = markers.find((marker) => marker.square === bestMove.to);
            const matchingShape = shapes.find((shape) => shape.orig === bestMove.from && shape.dest === bestMove.to);
            if (matchingMarker) {
                matchingMarker.label = `${matchingMarker.label}E`;
                matchingMarker.color = "#60a5fa";
            } else {
                markers.push({
                    square: bestMove.to,
                    label: "E",
                    color: "#60a5fa",
                    grid: squareToGrid(bestMove.to)
                });
            }
            if (matchingShape) {
                matchingShape.brush = "blue";
            } else {
                shapes.push({
                    orig: bestMove.from,
                    dest: bestMove.to,
                    brush: "blue"
                });
            }
        }

        return { shapes, markers };
    };

    const getMoveHeatmap = async () => {
        setHeatmapLoading(true);
        setHeatmapError(null);
        let controller;
        try {
            if (!fen?.trim()) {
                throw new Error("FEN is required.");
            }
            const parsedElo = getValidatedElo();
            if (heatmapAbortRef.current) {
                heatmapAbortRef.current.abort();
            }
            controller = new AbortController();
            heatmapAbortRef.current = controller;
            const response = await fetch("http://localhost:8000/predict_moves", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fen: fen,
                    elo: parsedElo
                }),
                signal: controller.signal
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || data?.error || "Move heatmap failed.");
            }
            setHeatmapMoves(data.moves);
            const heatmap = buildHeatmap(data.moves, engineBestMove);
            setHeatmapShapes(heatmap.shapes);
            setHeatmapMarkers(heatmap.markers);
        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }
            console.error("Error fetching move heatmap:", error);
            setHeatmapShapes([]);
            setHeatmapMarkers([]);
            setHeatmapMoves([]);
            setHeatmapError(error.message);
            setDebugMsg(`Heatmap error: ${error.message}`);
        } finally {
            if (heatmapAbortRef.current === controller) {
                heatmapAbortRef.current = null;
            }
            setHeatmapLoading(false);
        }
    };

    const updateBoardFromHistory = () => {
        // Strategy: Load the full game PGN into a temp instance and undo until we reach viewIndex.
        // This is robust because it handles custom start positions (FEN) automatically via PGN headers.
        const tmp = new Chess();
        
        try {
            const pgn = chess.current.pgn();
            
            // Load the entire game history from the master instance
            tmp.loadPgn(pgn);
            
            // Undo moves until we match the viewIndex
            let currentPly = history.length - 1;
            while (currentPly > viewIndex) {
                tmp.undo();
                currentPly--;
            }
            
            setFen(tmp.fen());
            
            // Update last move highlight based on the board state at viewIndex
            const verboseHist = tmp.history({ verbose: true });
            if (verboseHist.length > 0) {
                const last = verboseHist[verboseHist.length - 1];
                setLastMove([last.from, last.to]);
            } else {
                setLastMove(null);
            }

            // Interactive only if we are at the LATEST move
            // Actually, we want to allow branching, so ALWAYS interactive.
            // But we must pass the 'tmp' instance so it calculates moves for the PAST board, not the future one.
            updateBoardConfig(true, tmp);
            
        } catch (e) {
            console.error("History update error:", e);
            setDebugMsg(`Nav Error: ${e.message}`);
        }
    };

    const updateBoardConfig = (interactive = true, chessInstance = chess.current) => {
        const dests = new Map();
        if (interactive) {
            chessInstance.moves({ verbose: true }).forEach(m => {
                dests.set(m.from, (dests.get(m.from) || []).concat(m.to));
            });
        }
        
        setConfig({
            turnColor: chessInstance.turn() === 'w' ? 'white' : 'black',
            movable: {
                free: false,
                color: interactive ? (chessInstance.turn() === 'w' ? 'white' : 'black') : undefined,
                dests: dests,
            },
            draggable: {
                showGhost: true,
            }
        });
    };

    const onMove = (from, to) => {
        // Handle branching if we are not at the latest move
        if (viewIndex < history.length - 1) {
             // Rewind master instance to the viewIndex point
             // Effectively truncating history and creating a new branch
             while (chess.current.history().length > viewIndex + 1) {
                 chess.current.undo();
             }
        }

        try {
            const move = chess.current.move({ from, to, promotion: 'q' });
            if (move) {
                const newHist = chess.current.history();
                setHistory(newHist);
                setViewIndex(newHist.length - 1); // Snap to latest
                setFen(chess.current.fen());
                setLastMove([from, to]);
                setDebugMsg(`Moved: ${move.san}`);
                updateBoardConfig(true);
            }
        } catch (e) {
            setDebugMsg(`Invalid: ${e.message}`);
            // Force re-render/reset
            updateBoardConfig(true); 
        }
    };

    const resetGame = () => {
        chess.current.reset();
        const start = chess.current.fen();
        setStartFen(start);
        setHistory([]);
        setViewIndex(-1);
        setFen(start);
        setLastMove(null);
        setDebugMsg("Game Reset");
        updateBoardConfig(true);
    };

    const loadFen = () => {
        try {
            const cleanFen = manualFen.trim();
            if (!cleanFen) throw new Error("FEN is required.");
            chess.current.load(cleanFen);
            
            const start = chess.current.fen();
            setStartFen(start);
            setHistory([]); 
            setViewIndex(-1);
            
            setFen(start);
            setLastMove(null);
            setDebugMsg(`Loaded: ${cleanFen}`);
            updateBoardConfig(true);
        } catch (e) {
            setDebugMsg(`Invalid FEN: ${e.message}`);
        }
    };

    // Navigation Handlers
    const navFirst = () => setViewIndex(-1);
    const navPrev = () => setViewIndex(i => Math.max(-1, i - 1));
    const navNext = () => setViewIndex(i => Math.min(history.length - 1, i + 1));
    const navLast = () => setViewIndex(history.length - 1);

    return (
        <div style={{ padding: "2rem", display: "flex", gap: "2rem", fontFamily: "sans-serif", background: "#1a1a1a", minHeight: "100vh", color: "#e0e0e0" }}>
            
            {/* Board Section */}
            <div style={{ flex: 1, maxWidth: "600px", display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
                <div style={{ height: "600px", width: "600px", position: "relative" }}>
                    <Chessground
                        width="100%"
                        height="100%"
                        fen={fen}
                        onMove={onMove}
                        lastMove={lastMove}
                        turnColor={config.turnColor}
                        movable={config.movable}
                        draggable={config.draggable}
                        check={chess.current.inCheck()}
                        animation={{ enabled: true, duration: 200 }}
                        drawable={{
                            enabled: true,
                            visible: true,
                            autoShapes: heatmapShapes
                        }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "grid",
                            gridTemplateColumns: "repeat(8, 1fr)",
                            gridTemplateRows: "repeat(8, 1fr)",
                            pointerEvents: "none"
                        }}
                    >
                        {heatmapMarkers.map((marker) => (
                            <div
                                key={`${marker.square}-${marker.label}`}
                                style={{
                                    gridRow: marker.grid.row,
                                    gridColumn: marker.grid.col,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center"
                                }}
                            >
                                <div
                                    style={{
                                        width: "28px",
                                        height: "28px",
                                        borderRadius: "999px",
                                        background: marker.color,
                                        color: "#111827",
                                        fontWeight: 700,
                                        fontSize: "0.85rem",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        boxShadow: "0 2px 6px rgba(0,0,0,0.35)"
                                    }}
                                >
                                    {marker.label}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                
                {/* Navigation Bar */}
                <div style={{ display: "flex", gap: "0.5rem", background: "#262626", padding: "0.5rem", borderRadius: "8px", width: "100%", justifyContent: "center", alignItems: "center", position: "relative", zIndex: 10 }}>
                    <button onClick={resetGame} title="Reset Game" style={{ background: "transparent", border: "none", color: "#a3a3a3", cursor: "pointer", padding: "0.5rem" }}>
                        <RotateCcw size={20} />
                    </button>
                    <div style={{ width: "1px", height: "24px", background: "#404040", margin: "0 0.5rem" }}></div>
                    
                    <button 
                        onClick={() => navFirst()} 
                        disabled={viewIndex <= -1} 
                        style={{ background: "transparent", border: "none", color: viewIndex <= -1 ? "#525252" : "white", cursor: viewIndex <= -1 ? "default" : "pointer" }}
                    >
                        <ChevronFirst size={24} />
                    </button>
                    <button 
                        onClick={() => navPrev()} 
                        disabled={viewIndex <= -1} 
                        style={{ background: "transparent", border: "none", color: viewIndex <= -1 ? "#525252" : "white", cursor: viewIndex <= -1 ? "default" : "pointer" }}
                    >
                        <ChevronLeft size={24} />
                    </button>
                    
                    <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: "#a3a3a3", minWidth: "60px", textAlign: "center" }}>
                        {viewIndex + 1} / {history.length}
                    </span>

                    <button 
                        onClick={() => navNext()} 
                        disabled={viewIndex >= history.length - 1} 
                        style={{ background: "transparent", border: "none", color: viewIndex >= history.length - 1 ? "#525252" : "white", cursor: viewIndex >= history.length - 1 ? "default" : "pointer" }}
                    >
                        <ChevronRight size={24} />
                    </button>
                    <button 
                        onClick={() => navLast()} 
                        disabled={viewIndex >= history.length - 1} 
                        style={{ background: "transparent", border: "none", color: viewIndex >= history.length - 1 ? "#525252" : "white", cursor: viewIndex >= history.length - 1 ? "default" : "pointer" }}
                    >
                        <ChevronLast size={24} />
                    </button>
                </div>
            </div>

            {/* Controls Section */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                <h1 style={{ margin: 0 }}>Human-Like Chess AI</h1>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
                    Status:
                    {serverStatus === "online" ? <span style={{ color: "#4ade80" }}>API Online</span> : <span style={{ color: "#f87171" }}>API Offline (Run backend)</span>}
                </div>
                <div style={{ color: "yellow", fontSize: "0.8rem", fontFamily: "monospace" }}>Debug: {debugMsg}</div>

                <div style={{ background: "#262626", padding: "1.5rem", borderRadius: "12px", border: "1px solid #404040" }}>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold" }}>Target Rating (Elo): {elo}</label>
                    <input
                        type="range"
                        min="600"
                        max="2400"
                        step="50"
                        value={elo}
                        onChange={(e) => setElo(e.target.value)}
                        style={{ width: "100%", accentColor: "#3b82f6" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#a3a3a3", marginTop: "0.25rem" }}>
                        <span>Beginner (600)</span>
                        <span>Master (2400)</span>
                    </div>
                </div>

                <div style={{ background: "#262626", padding: "1.5rem", borderRadius: "12px", border: "1px solid #404040" }}>
                    <h2 style={{ marginTop: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        Human Error Probability
                        {loading && <span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>(calculating...)</span>}
                    </h2>

                    {errorProb !== null ? (
                        <div>
                            <div style={{ fontSize: "3rem", fontWeight: "bold", color: errorProb > 0.5 ? "#f87171" : "#4ade80" }}>
                                {(errorProb * 100).toFixed(1)}%
                            </div>
                            <p style={{ margin: "0.5rem 0", color: "#a3a3a3" }}>
                                {errorProb > 0.5
                                    ? "High chance of a blunder for a human of this rating."
                                    : "Position seems intuitive/stable for this rating."}
                            </p>

                            <div style={{ marginTop: "1rem", height: "10px", width: "100%", background: "#404040", borderRadius: "5px", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${errorProb * 100}%`, background: errorProb > 0.5 ? "#f87171" : "#4ade80", transition: "width 0.3s ease" }}></div>
                            </div>
                        </div>
                    ) : (
                        <p>Make a move to see prediction.</p>
                    )}
                </div>

                <div style={{ background: "#262626", padding: "1.5rem", borderRadius: "12px", border: "1px solid #404040" }}>
                    <h2 style={{ marginTop: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        Engine Eval
                        {evalLoading && <span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>(calculating...)</span>}
                    </h2>
                    {evalError ? (
                        <p style={{ margin: 0, color: "#f87171" }}>{evalError}</p>
                    ) : evalScore ? (
                        <div>
                            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#e5e7eb" }}>{evalScore}</div>
                            {evalSide && (
                                <p style={{ margin: "0.5rem 0 0", color: "#a3a3a3" }}>
                                    Eval perspective: {evalSide} to move
                                </p>
                            )}
                        </div>
                    ) : (
                        <p style={{ margin: 0, color: "#a3a3a3" }}>Waiting for evaluation...</p>
                    )}
                </div>

                <div style={{ background: "#262626", padding: "1.5rem", borderRadius: "12px", border: "1px solid #404040" }}>
                    <h2 style={{ marginTop: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        Move Heatmap
                        {heatmapLoading && <span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>(loading...)</span>}
                    </h2>
                    {heatmapError ? (
                        <p style={{ margin: 0, color: "#f87171" }}>{heatmapError}</p>
                    ) : (
                        <p style={{ margin: 0, color: "#a3a3a3" }}>
                            1-2 (green) = highest opponent blunder increase. 3 (red) = lowest increase. E (blue) = engine best move.
                        </p>
                    )}
                </div>

                <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                        type="text"
                        placeholder="Paste FEN here..."
                        value={manualFen}
                        onChange={(e) => setManualFen(e.target.value)}
                        style={{ flex: 1, padding: "0.5rem", borderRadius: "6px", border: "1px solid #404040", background: "#262626", color: "white" }}
                    />
                    <button onClick={loadFen} style={{ padding: "0.5rem 1rem", background: "#3b82f6", color: "white", border: "none", borderRadius: "6px" }}>Load</button>
                </div>
            </div>
        </div>
    );
};

export default App;

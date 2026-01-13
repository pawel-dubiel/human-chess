import React, { useState, useEffect, useRef } from 'react';
import Chessground from '@bezalel6/react-chessground';
import '@bezalel6/react-chessground/dist/react-chessground.css';
import { Chess } from 'chess.js';
import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast, RotateCcw } from 'lucide-react';

const App = () => {
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
        }
    }, [fen, elo, viewIndex, history.length]);

    // Sync FEN to input box for easy copying
    useEffect(() => {
        setManualFen(fen);
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

    const getPrediction = async () => {
        setLoading(true);
        try {
            const response = await fetch("http://localhost:8000/predict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fen: fen,
                    elo: parseInt(elo)
                })
            });
            const data = await response.json();
            setErrorProb(data.human_error_probability);
        } catch (error) {
            console.error("Error fetching prediction:", error);
        }
        setLoading(false);
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
                <div style={{ height: "600px", width: "600px" }}>
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
                    />
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

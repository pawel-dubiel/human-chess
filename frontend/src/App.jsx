import React, { useState, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { AlertCircle, CheckCircle } from 'lucide-react';

const App = () => {
    const [game, setGame] = useState(new Chess());
    const [elo, setElo] = useState(1500);
    const [errorProb, setErrorProb] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serverStatus, setServerStatus] = useState("checking");
    const [debugMsg, setDebugMsg] = useState("Ready");
    const [manualFen, setManualFen] = useState("");

    useEffect(() => {
        // Check API
        fetch("http://localhost:8000/")
            .then(res => res.json())
            .then(data => setServerStatus("online"))
            .catch(err => setServerStatus("offline"));
    }, []);

    useEffect(() => {
        getPrediction();
    }, [game, elo]);

    const getPrediction = async () => {
        setLoading(true);
        try {
            const response = await fetch("http://localhost:8000/predict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fen: game.fen(),
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

    function onDrop(sourceSquare, targetSquare) {
        setDebugMsg(`Drop: ${sourceSquare}->${targetSquare}`);
        try {
            const gameCopy = new Chess(game.fen());
            
            // chess.js 1.x throws an error if the move is invalid
            const move = gameCopy.move({
                from: sourceSquare,
                to: targetSquare,
                promotion: "q",
            });

            setGame(gameCopy);
            setDebugMsg(`Moved: ${move.san}`);
            return true;
        } catch (e) {
            setDebugMsg(`Invalid/Err: ${e.message}`);
            return false;
        }
    }

    const resetGame = () => {
        setGame(new Chess());
    };

    const loadFen = () => {
        try {
            const cleanFen = manualFen.trim();
            if (!cleanFen) {
                throw new Error("FEN is required.");
            }
            // Let chess.js handle validation
            const newGame = new Chess(cleanFen);
            setGame(newGame);
            setDebugMsg(`Loaded: ${cleanFen}`);
        } catch (e) {
            setDebugMsg(`Invalid FEN: ${e.message}`);
        }
    };

    return (
        <div style={{ padding: "2rem", display: "flex", gap: "2rem", fontFamily: "sans-serif", background: "#1a1a1a", minHeight: "100vh", color: "#e0e0e0" }}>
            <div style={{ flex: 1, maxWidth: "600px" }}>
                <Chessboard
                    id="BasicBoard"
                    position={game.fen()}
                    onPieceDrop={onDrop}
                    boardWidth={500}
                />
            </div>

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
                        min="1000"
                        max="2800"
                        step="100"
                        value={elo}
                        onChange={(e) => setElo(e.target.value)}
                        style={{ width: "100%", accentColor: "#3b82f6" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#a3a3a3", marginTop: "0.25rem" }}>
                        <span>Beginner (1000)</span>
                        <span>Grandmaster (2800)</span>
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

                <div style={{ display: "flex", gap: "1rem" }}>
                    <button onClick={resetGame} style={{ padding: "0.75rem 1.5rem", background: "#404040", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>Reset Board</button>
                    <button
                        onClick={() => {
                            const gameCopy = new Chess(game.fen());
                            gameCopy.undo();
                            setGame(gameCopy);
                        }}
                        style={{ padding: "0.75rem 1.5rem", background: "#404040", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
                    >
                        Undo Move
                    </button>
                </div>
            </div>
        </div>
    );
};

export default App;

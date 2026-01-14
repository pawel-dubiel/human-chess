from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import torch
import numpy as np
import chess
from src.model import ChessBlunderCNN
import os

app = FastAPI()

# Input Schema
class PredictionRequest(BaseModel):
    fen: str
    elo: int

# Load Model
MODEL_PATH = "models/human-chess-blunder-cnn"
device = torch.device("cpu") # CPU for inference
model = None

print("Loading model...")
try:
    if os.path.exists(MODEL_PATH):
        model = ChessBlunderCNN.from_pretrained(MODEL_PATH).to(device)
        model.eval()
        print("Model loaded from local path.")
    else:
        print(f"Model not found at {MODEL_PATH}. Prediction endpoints will fail until trained.")
except Exception as e:
    print(f"Failed to load model: {e}")

# Helper Functions
def fen_to_tensor(fen):
    board = chess.Board(fen)
    tensor = np.zeros((12, 8, 8), dtype=np.float32)
    piece_map = {
        chess.PAWN: 0, chess.KNIGHT: 1, chess.BISHOP: 2,
        chess.ROOK: 3, chess.QUEEN: 4, chess.KING: 5
    }
    for square, piece in board.piece_map().items():
        rank = chess.square_rank(square)
        file = chess.square_file(square)
        layer = piece_map[piece.piece_type]
        if piece.color == chess.BLACK:
            layer += 6
        tensor[layer, rank, file] = 1.0
    return torch.from_numpy(tensor).unsqueeze(0)

def predict_single(fen, elo):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    board_tensor = fen_to_tensor(fen).to(device)
    elo_tensor = torch.tensor([[elo / 3000.0]], dtype=torch.float32).to(device)
    
    with torch.no_grad():
        probability = model(board_tensor, elo_tensor).item()
    return probability

def flip_fen_turn(fen):
    parts = fen.split(" ")
    parts[1] = "w" if parts[1] == "b" else "b"
    return " ".join(parts)

@app.get("/health")
def health_check():
    return {"status": "ok"}

# Endpoints
@app.post("/predict")
def predict_endpoint(req: PredictionRequest):
    try:
        prob = predict_single(req.fen, req.elo)
        return {"human_error_probability": prob}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/predict_moves")
def predict_moves_endpoint(req: PredictionRequest):
    """
    Simulates legal moves and predicts opponent error probability for each.
    Used for heatmap generation.
    """
    try:
        board = chess.Board(req.fen)
        legal_moves = list(board.legal_moves)
        
        # Baseline: Probability of opponent error in current position (if it were their turn)
        # We simulate "opponent's view" by flipping turn, though technically we want
        # to know "If I make move X, what is the prob opponent blunders?"
        # So we look at the resulting FENs.
        
        results = []
        for move in legal_moves:
            board.push(move)
            # Now it is opponent's turn. Predict their blunder prob.
            try:
                prob = predict_single(board.fen(), req.elo)
                results.append({
                    "from": chess.square_name(move.from_square),
                    "to": chess.square_name(move.to_square),
                    "opponent_error_probability": prob,
                    "opponent_error_delta": prob, # Simplified for now
                    "san": board.peek().san()
                })
            except:
                pass 
            board.pop()
            
        # Sort by highest error probability (best traps)
        results.sort(key=lambda x: x["opponent_error_probability"], reverse=True)
        
        return {"moves": results}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Mount Static Files (Frontend)
# We expect the frontend to be built to 'frontend/dist'
if os.path.exists("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
else:
    print("Warning: frontend/dist not found. Run 'npm run build' in frontend/.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)

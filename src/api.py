from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import chess
import numpy as np
from tensorflow import keras
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = "models/human_error_model_elo.keras"
model = None

# Input Schema
class PredictionRequest(BaseModel):
    fen: str
    elo: int


def validate_fen(fen: str) -> chess.Board:
    if fen is None or not fen.strip():
        raise HTTPException(status_code=400, detail="FEN is required.")
    try:
        return chess.Board(fen)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid FEN: {exc}") from exc


def validate_request(fen: str, elo: int) -> chess.Board:
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Train it or add models/human_error_model_elo.keras.")
    if elo is None:
        raise HTTPException(status_code=400, detail="Elo is required.")
    if elo <= 0 or elo > 3000:
        raise HTTPException(status_code=400, detail="Elo must be between 1 and 3000.")
    return validate_fen(fen)


def predict_probability(fen: str, elo: int) -> float:
    tensor = fen_to_tensor(fen)
    board_input = np.expand_dims(tensor, axis=0)
    elo_input = np.array([elo / 3000.0])
    prediction = model.predict({"board_input": board_input, "elo_input": elo_input})
    return float(prediction[0][0])


def flip_fen_turn(fen: str) -> str:
    parts = fen.split(" ")
    if len(parts) < 2:
        raise ValueError("FEN missing side-to-move field.")
    if parts[1] == "w":
        parts[1] = "b"
    elif parts[1] == "b":
        parts[1] = "w"
    else:
        raise ValueError("FEN has invalid side-to-move field.")
    return " ".join(parts)

def load_ai_model():
    global model
    if os.path.exists(MODEL_PATH):
        print(f"Loading model from {MODEL_PATH}...")
        model = keras.models.load_model(MODEL_PATH)
    else:
        print("Model not found! Please train it first.")

def fen_to_tensor(fen):
    board = chess.Board(fen)
    tensor = np.zeros((8, 8, 12), dtype=np.float32)
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
        tensor[rank, file, layer] = 1.0
    return tensor

@app.on_event("startup")
async def startup_event():
    load_ai_model()

@app.get("/")
def read_root():
    return {"status": "ok", "model_loaded": model is not None}

@app.post("/predict")
def predict(request: PredictionRequest):
    board = validate_request(request.fen, request.elo)
    try:
        probability = predict_probability(board.fen(), request.elo)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc

    return {
        "fen": request.fen,
        "side_to_move": "white" if board.turn == chess.WHITE else "black",
        "predicted_for": "side_to_move",
        "elo": request.elo,
        "human_error_probability": probability,
        "is_risky": probability > 0.5
    }


@app.post("/predict_moves")
def predict_moves(request: PredictionRequest):
    board = validate_request(request.fen, request.elo)
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        raise HTTPException(status_code=400, detail="No legal moves for this position.")

    try:
        baseline_fen = flip_fen_turn(board.fen())
        baseline_opponent_probability = predict_probability(baseline_fen, request.elo)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Baseline prediction failed: {exc}") from exc

    results = []
    for move in legal_moves:
        san = board.san(move)
        board.push(move)
        try:
            opponent_probability = predict_probability(board.fen(), request.elo)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc
        board.pop()

        results.append({
            "from": chess.square_name(move.from_square),
            "to": chess.square_name(move.to_square),
            "uci": move.uci(),
            "san": san,
            "predicted_for": "opponent_to_move",
            "side_to_move_after": "white" if board.turn == chess.WHITE else "black",
            "opponent_error_probability": opponent_probability,
            "opponent_error_delta": opponent_probability - baseline_opponent_probability
        })

    return {
        "fen": request.fen,
        "side_to_move": "white" if board.turn == chess.WHITE else "black",
        "predicted_for": "opponent_to_move",
        "elo": request.elo,
        "opponent_baseline_probability": baseline_opponent_probability,
        "moves": results
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

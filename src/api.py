from fastapi import FastAPI
from pydantic import BaseModel
import chess
import numpy as np
import tensorflow as tf
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
    if model is None:
        return {"error": "Model not loaded"}
    
    # Preprocess
    try:
        tensor = fen_to_tensor(request.fen)
        board_input = np.expand_dims(tensor, axis=0) # Batch dim
        
        # Normalize Elo (same as training)
        elo_input = np.array([request.elo / 3000.0])
        
        # Predict
        prediction = model.predict({"board_input": board_input, "elo_input": elo_input})
        probability = float(prediction[0][0])
        
        return {
            "fen": request.fen,
            "elo": request.elo,
            "human_error_probability": probability,
            "is_risky": probability > 0.5
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

import sys
import chess
import numpy as np
import tensorflow as tf
from tensorflow import keras

MODEL_PATH = "models/human_error_model.keras"

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

def main():
    if len(sys.argv) < 2:
        print("Usage: python src/predict_position.py <FEN_STRING>")
        # Example position (Start pos)
        fen = chess.STARTING_FEN
    else:
        fen = sys.argv[1]

    print(f"Loading model from {MODEL_PATH}...")
    try:
        model = keras.models.load_model(MODEL_PATH)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    print(f"Analyzing Position: {fen}")
    board = chess.Board(fen)
    print(board)
    print("-" * 20)

    tensor = fen_to_tensor(fen)
    # Add batch dimension
    input_tensor = np.expand_dims(tensor, axis=0)
    
    prediction = model.predict(input_tensor)
    prob = prediction[0][0]
    
    print(f"\nModel Prediction (Probability of Blunder/Error for {board.turn_name}): {prob:.4f}")
    if prob > 0.5:
        print(">> High likelihood of human error here!")
    else:
        print(">> Position seems stable/standard.")

if __name__ == "__main__":
    main()

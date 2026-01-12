import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
import pandas as pd
import numpy as np
import chess
import os

DATA_FILE = "data/processed/chess_complexity_data.csv"
MODEL_FILE = "models/human_error_model_elo.keras"

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

def build_model():
    # Input 1: Board State (8x8x12)
    board_input = keras.Input(shape=(8, 8, 12), name="board_input")
    x = layers.Conv2D(64, kernel_size=3, padding='same', activation='relu')(board_input)
    x = layers.Conv2D(64, kernel_size=3, padding='same', activation='relu')(x)
    x = layers.MaxPooling2D(pool_size=(2, 2))(x)
    x = layers.Conv2D(128, kernel_size=3, padding='same', activation='relu')(x)
    x = layers.Flatten()(x)
    board_features = layers.Dense(128, activation='relu')(x)
    
    # Input 2: Elo Rating (Scalar)
    # We normalize Elo (e.g., divide by 3000)
    elo_input = keras.Input(shape=(1,), name="elo_input")
    y = layers.Dense(16, activation='relu')(elo_input)
    
    # Combine
    combined = layers.concatenate([board_features, y])
    z = layers.Dense(64, activation='relu')(combined)
    z = layers.Dropout(0.5)(z)
    
    # Output
    outputs = layers.Dense(1, activation='sigmoid')(z)
    
    model = keras.Model(inputs=[board_input, elo_input], outputs=outputs)
    model.compile(
        optimizer='adam',
        loss='binary_crossentropy',
        metrics=['accuracy']
    )
    return model

def main():
    if not os.path.exists("models"):
        os.makedirs("models")
        
    print("Loading data...")
    df = pd.read_csv(DATA_FILE)
    print(f"Loaded {len(df)} samples.")
    
    # Preprocess Data
    X_board = np.array([fen_to_tensor(fen) for fen in df['fen']])
    X_elo = np.array(df['elo']) / 3000.0 # Normalize Elo
    y = np.array(df['is_blunder'])

    print("Building model...")
    model = build_model()
    model.summary()

    print("Training...")
    model.fit(
        {"board_input": X_board, "elo_input": X_elo},
        y, 
        epochs=15, 
        batch_size=32, 
        validation_split=0.2
    )
    
    print(f"Saving model to {MODEL_FILE}...")
    model.save(MODEL_FILE)
    print("Done.")

if __name__ == "__main__":
    main()

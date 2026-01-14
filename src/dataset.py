import torch
from torch.utils.data import Dataset
import numpy as np
import chess
from datasets import load_dataset
import pandas as pd

def fen_to_tensor(fen):
    """
    Converts a FEN string to a PyTorch tensor (12, 8, 8).
    Represents the board state.
    """
    board = chess.Board(fen)
    tensor = np.zeros((12, 8, 8), dtype=np.float32)
    
    # Map pieces to layers: P, N, B, R, Q, K (White: 0-5, Black: 6-11)
    # Note: Keras model was (8,8,12), PyTorch expects (Channels, H, W) -> (12, 8, 8)
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
        tensor[layer, rank, file] = 1.0 # (C, H, W)
        
    return tensor

class HumanChessDataset(Dataset):
    def __init__(self, data_file):
        """
        Args:
            data_file (str): Path to the CSV file.
        """
        # Load using pandas for simplicity with local files, 
        # or use datasets.load_dataset('csv', data_files=data_file) if streaming needed.
        # Given the file size, pandas is fine and easier to debug for now.
        print(f"Loading data from {data_file}...")
        self.df = pd.read_csv(data_file)
        # Filter out potential NaNs or bad rows
        self.df = self.df.dropna(subset=['fen', 'elo', 'is_blunder'])
        print(f"Loaded {len(self.df)} samples.")

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        
        # Inputs
        fen = row['fen']
        elo = float(row['elo'])
        
        # Board Tensor
        board_tensor = torch.from_numpy(fen_to_tensor(fen))
        
        # Elo Tensor (Normalized)
        elo_tensor = torch.tensor([elo / 3000.0], dtype=torch.float32)
        
        # Target
        # is_blunder is 0 or 1
        label = torch.tensor([float(row['is_blunder'])], dtype=torch.float32)
        
        return board_tensor, elo_tensor, label

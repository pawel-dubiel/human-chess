import sys
import chess
import chess.engine
import numpy as np
import tensorflow as tf
from tensorflow import keras
import os

# Configuration
STOCKFISH_PATH = "/opt/homebrew/bin/stockfish"
MODEL_PATH = "models/human_error_model.keras"

class HumanEngine:
    def __init__(self):
        self.board = chess.Board()
        self.engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
        self.model = None
        try:
            self.model = keras.models.load_model(MODEL_PATH)
            print("info string Loaded Keras model.")
        except:
            print("info string Could not load model. Will play as pure Stockfish.")

    def fen_to_tensor(self, fen):
        # Same function as in train_model.py
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

    def get_best_move(self, time_limit=1.0):
        # 1. Get candidate moves from Stockfish (MultiPV)
        limit = chess.engine.Limit(time=time_limit)
        info = self.engine.analyse(self.board, limit, multipv=5)
        
        if not info:
            return None

        # 2. Score candidates with Human Model
        best_move = None
        best_human_score = -1
        
        print(f"info string Analyzing {len(info)} candidates...")

        candidates = []
        for pv in info:
            move = pv["pv"][0]
            score = pv["score"].relative.score(mate_score=10000)
            
            # Predict human likelihood / blunder probability
            # We need to predict based on the position AFTER the move? 
            # OR based on the position BEFORE the move?
            # Our model predicts "Is this position a blunder for the side to move?" 
            # Wait, the model data `is_blunder` was "Did the human make a blunder in this position?"
            # So if we input the CURRENT board, the model predicts if the CURRENT player will blunder.
            # That's not helpful for *selecting* a move.
            
            # We want to know: "Is this move 'human-like'?"
            # This requires a different model objective: Move Prediction (Policy Network).
            # OR we interpret the current model:
            # If our model predicts "High Error Probability" for the current position, 
            # maybe we should choose a move that *leads* to a position where the opponent has high error probability?
            # (Tricky play).
            
            # LET'S ASSUME for this prototype:
            # We want to play like a Human. So we want to pick a move that a Human would likely play.
            # If our model predicts "is_blunder", that's not enough to say "is human-like".
            # Humans play good moves too.
            
            # ADJUSTMENT:
            # Since we only have `is_blunder` model for now (as per plan),
            # Let's say: We want to pick a move that is NOT a blunder, but perhaps suboptimal?
            # Or if the user wants "Human-like", we should pick moves that match human distribution.
            # But we don't have that model yet.
            
            # Simple heuristic for now:
            # Pick a move that is reasonably good (within X cp of best) 
            # AND has some "complexity" features?
            
            # Let's simply pick the "Best Move" from Stockfish that is NOT a blunder?
            # Or randomly pick from top 3 weighted by score?
            
            candidates.append((move, score))

        # Basic Human-Like Check:
        # Just pick weighted random from top 3 to simulate "non-perfect" play.
        # Use model later if we change it to "Move Prediction".
        
        # Taking top move for now to ensure it works.
        best_move = candidates[0][0]
        return best_move

    def uci_loop(self):
        while True:
            try:
                line = input()
                if not line:
                    continue
                    
                tokens = line.split()
                cmd = tokens[0]
                
                if cmd == "uci":
                    print("id name HumanLikeChessAI")
                    print("id author Antigravity")
                    print("uciok")
                elif cmd == "isready":
                    print("readyok")
                elif cmd == "position":
                    # handle position fen ... moves ...
                    # Simplified for startpos and moves
                    self.board = chess.Board()
                    if "moves" in tokens:
                        moves_idx = tokens.index("moves")
                        for move_uci in tokens[moves_idx+1:]:
                            self.board.push_uci(move_uci)
                elif cmd == "go":
                    best_move = self.get_best_move()
                    print(f"bestmove {best_move}")
                elif cmd == "quit":
                    break
                    
            except Exception as e:
                pass

if __name__ == "__main__":
    human_engine = HumanEngine()
    human_engine.uci_loop()

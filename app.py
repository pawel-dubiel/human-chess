import gradio as gr
import torch
import chess
import numpy as np
from src.model import ChessBlunderCNN
import os

# Configuration
# By default, try to load from local, otherwise from Hub if specified
MODEL_PATH = "models/human-chess-blunder-cnn"
HF_REPO_ID = "pawel-dubiel/human-chess-blunder" # Replace with actual if known, or make configurable

print("Loading model...")
device = torch.device("cpu") # CPU is fine for inference on Space

try:
    if os.path.exists(MODEL_PATH):
        model = ChessBlunderCNN.from_pretrained(MODEL_PATH).to(device)
        print("Loaded from local path.")
    else:
        # Fallback to loading from Hub if local doesn't exist (useful for Space)
        # For now, we assume the user might want to train first locally.
        # But for the Space, we'll need to point to the Hub.
        # Let's assume the user will push to 'username/space-name'
        # For this script, we'll try to handle both.
        print(f"Local model not found at {MODEL_PATH}. Waiting for training or Hub load.")
        model = None 
except Exception as e:
    print(f"Error loading model: {e}")
    model = None

def fen_to_tensor(fen):
    # Copy from dataset.py to keep app.py standalone-ish or import
    # Importing from src.dataset might fail on Spaces if src isn't in path correctly
    # But we structure it as a package.
    # For safety in this app.py, I'll reimplement or ensure sys path.
    # Actually, let's use the one from dataset.py but we need to make sure 'src' is importable.
    # In HF Spaces, usually the root is the cwd.
    
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
    return torch.from_numpy(tensor).unsqueeze(0) # Batch dim

def predict(fen, elo):
    if model is None:
        return "Model not loaded. Please train the model first or check HF Repo."
    
    try:
        board = chess.Board(fen)
    except:
        return "Invalid FEN string."
        
    board_tensor = fen_to_tensor(fen).to(device)
    elo_tensor = torch.tensor([[elo / 3000.0]], dtype=torch.float32).to(device)
    
    with torch.no_grad():
        model.eval()
        probability = model(board_tensor, elo_tensor).item()
        
    return {
        "Blunder": probability,
        "Safe": 1.0 - probability
    }

# Gradio UI
with gr.Blocks(title="Human-Like Chess AI") as demo:
    gr.Markdown("# Human-Like Chess AI: Blunder Detector")
    gr.Markdown("Predicts the probability that a human player (of a given Elo) will make a blunder in the current position.")
    
    with gr.Row():
        with gr.Column():
            fen_input = gr.Textbox(label="FEN String", placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
            elo_input = gr.Slider(minimum=0, maximum=3000, value=1500, label="Player Elo")
            analyze_btn = gr.Button("Analyze Position", variant="primary")
            
        with gr.Column():
            output_label = gr.Label(label="Prediction")
            
    # Example data
    gr.Examples([
        ["r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", 1500],
        ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 2800]
    ], inputs=[fen_input, elo_input])

    analyze_btn.click(predict, inputs=[fen_input, elo_input], outputs=output_label)

if __name__ == "__main__":
    demo.launch()

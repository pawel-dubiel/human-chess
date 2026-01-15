import chess
import chess.pgn
import chess.engine
import pandas as pd
import os
import multiprocessing
from functools import partial

# Configuration
STOCKFISH_PATH = "/opt/homebrew/bin/stockfish" # Adjust if needed
DATA_DIR = "data/raw"
PROCESSED_DIR = "data/processed"
PGN_FILE = os.path.join(DATA_DIR, "games.pgn")
OUTPUT_FILE = os.path.join(PROCESSED_DIR, "chess_complexity_data.csv")
DEPTH = 10
MAX_GAMES = 10000

# Global variable for the worker process to hold the engine instance
engine = None

def init_worker():
    """Initializer for worker processes to create their own Stockfish instance."""
    global engine
    try:
        engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
    except Exception as e:
        print(f"Failed to start Stockfish in worker: {e}")

def analyze_position_worker(board):
    global engine
    if engine is None:
        return None, 0, 0
    
    info = engine.analyse(board, chess.engine.Limit(depth=DEPTH), multipv=5)
    
    if not info:
        return None, 0, 0
        
    best_move = info[0]["pv"][0]
    score = info[0]["score"].relative.score(mate_score=10000)
    return best_move, score, info

def process_single_game(game_data):
    """
    Worker function to process a single game.
    game_data is a tuple/object containing headers and moves to avoid pickling issues if any,
    but chess.pgn.Game is picklable. Let's accept the game object directly for simplicity,
    assuming the driver script reads it.
    """
    # game_data = (headers, moves_list) or just the game object.
    # To be safe and simple with pickling, let's reconstruct or just pass the game if possible.
    # `chess.pgn.Game` is picklable.
    
    global engine
    game = game_data
    
    white_elo = game.headers.get("WhiteElo", "?")
    black_elo = game.headers.get("BlackElo", "?")
    
    # Validation
    if white_elo == "?" or black_elo == "?":
        return []
        
    try:
        white_elo = int(white_elo)
        black_elo = int(black_elo)
    except ValueError:
        return []

    data = []
    board = game.board()
    
    for move in game.mainline_moves():
        current_elo = white_elo if board.turn == chess.WHITE else black_elo


        
        try:
            best_move, best_score, analysis = analyze_position_worker(board)
            
            if best_move is None:
                board.push(move)
                continue

            human_move = move
            
            human_move_score = None
            for pv in analysis:
                if pv["pv"][0] == human_move:
                    human_move_score = pv["score"].relative.score(mate_score=10000)
                    break
            
            if human_move_score is None:
                board.push(human_move)
                info_human = engine.analyse(board, chess.engine.Limit(depth=5)) 
                try:
                    human_move_score = -info_human["score"].relative.score(mate_score=10000)
                except:
                    human_move_score = -9999 
                board.pop() 
            
            score_diff = best_score - human_move_score
            
            data.append({
                "fen": board.fen(),
                "elo": current_elo,
                "best_score": best_score,
                "human_score": human_move_score,
                "score_diff": score_diff, 
                "is_blunder": 1 if score_diff > 100 else 0, 
                "complexity": 0 
            })
            
        except Exception as e:
            # print(f"Error analyzing position: {e}")
            pass
        
        board.push(move)
        
    return data

def process_games_multiprocess():
    if not os.path.exists(PROCESSED_DIR):
        os.makedirs(PROCESSED_DIR)
    
    if not os.path.exists(PGN_FILE):
        print(f"Error: {PGN_FILE} not found. Please place your PGN file there.")
        return

    # Read all games into memory (or a list) to distribute
    # CAUTION: If PGN is huge, this might eat RAM. 
    # For 100k games it might be okay, but streaming is better.
    # We will use imap to stream tasks as we read.
    
    cpu_count = os.cpu_count() or 1
    print(f"Starting processing with {cpu_count} cores...")
    
    games_buffer = []
    
    with open(PGN_FILE) as f:
        count = 0
        while count < MAX_GAMES:
            try:
                game = chess.pgn.read_game(f)
                if game is None:
                    break
                games_buffer.append(game)
                count += 1
            except Exception:
                break
                
    print(f"Loaded {len(games_buffer)} games. Distributing to workers...")
    
    all_data = []
    
    # Use Pool
    with multiprocessing.Pool(processes=cpu_count, initializer=init_worker) as pool:
        # chunksize adjustment can help performance
        # Use imap_unordered to get results as soon as they are ready for the progress bar
        results_iterator = pool.imap_unordered(process_single_game, games_buffer, chunksize=10)
        
        # Use tqdm for progress bar
        from tqdm import tqdm
        for res in tqdm(results_iterator, total=len(games_buffer), desc="Processing Games"):
            all_data.extend(res)
            
    # Save to CSV
    df = pd.DataFrame(all_data)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"Saved {len(df)} positions to {OUTPUT_FILE}")

if __name__ == "__main__":
    # creating the processed directory if it doesn't exist
    if not os.path.exists(PROCESSED_DIR):
        os.makedirs(PROCESSED_DIR)
    # Start
    process_games_multiprocess()

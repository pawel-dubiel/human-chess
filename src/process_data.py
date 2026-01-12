import chess
import chess.pgn
import chess.engine
import pandas as pd
import os
import random

# Configuration
STOCKFISH_PATH = "/opt/homebrew/bin/stockfish" # Adjust if needed
DATA_DIR = "data/raw"
PROCESSED_DIR = "data/processed"
PGN_FILE = os.path.join(DATA_DIR, "games.pgn")
OUTPUT_FILE = os.path.join(PROCESSED_DIR, "chess_complexity_data.csv")
DEPTH = 10
MAX_GAMES = 2000

def analyze_position(engine, board):
    print(f"Analyzing position: {board.fen()}", flush=True)
    info = engine.analyse(board, chess.engine.Limit(depth=DEPTH), multipv=5)
    
    if not info:
        return None, 0, 0
        
    best_move = info[0]["pv"][0]
    score = info[0]["score"].relative.score(mate_score=10000)
    return best_move, score, info

def process_games():
    if not os.path.exists(PROCESSED_DIR):
        os.makedirs(PROCESSED_DIR)
        
    engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
    
    data = []
    
    if not os.path.exists(PGN_FILE):
        print(f"Error: {PGN_FILE} not found. Please place your PGN file there.")
        return

    print(f"Processing {PGN_FILE}...")
    
    with open(PGN_FILE) as f:
        game_count = 0
        while True:
            try:
                game = chess.pgn.read_game(f)
            except:
                break
                
            if game is None:
                break
            
            game_count += 1
            if game_count > MAX_GAMES:
                break
            
            # Filter by Elo if available
            white_elo = game.headers.get("WhiteElo", "?")
            black_elo = game.headers.get("BlackElo", "?")
            
            if game_count % 1 == 0:
                print(f"Processing Game {game_count}/{MAX_GAMES} (White: {white_elo}, Black: {black_elo})", flush=True)
            
            # Skip if Elo is missing
            if white_elo == "?" or black_elo == "?":
                print(f"Skipping game {game_count}: Missing Elo")
                continue

            try:
                white_elo = int(white_elo)
                black_elo = int(black_elo)
            except ValueError:
                print(f"Skipping game {game_count}: Invalid Elo format")
                continue 

            board = game.board()
            
            for move in game.mainline_moves():
                # Analyze position BEFORE the move is made
                current_elo = white_elo if board.turn == chess.WHITE else black_elo

                if board.fullmove_number < 5:
                    board.push(move)
                    continue
                
                try:
                    best_move, best_score, analysis = analyze_position(engine, board)
                    
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
                        # Threshold for blunder: 100 centipawns (1.0 pawn score).
                        # This allows for "different but equal" moves (+/- 1.0 tolerance).
                        "is_blunder": 1 if score_diff > 100 else 0, 
                        "complexity": 0 
                    })
                    
                except Exception as e:
                    print(f"Error analyzing position: {e}")
                
                board.push(move)
                
    engine.quit()
    
    # Save to CSV
    df = pd.DataFrame(data)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"Saved {len(df)} positions to {OUTPUT_FILE}")

if __name__ == "__main__":
    process_games()

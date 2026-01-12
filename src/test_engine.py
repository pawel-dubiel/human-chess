from src.human_engine import HumanEngine
import chess

def test():
    print("Initializing engine...")
    engine = HumanEngine()
    
    print("Setting position to start...")
    engine.board = chess.Board()
    
    print("Getting best move...")
    best_move = engine.get_best_move(time_limit=0.5)
    print(f"Best Move: {best_move}")
    
    print("Test passed!")
    engine.engine.quit()

if __name__ == "__main__":
    test()

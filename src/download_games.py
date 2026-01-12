import requests
import os
import gzip
import shutil

DATA_DIR = "data/raw"
# Downloading a small sample of games from Lichess (e.g., from a specific month, but filtered)
# For this prototype, we'll download a small manually selected file or a partial stream if possible.
# Lichess open database is huge. We can use the Lichess API to get games of specific players or just a few TOP games.
# Let's try to get games from a specific user or the TV feed if possible, or just download a very small monthly chunk (which is still large).
# BETTER APPROACH: Use Lichess API to download 100 random games of high rated players.

# Lichess API endpoint for games
API_URL = "https://lichess.org/api/games/user/"
PLAYERS = ["Maia1", "Maia5", "Maia9", "MagnusCarlsen"]
MAX_GAMES = 200

def download_games(player):
    print(f"Downloading games for {player}...")
    url = f"{API_URL}{player}?max={MAX_GAMES}&perfType=blitz,rapid,classical&pgnInJson=false"
    headers = {"Accept": "application/x-chess-pgn"}
    try:
        response = requests.get(url, headers=headers, stream=True)
        response.raise_for_status()
        
        filepath = os.path.join(DATA_DIR, f"{player}_games.pgn")
        with open(filepath, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"Saved to {filepath}")
    except Exception as e:
        print(f"Error downloading {player}: {e}")

def main():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        
    for player in PLAYERS:
        download_games(player)
        
    # Combine them
    with open(os.path.join(DATA_DIR, "combined_games.pgn"), 'wb') as outfile:
        for player in PLAYERS:
            filepath = os.path.join(DATA_DIR, f"{player}_games.pgn")
            if os.path.exists(filepath):
                with open(filepath, 'rb') as infile:
                    outfile.write(infile.read())
    
    print("Download complete.")

if __name__ == "__main__":
    main()

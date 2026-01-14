import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, random_split
from dataset import HumanChessDataset
from model import ChessBlunderCNN
import os
import argparse
from huggingface_hub import HfApi

# Configuration
DATA_FILE = "data/processed/chess_complexity_data.csv"
MODEL_DIR = "models"
MODEL_NAME = "human-chess-blunder-cnn"
BATCH_SIZE = 32
LEARNING_RATE = 0.001

def train(epochs=10, push_to_hub=False, repo_id=None):
    # Check if data exists
    if not os.path.exists(DATA_FILE):
        print(f"Error: {DATA_FILE} not found. Please run process_data.py first.")
        return

    # Device
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Using device: {device}")

    # Data
    dataset = HumanChessDataset(DATA_FILE)
    if len(dataset) == 0:
        print("Dataset is empty.")
        return

    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_data, val_data = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_data, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_data, batch_size=BATCH_SIZE)

    # Model
    model = ChessBlunderCNN().to(device)
    
    # Optimizer & Loss
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    criterion = nn.BCELoss() # Binary Cross Entropy

    # Loop
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        
        for board, elo, label in train_loader:
            board, elo, label = board.to(device), elo.to(device), label.to(device)
            
            optimizer.zero_grad()
            output = model(board, elo)
            loss = criterion(output, label)
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            
        # Validation
        model.eval()
        val_loss = 0
        correct = 0
        total = 0
        with torch.no_grad():
            for board, elo, label in val_loader:
                board, elo, label = board.to(device), elo.to(device), label.to(device)
                output = model(board, elo)
                val_loss += criterion(output, label).item()
                
                predicted = (output > 0.5).float()
                correct += (predicted == label).sum().item()
                total += label.size(0)
        
        print(f"Epoch {epoch+1}/{epochs} | "
              f"Train Loss: {total_loss/len(train_loader):.4f} | "
              f"Val Loss: {val_loss/len(val_loader):.4f} | "
              f"Val Acc: {100 * correct / total:.2f}%")

    # Save locally
    if not os.path.exists(MODEL_DIR):
        os.makedirs(MODEL_DIR)
        
    print(f"Saving model to {MODEL_DIR}/{MODEL_NAME}...")
    model.save_pretrained(f"{MODEL_DIR}/{MODEL_NAME}")
    
    # Push to Hub
    if push_to_hub and repo_id:
        print(f"Pushing to Hugging Face Hub: {repo_id}...")
        try:
            model.push_to_hub(repo_id)
            print("Successfully pushed to Hub!")
        except Exception as e:
            print(f"Failed to push to Hub: {e}")
            print("You may need to run 'huggingface-cli login' first.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=10, help="Number of epochs")
    parser.add_argument("--push", action="store_true", help="Push to HF Hub")
    parser.add_argument("--repo", type=str, help="HF Repo ID (e.g. username/human-chess)")
    args = parser.parse_args()
    
    train(epochs=args.epochs, push_to_hub=args.push, repo_id=args.repo)

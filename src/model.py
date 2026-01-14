import torch
import torch.nn as nn
import torch.nn.functional as F
from huggingface_hub import PyTorchModelHubMixin

class ChessBlunderCNN(nn.Module, PyTorchModelHubMixin):
    """
    A CNN model that takes a chess board state (12x8x8) and an Elo rating
    to predict the probability of a human blunder.
    
    Mixin enables:
    - model.save_pretrained("path")
    - model.push_to_hub("repo")
    - ChessBlunderCNN.from_pretrained("repo")
    """
    def __init__(self):
        super().__init__()
        
        # Convolutional Layers for Board Processing
        # Input: (12, 8, 8)
        self.conv1 = nn.Conv2d(12, 64, kernel_size=3, padding=1)
        self.conv2 = nn.Conv2d(64, 64, kernel_size=3, padding=1)
        self.pool = nn.MaxPool2d(2, 2) # Output: (64, 4, 4)
        
        self.conv3 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        # Output after conv3: (128, 4, 4) -> Flatten -> 128*4*4 = 2048
        
        # Fully Connected Layers
        self.fc_board = nn.Linear(128 * 4 * 4, 128)
        
        # Elo Processing
        self.fc_elo = nn.Linear(1, 16)
        
        # Combined Processing
        self.fc_combined = nn.Linear(128 + 16, 64)
        self.dropout = nn.Dropout(0.5)
        self.fc_out = nn.Linear(64, 1)

    def forward(self, board, elo):
        # Board Branch
        x = F.relu(self.conv1(board))
        x = F.relu(self.conv2(x))
        x = self.pool(x)
        
        x = F.relu(self.conv3(x))
        x = x.view(-1, 128 * 4 * 4) # Flatten
        
        x = F.relu(self.fc_board(x))
        
        # Elo Branch
        y = F.relu(self.fc_elo(elo))
        
        # Combine
        combined = torch.cat((x, y), dim=1)
        z = F.relu(self.fc_combined(combined))
        z = self.dropout(z)
        
        # Output (Sigmoid for probability)
        out = torch.sigmoid(self.fc_out(z))
        
        return out

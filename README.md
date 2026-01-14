---
title: Human Like Chess AI
emoji: ♟️
colorFrom: gray
colorTo: black
sdk: docker
pinned: false
app_port: 7860
---

# Human-Like Chess AI: Blunder Detector

This agent predicts the probability that a human player (of a given Elo) will make a blunder in a given position.

## Stack
- **Frontend**: React (Vite) + Chessground
- **Backend**: FastAPI
- **Model**: PyTorch CNN

## How it works

The model (CNN) analyzes the board state (12 channels) and Elo rating to estimate human error probability.

## Endpoints
- `POST /predict`: Get error probability.
- `POST /predict_moves`: Get heatmap for all legal moves.

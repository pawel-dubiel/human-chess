---
title: Human Like Chess AI
emoji: ♟️
colorFrom: gray
colorTo: black
sdk: gradio
sdk_version: 5.0.0
app_file: app.py
pinned: false
---

# Human-Like Chess AI: Blunder Detector

This agent predicts the probability that a human player (of a given Elo) will make a blunder in a given position.

## How it works

The model is a **Convolutional Neural Network (CNN)** trained on thousands of Lichess games. It analyzes the board state (12 channels for pieces) and the player's Elo rating to estimate human error probability.

## Input

- **FEN**: Forsyth-Edwards Notation of the chess position.
- **Elo**: The rating of the player to move.

## Output

- **Blunder Probability**: A score from 0 to 1 indicating likelihood of a significant error.

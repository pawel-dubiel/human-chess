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

## Metric Definition: Human Error Probability

The **Human Error Probability** displayed by this AI is formally defined as:

> **The predicted likelihood ($P$) that a human player of a given Elo rating, in the current board position, will make a move that is considered a "Blunder".**

### Calculating "Blunder" (Ground Truth)
During training, we label a move as a **Blunder** (1) or **Not a Blunder** (0) based on Stockfish 14+ evaluations at depth 10.

$$
IsBlunder =
\begin{cases}
1 & \text{if } (Score_{best} - Score_{human}) > 100 \text{ centipawns} \\
0 & \text{otherwise}
\end{cases}
$$

*   **$Score_{best}$**: The evaluation of the absolute best move found by the engine.
*   **$Score_{human}$**: The evaluation of the move actually played by the human.
*   **Threshold**: > 100 centipawns (equivalent to losing 1 pawn's worth of advantage).

### Model Prediction
The model takes two inputs:
1.  **Board State**: Representation of all pieces (CNN).
2.  **Elo Rating**: The rating of the player whose turn it is.

It outputs a single scalar value between 0 and 1:
*   **0.0**: Extremely unlikely to blunder (Move is "obvious" or position is simple).
*   **1.0**: Almost certain to blunder (Position is highly complex or "trap-heavy").

## Endpoints
- `POST /predict`: Get error probability.
- `POST /predict_moves`: Get heatmap for all legal moves.

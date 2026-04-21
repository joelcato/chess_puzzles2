# Chess Puzzles

A web app for working through chess puzzle sets, with progress tracking and cross-device resume support.

**Live at https://chess-puzzles2.web.app**

---

## Features

- **Two puzzle sets included:**
  - *Polgar 5334* — 5,334 puzzles organized into chapters (mate in 1, 2, 3, etc.), numbered by their book position
  - *Lichess Mating Patterns* — curated mating pattern puzzles sourced from Lichess, organized by theme and rating band

- **Puzzle solving**
  - Interactive chessboard powered by [react-chessboard](https://github.com/Clariity/react-chessboard) and [chess.js](https://github.com/jhlywa/chess.js)
  - Board automatically flips for black-to-move puzzles
  - Multi-move puzzles: after each correct move, the opponent's response plays automatically
  - FEN display with one-click copy
  - Lichess puzzles show rating, popularity, play count, and a link to the source game

- **Navigation**
  - Select puzzle set, chapter, and puzzle number independently
  - Prev/Next arrow buttons and direct jump via dropdown + Go button
  - Automatically advances to the next puzzle on solve
  - Auto-advances to the next chapter on chapter completion

- **Progress tracking (requires Google login)**
  - Progress saved to Firebase Firestore
  - Resume from exactly where you left off, across devices and sessions
  - Chapter dropdown always takes you to your first unsolved puzzle
  - Auto-logout after 1 hour of inactivity

- **Profile page**
  - Visual grid showing solved (green) / unsolved (red) status for every puzzle in a chapter
  - Click any puzzle to jump directly to it
  - Right-click any puzzle box to individually mark as done or not done
  - Reset buttons for individual chapter, entire puzzle set, or all progress

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Chess logic | chess.js 1.x |
| Board UI | react-chessboard |
| Auth | Firebase Authentication (Google Sign-In) |
| Database | Firebase Firestore |
| Hosting | Firebase Hosting |

---

## Local Development

```bash
npm install
npx vite          # dev server at http://localhost:5173
```

Requires a `.env` file with Firebase config:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## Build & Deploy

```bash
npx vite build
npm run deploy    # deploys to Firebase Hosting
```


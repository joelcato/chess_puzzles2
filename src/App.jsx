import { useEffect, useState } from 'react';
import './App.css';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import puzzleSets from './assets/puzzleSets';
import { db, auth, provider } from './firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import loadUserProgress from './utils/loadUserProgress';
import saveUserProgress from './utils/saveUserProgress';
import saveResumeState from './utils/saveResumeState';
import unpackSolution from './utils/unpackSolution';
import useAutoLogout from './utils/useAutoLogout';
import ProfilePage from './ProfilePage';

function App() {
  useAutoLogout(3600000); // 1 hour

  // ── Puzzle set & chapter selection ─────────────────────────────────────────
  const [activeSetIndex, setActiveSetIndex] = useState(0);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);

  const activeSet = puzzleSets[activeSetIndex];
  const activeChapter = activeSet.chapters[activeChapterIndex];
  const puzzlesInChapter = activeChapter.puzzles;
  const numberOfPuzzles = puzzlesInChapter.length;

  // ── Puzzle navigation state ────────────────────────────────────────────────
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [game, setGame] = useState(new Chess());
  const [gamePosition, setGamePosition] = useState('');
  const [correctMoves, setCorrectMoves] = useState([]);
  const [correctMoveIndex, setCorrectMoveIndex] = useState(0);
  const [promptText, setPromptText] = useState('');
  const [resultText, setResultText] = useState('');
  const [selectedProblemIndex, setSelectedProblemIndex] = useState(0);

  // ── Auth & progress ────────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [userProgress, setUserProgress] = useState({});
  // resumeTarget: when login sets a specific puzzle to land on after chapter change
  const [resumeTarget, setResumeTarget] = useState(null);
  // ── Page navigation ────────────────────────────────────────────────────────
  const [page, setPage] = useState('puzzle'); // 'puzzle' | 'profile'

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser(user);
        loadUserProgress(user.uid).then((progress) => {
          setUserProgress(progress);

          const resume = progress._resume;
          if (resume) {
            // Find the set and chapter indices from the saved resume
            const setIdx = puzzleSets.findIndex((s) => s.id === resume.setId);
            if (setIdx !== -1) {
              const chapter = puzzleSets[setIdx].chapters[resume.chapterIndex];
              if (chapter) {
                const puzzleIdx = chapter.puzzles.findIndex(
                  (p) => p.puzzle_id === resume.puzzleId
                );
                setActiveSetIndex(setIdx);
                setActiveChapterIndex(resume.chapterIndex);
                // goToProblem will fire via the chapter-change effect;
                // store the target so that effect can use it
                setResumeTarget(puzzleIdx !== -1 ? puzzleIdx : 0);
                return;
              }
            }
          }
          // No resume state — jump to first unsolved in current chapter
          const target = Math.max(0, firstUnsolvedIndex(activeSetIndex, activeChapterIndex, progress));
          goToProblem(target);
        });
      } else {
        setUser(null);
        setUserProgress({});
        goToProblem(0);
      }
    });
    return () => unsubscribe();
  }, []);

  // Helper: find first unsolved puzzle index in a given set+chapter
  function firstUnsolvedIndex(setIndex, chapterIndex, progress) {
    const puzzles = puzzleSets[setIndex].chapters[chapterIndex].puzzles;
    const setId = puzzleSets[setIndex].id;
    const setProgress = progress[setId] || {};
    return puzzles.findIndex((p) => !setProgress[p.puzzle_id]?.solved) ?? 0;
  }

  // When set or chapter changes, jump to resume target (if just logged in),
  // first unsolved (if logged in), or puzzle 0 (if not logged in)
  useEffect(() => {
    let target = 0;
    if (resumeTarget !== null) {
      target = resumeTarget;
      setResumeTarget(null);
    } else if (user) {
      target = Math.max(0, firstUnsolvedIndex(activeSetIndex, activeChapterIndex, userProgress));
      // Save resume state when switching chapters
      const puzzle = puzzleSets[activeSetIndex].chapters[activeChapterIndex].puzzles[target];
      if (puzzle) {
        saveResumeState(user.uid, puzzleSets[activeSetIndex].id, activeChapterIndex, puzzle.puzzle_id);
      }
    }
    goToProblem(target);
  }, [activeSetIndex, activeChapterIndex]);

  // When puzzle index changes via navigation (arrows, go button, auto-advance)
  useEffect(() => {
    goToProblem(currentProblemIndex);
  }, [currentProblemIndex]);

  // ── Core puzzle logic ──────────────────────────────────────────────────────

  function goToProblem(index) {
    const puzzles = puzzleSets[activeSetIndex].chapters[activeChapterIndex].puzzles;
    const problem = puzzles[index];
    if (!problem) return;

    setCurrentProblemIndex(index);
    setSelectedProblemIndex(index);

    const newCorrectMoves = unpackSolution(problem.moves);
    setCorrectMoves(newCorrectMoves);
    setCorrectMoveIndex(0);

    const newGame = new Chess(problem.fen);
    setGamePosition(newGame.fen());
    setGame(newGame);
    setPromptText(`${problem.first} — ${problem.type}`);
    setResultText('Make a Move');
  }

  function onDrop(sourceSquare, targetSquare, piece) {
    const currentMove = correctMoves[correctMoveIndex];

    if (!currentMove) {
      setResultText('Invalid move. No further moves expected.');
      return false;
    }

    const { from, to, promotion } = currentMove;

    if (
      sourceSquare === from &&
      targetSquare === to &&
      (!promotion || promotion === piece[1]?.toLowerCase())
    ) {
      const move = game.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: promotion ?? piece[1]?.toLowerCase() ?? 'q',
      });

      if (move === null) return false;

      setGamePosition(game.fen());

      const nextMoveIndex = correctMoveIndex + 1;

      if (nextMoveIndex >= correctMoves.length) {
        setResultText('Puzzle Solved! Good job!');
        const puzzle = puzzlesInChapter[currentProblemIndex];
        const nextIndex = (currentProblemIndex + 1) % numberOfPuzzles;
        const nextPuzzle = puzzlesInChapter[nextIndex];
        setTimeout(() => {
          if (user) {
            saveUserProgress(user.uid, activeSet.id, puzzle.puzzle_id);
            // Update local progress state so chapter-switching uses fresh data
            setUserProgress((prev) => ({
              ...prev,
              [activeSet.id]: {
                ...(prev[activeSet.id] || {}),
                [puzzle.puzzle_id]: { solved: true },
              },
            }));
            // Update resume to the next puzzle
            if (nextPuzzle) {
              saveResumeState(user.uid, activeSet.id, activeChapterIndex, nextPuzzle.puzzle_id);
            }
          }
          setCurrentProblemIndex(nextIndex);
        }, 500);
        return true;
      }

      setResultText('Good Move!');

      setTimeout(() => {
        const computerMove = correctMoves[nextMoveIndex];
        game.move(computerMove);
        setGamePosition(game.fen());
        setCorrectMoveIndex(nextMoveIndex + 1);
      }, 300);

      return true;
    } else {
      setResultText('Sorry. Incorrect :(');
      return false;
    }
  }

  // ── Derived values for display ─────────────────────────────────────────────
  const currentPuzzle = puzzlesInChapter[currentProblemIndex];

  if (page === 'profile') {
    return (
      <ProfilePage
        userProgress={userProgress}
        initialSetIndex={activeSetIndex}
        initialChapterIndex={activeChapterIndex}
        onBack={() => setPage('puzzle')}
        onNavigate={(setIdx, chapterIdx, puzzleIdx) => {
          setActiveSetIndex(setIdx);
          setActiveChapterIndex(chapterIdx);
          setCurrentProblemIndex(puzzleIdx);
          setPage('puzzle');
        }}
      />
    );
  }

  return (
    <div className='app-container'>

      {/* Title */}
      <div id="main-header">
        <h1>Chess Puzzles</h1>
      </div>

      {/* Login */}
      <div id="login-container">
        {!user ? (
          <div>
            <button
              className="button"
              id="login-button"
              onClick={() => signInWithPopup(auth, provider)}
            >
              Log In
            </button>
            <p id="login-status">Please log in.</p>
          </div>
        ) : (
          <div>
            <button
              className="button"
              id="logout-button"
              onClick={() => signOut(auth)}
            >
              Log Out
            </button>
            <p id="login-status">
              Hi{' '}
              <button className="profile-link" onClick={() => setPage('profile')}>
                {user.displayName}
              </button>
              . You are logged in.
            </p>
          </div>
        )}
      </div>

      {/* Puzzle set selector */}
      <div id="puzzle-set-select-container">
        <label id="select-puzzle-set-text" htmlFor="puzzle-set-select">
          Select puzzle set:
        </label>
        <select
          id="puzzle-set-select"
          value={activeSetIndex}
          onChange={(e) => {
            setActiveSetIndex(parseInt(e.target.value));
            setActiveChapterIndex(0);
          }}
        >
          {puzzleSets.map((set, i) => (
            <option key={set.id} value={i}>
              {set.name}
            </option>
          ))}
        </select>
      </div>

      {/* Chapter selector */}
      <div id="chapter-select-container">
        <label id="select-chapter-text" htmlFor="chapter-select">
          Chapter:
        </label>
        <select
          id="chapter-select"
          value={activeChapterIndex}
          onChange={(e) => setActiveChapterIndex(parseInt(e.target.value))}
        >
          {activeSet.chapters.map((chapter, i) => (
            <option key={i} value={i}>
              {chapter.title}
            </option>
          ))}
        </select>
      </div>

      {/* Problem number selector */}
      <div id="problem-select-container">
        <label id="select-problem-text" htmlFor="problem-select">
          Select problem number:
        </label>
        <button
          className="button"
          id="navigation-button-prev"
          onClick={() =>
            setCurrentProblemIndex(
              (currentProblemIndex - 1 + numberOfPuzzles) % numberOfPuzzles
            )
          }
        >
          &#9664;
        </button>
        <select
          id="problem-select"
          value={selectedProblemIndex}
          onChange={(e) => setSelectedProblemIndex(parseInt(e.target.value))}
        >
          {puzzlesInChapter.map((p, index) => (
            <option key={p.puzzle_id} value={index}>
              {isNaN(p.puzzle_id) ? index + 1 : p.puzzle_id}
            </option>
          ))}
        </select>
        <button
          className="button"
          id="navigation-button-next"
          onClick={() =>
            setCurrentProblemIndex((currentProblemIndex + 1) % numberOfPuzzles)
          }
        >
          &#9654;
        </button>
        <button
          className="button"
          id="go-button"
          onClick={() => goToProblem(selectedProblemIndex)}
        >
          Go
        </button>
      </div>

      {/* Puzzle area */}
      <div id="puzzle-container">
        <div id="PuzzleNumberText">
          <h2>Puzzle #{currentProblemIndex + 1}</h2>
        </div>
        <div id="PromptText">{promptText}</div>
        <div id="ResultText">{resultText}</div>
        <div id="ChessBoardContainer">
          <Chessboard
            id="ChessBoard"
            position={gamePosition}
            onPieceDrop={onDrop}
            customBoardStyle={{
              borderRadius: '4px',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
            }}
            customNotationStyle={{
              fontSize: '12px',
              fontWeight: 'bold',
            }}
          />
        </div>
        <div id="FEN-container">
          <div id="FEN-Label">FEN:</div>
          <div id="FEN-Text">{gamePosition}</div>
          <div id="FEN-Copy-Button-container">
            <button
              className="button"
              id="FEN-copy-button"
              onClick={() => navigator.clipboard.writeText(gamePosition)}
            >
              Copy FEN
            </button>
          </div>
        </div>

        {/* Optional metadata (Lichess puzzles) */}
        {currentPuzzle?.game_url && (
          <div id="puzzle-metadata">
            <span className="metadata-item">
              ID:{' '}
              <a
                href={`https://lichess.org/training/${currentPuzzle.puzzle_id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {currentPuzzle.puzzle_id}
              </a>
            </span>
            {currentPuzzle.rating != null && (
              <span className="metadata-item">
                Rating: {currentPuzzle.rating}
                {currentPuzzle.rating_deviation != null &&
                  ` ±${currentPuzzle.rating_deviation}`}
              </span>
            )}
            {currentPuzzle.popularity != null && (
              <span className="metadata-item">
                Popularity: {currentPuzzle.popularity}%
              </span>
            )}
            {currentPuzzle.nb_plays != null && (
              <span className="metadata-item">
                Plays: {currentPuzzle.nb_plays.toLocaleString()}
              </span>
            )}
            <a
              className="metadata-item"
              href={currentPuzzle.game_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View game on Lichess ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

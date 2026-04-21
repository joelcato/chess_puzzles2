import { useEffect, useRef, useState, useCallback } from 'react';
import './App.css';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { auth, provider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import loadUserProgress from './utils/loadUserProgress';
import saveUserProgress from './utils/saveUserProgress';
import saveResumeState from './utils/saveResumeState';
import deleteUserProgress from './utils/deleteUserProgress';
import unpackSolution from './utils/unpackSolution';
import useAutoLogout from './utils/useAutoLogout';
import ProfilePage from './ProfilePage';

function App() {
  useAutoLogout(3600000); // 1 hour

  // ── Puzzle sets (dynamically loaded) ───────────────────────────────────────
  const [puzzleSets, setPuzzleSets] = useState([]);
  const [setsLoading, setSetsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      import('./assets/polgar.json'),
      import('./assets/lichess_mating_patterns.json'),
    ]).then(([polgar, lichess]) => {
      setPuzzleSets([polgar.default, lichess.default]);
      setSetsLoading(false);
    });
  }, []);

  // ── Puzzle set & chapter selection ─────────────────────────────────────────
  const [activeSetIndex, setActiveSetIndex] = useState(0);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);

  const activeSet = puzzleSets[activeSetIndex];
  const activeChapter = activeSet?.chapters[activeChapterIndex];
  const puzzlesInChapter = activeChapter?.puzzles ?? [];
  const numberOfPuzzles = puzzlesInChapter.length;

  // ── Puzzle navigation state ────────────────────────────────────────────────
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const gameRef = useRef(new Chess());
  const [gamePosition, setGamePosition] = useState('');
  const [boardOrientation, setBoardOrientation] = useState('white');
  const [correctMoves, setCorrectMoves] = useState([]);
  const [correctMoveIndex, setCorrectMoveIndex] = useState(0);
  const [promptText, setPromptText] = useState('');
  const [resultText, setResultText] = useState('');
  const [selectedProblemIndex, setSelectedProblemIndex] = useState(0);

  // ── Auth & progress ────────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [userProgress, setUserProgress] = useState({});
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  // resumeTarget: when login sets a specific puzzle to land on after chapter change
  const [resumeTarget, setResumeTarget] = useState(null);
  // ── Page navigation ────────────────────────────────────────────────────────
  const [page, setPage] = useState('puzzle'); // 'puzzle' | 'profile'

  // ── Core puzzle logic ──────────────────────────────────────────────────────

  const goToProblem = useCallback((index, sets = puzzleSets, setIdx = activeSetIndex, chapterIdx = activeChapterIndex) => {
    const puzzles = sets[setIdx]?.chapters[chapterIdx]?.puzzles;
    if (!puzzles) return;
    const problem = puzzles[index];
    if (!problem) return;

    setCurrentProblemIndex(index);
    setSelectedProblemIndex(index);

    const newCorrectMoves = unpackSolution(problem.moves);
    setCorrectMoves(newCorrectMoves);
    setCorrectMoveIndex(0);

    const newGame = new Chess(problem.fen);
    gameRef.current = newGame;
    setGamePosition(newGame.fen());
    setBoardOrientation(problem.fen.split(' ')[1] === 'b' ? 'black' : 'white');
    setPromptText(`${problem.first} — ${problem.type}`);
    setResultText('Make a Move');
  }, [puzzleSets, activeSetIndex, activeChapterIndex]);

  // Helper: find first unsolved puzzle index in a given set+chapter
  const firstUnsolvedIndex = useCallback((setIndex, chapterIndex, progress, sets = puzzleSets) => {
    const puzzles = sets[setIndex]?.chapters[chapterIndex]?.puzzles;
    if (!puzzles) return 0;
    const setId = sets[setIndex].id;
    const setProgress = progress[setId] || {};
    const idx = puzzles.findIndex((p) => !setProgress[p.puzzle_id]?.solved);
    return idx === -1 ? 0 : idx;
  }, [puzzleSets]);

  // Auth listener — runs once
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        setIsLoadingProgress(true);
        loadUserProgress(firebaseUser.uid).then((progress) => {
          setUserProgress(progress);
          setIsLoadingProgress(false);

          const resume = progress._resume;
          if (resume) {
            import('./assets/puzzleSets.js').then(({ default: sets }) => {
              const setIdx = sets.findIndex((s) => s.id === resume.setId);
              if (setIdx !== -1) {
                const chapter = sets[setIdx].chapters[resume.chapterIndex];
                if (chapter) {
                  const puzzleIdx = chapter.puzzles.findIndex(
                    (p) => p.puzzle_id === resume.puzzleId
                  );
                  setActiveSetIndex(setIdx);
                  setActiveChapterIndex(resume.chapterIndex);
                  setResumeTarget(puzzleIdx !== -1 ? puzzleIdx : 0);
                  return;
                }
              }
              // Fallback: go to first unsolved in current chapter
              setPuzzleSets((prevSets) => {
                const target = firstUnsolvedIndex(activeSetIndex, activeChapterIndex, progress, prevSets);
                goToProblem(target, prevSets, activeSetIndex, activeChapterIndex);
                return prevSets;
              });
            });
          } else {
            // No resume state — go to first unsolved
            setPuzzleSets((prevSets) => {
              const target = firstUnsolvedIndex(activeSetIndex, activeChapterIndex, progress, prevSets);
              goToProblem(target, prevSets, activeSetIndex, activeChapterIndex);
              return prevSets;
            });
          }
        });
      } else {
        setUser(null);
        setUserProgress({});
        goToProblem(0);
      }
    });
    return () => unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When puzzle sets finish loading: load puzzle 0 (only if no resume is pending)
  useEffect(() => {
    if (!setsLoading && resumeTarget === null) {
      goToProblem(0, puzzleSets, activeSetIndex, activeChapterIndex);
    }
  }, [setsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to resume target once both sets are loaded and target is known
  useEffect(() => {
    if (setsLoading || resumeTarget === null) return;
    goToProblem(resumeTarget, puzzleSets, activeSetIndex, activeChapterIndex);
    setResumeTarget(null);
  }, [resumeTarget, setsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // When set or chapter changes (user-initiated), jump to first unsolved
  const isFirstRender = useRef(true);
  const skipChapterEffect = useRef(false);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (setsLoading) return;
    if (skipChapterEffect.current) {
      skipChapterEffect.current = false;
      return;
    }
    if (resumeTarget !== null) return; // resumeTarget effect will handle navigation
    let target = 0;
    if (user) {
      target = firstUnsolvedIndex(activeSetIndex, activeChapterIndex, userProgress);
      const puzzle = puzzleSets[activeSetIndex]?.chapters[activeChapterIndex]?.puzzles[target];
      if (puzzle) {
        saveResumeState(user.uid, puzzleSets[activeSetIndex].id, activeChapterIndex, puzzle.puzzle_id);
      }
    }
    goToProblem(target);
  }, [activeSetIndex, activeChapterIndex]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const move = gameRef.current.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: promotion ?? piece[1]?.toLowerCase() ?? 'q',
      });

      if (move === null) return false;

      setGamePosition(gameRef.current.fen());

      const nextMoveIndex = correctMoveIndex + 1;

      if (nextMoveIndex >= correctMoves.length) {
        const puzzle = puzzlesInChapter[currentProblemIndex];
        const isLastInChapter = currentProblemIndex === numberOfPuzzles - 1;
        const nextIndex = currentProblemIndex + 1;

        if (isLastInChapter) {
          setResultText('Chapter complete! 🎉 Moving to the next chapter...');
          setTimeout(() => {
            if (user) {
              saveUserProgress(user.uid, activeSet.id, puzzle.puzzle_id);
              setUserProgress((prev) => ({
                ...prev,
                [activeSet.id]: {
                  ...(prev[activeSet.id] || {}),
                  [puzzle.puzzle_id]: { solved: true },
                },
              }));
            }
            const nextChapterIndex = activeChapterIndex + 1;
            if (nextChapterIndex < activeSet.chapters.length) {
              skipChapterEffect.current = true;
              setActiveChapterIndex(nextChapterIndex);
              goToProblem(0, puzzleSets, activeSetIndex, nextChapterIndex);
            }
          }, 1500);
        } else {
          setResultText('Puzzle Solved! Good job!');
          const nextPuzzle = puzzlesInChapter[nextIndex];
          setTimeout(() => {
            if (user) {
              saveUserProgress(user.uid, activeSet.id, puzzle.puzzle_id);
              setUserProgress((prev) => ({
                ...prev,
                [activeSet.id]: {
                  ...(prev[activeSet.id] || {}),
                  [puzzle.puzzle_id]: { solved: true },
                },
              }));
              if (nextPuzzle) {
                saveResumeState(user.uid, activeSet.id, activeChapterIndex, nextPuzzle.puzzle_id);
              }
            }
            goToProblem(nextIndex);
          }, 500);
        }
        return true;
      }

      setResultText('Good Move!');

      setTimeout(() => {
        const computerMove = correctMoves[nextMoveIndex];
        gameRef.current.move(computerMove);
        setGamePosition(gameRef.current.fen());
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

  if (setsLoading || isLoadingProgress) {
    return <div className="app-container"><p>Loading...</p></div>;
  }

  if (page === 'profile') {
    return (
      <ProfilePage
        userProgress={userProgress}
        puzzleSets={puzzleSets}
        initialSetIndex={activeSetIndex}
        initialChapterIndex={activeChapterIndex}
        onBack={() => setPage('puzzle')}
        onNavigate={(setIdx, chapterIdx, puzzleIdx) => {
          skipChapterEffect.current = true;
          setActiveSetIndex(setIdx);
          setActiveChapterIndex(chapterIdx);
          goToProblem(puzzleIdx, puzzleSets, setIdx, chapterIdx);
          setPage('puzzle');
        }}
        onMarkPuzzle={(setId, puzzleId) => {
          if (user) {
            saveUserProgress(user.uid, setId, puzzleId);
            setUserProgress((prev) => ({
              ...prev,
              [setId]: { ...(prev[setId] || {}), [puzzleId]: { solved: true } },
            }));
          }
        }}
        onMarkPuzzles={(setId, puzzleIds) => {
          if (user) {
            saveUserProgress(user.uid, setId, puzzleIds);
            setUserProgress((prev) => {
              const updated = { ...(prev[setId] || {}) };
              for (const id of puzzleIds) updated[id] = { solved: true };
              return { ...prev, [setId]: updated };
            });
          }
        }}
        onUnmarkPuzzle={(setId, puzzleId) => {
          if (user) {
            deleteUserProgress(user.uid, setId, puzzleId);
            setUserProgress((prev) => {
              const updated = { ...prev, [setId]: { ...(prev[setId] || {}) } };
              delete updated[setId][puzzleId];
              return updated;
            });
          }
        }}
        onResetChapter={(setId, puzzleIds) => {
          if (user) {
            deleteUserProgress(user.uid, setId, puzzleIds);
            setUserProgress((prev) => {
              const updated = { ...prev, [setId]: { ...(prev[setId] || {}) } };
              for (const id of puzzleIds) delete updated[setId][id];
              return updated;
            });
          }
        }}
        onResetSet={(setId) => {
          if (user) {
            deleteUserProgress(user.uid, setId);
            setUserProgress((prev) => {
              const updated = { ...prev };
              delete updated[setId];
              return updated;
            });
          }
        }}
        onResetAll={() => {
          if (user) {
            Promise.all(
              puzzleSets.map((s) => deleteUserProgress(user.uid, s.id))
            );
            setUserProgress((prev) => {
              const updated = { ...prev };
              for (const s of puzzleSets) delete updated[s.id];
              return updated;
            });
          }
        }}
      />
    );
  }

  return (
    <div className="app-container">

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
          {activeSet?.chapters.map((chapter, i) => (
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
            goToProblem(Math.max(0, currentProblemIndex - 1))
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
            goToProblem(Math.min(numberOfPuzzles - 1, currentProblemIndex + 1))
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
        <div id="puzzle-number-text">
          <h2>Puzzle #{isNaN(currentPuzzle?.puzzle_id) ? currentProblemIndex + 1 : currentPuzzle?.puzzle_id}</h2>
        </div>
        <div id="prompt-text">{promptText}</div>
        <div id="result-text">{resultText}</div>
        <div id="chess-board-container">
          <Chessboard
            id="chess-board"
            position={gamePosition}
            onPieceDrop={onDrop}
            boardOrientation={boardOrientation}
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
        <div id="fen-container">
          <div id="fen-label">FEN:</div>
          <div id="fen-text">{gamePosition}</div>
          <div id="fen-copy-button-container">
            <button
              className="button"
              id="fen-copy-button"
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

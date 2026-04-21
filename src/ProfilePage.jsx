import { useState, useEffect, useRef } from 'react';
import './ProfilePage.css';

function ProfilePage({ userProgress, puzzleSets, initialSetIndex, initialChapterIndex, onBack, onNavigate, onMarkPuzzle, onMarkPuzzles, onUnmarkPuzzle, onResetChapter, onResetSet, onResetAll }) {
  const [profileSetIndex, setProfileSetIndex] = useState(initialSetIndex ?? 0);
  const [profileChapterIndex, setProfileChapterIndex] = useState(initialChapterIndex ?? 0);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, puzzle }
  const contextMenuRef = useRef(null);

  const activeSet = puzzleSets[profileSetIndex];
  const activeChapter = activeSet.chapters[profileChapterIndex];
  const puzzles = activeChapter.puzzles;
  const setProgress = userProgress[activeSet.id] || {};

  const solvedCount = puzzles.filter((p) => setProgress[p.puzzle_id]?.solved).length;

  // Dismiss context menu on outside click
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  function handleContextMenu(e, puzzle, solved) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, puzzle, solved });
  }

  function handleToggleDone() {
    if (!contextMenu) return;
    if (contextMenu.solved) {
      onUnmarkPuzzle(activeSet.id, contextMenu.puzzle.puzzle_id);
    } else {
      onMarkPuzzle(activeSet.id, contextMenu.puzzle.puzzle_id);
    }
    setContextMenu(null);
  }

  function handleMarkChapterDoneToHere() {
    if (!contextMenu) return;
    const idx = puzzles.findIndex((p) => p.puzzle_id === contextMenu.puzzle.puzzle_id);
    const before = puzzles.slice(0, idx + 1).map((p) => p.puzzle_id);
    const after = puzzles.slice(idx + 1).map((p) => p.puzzle_id);
    onMarkPuzzles(activeSet.id, before);
    if (after.length > 0) onResetChapter(activeSet.id, after);
    setContextMenu(null);
  }

  function handleMarkChapterDone() {
    if (window.confirm(`Mark all puzzles in "${activeChapter.title}" as done?`)) {
      onMarkPuzzles(activeSet.id, puzzles.map((p) => p.puzzle_id));
    }
  }

  function handleMarkSetDone() {
    if (window.confirm(`Mark all puzzles in "${activeSet.name}" as done?`)) {
      const allIds = activeSet.chapters.flatMap((ch) => ch.puzzles.map((p) => p.puzzle_id));
      onMarkPuzzles(activeSet.id, allIds);
    }
  }

  function handleResetChapter() {
    if (window.confirm(`Reset all progress for "${activeChapter.title}"?`)) {
      const puzzleIds = puzzles.map((p) => p.puzzle_id);
      onResetChapter(activeSet.id, puzzleIds);
    }
  }

  function handleResetSet() {
    if (window.confirm(`Reset all progress for "${activeSet.name}"?`)) {
      onResetSet(activeSet.id);
    }
  }

  function handleResetAll() {
    if (window.confirm('Reset ALL progress across every puzzle set?')) {
      onResetAll();
    }
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <button className="button" id="profile-back-button" onClick={onBack}>
          ← Back to Puzzles
        </button>
        <h1>My Progress</h1>
      </div>

      <div className="profile-selectors">
        <div className="profile-selector-row">
          <button className="button reset-button" id="reset-all-button" onClick={handleResetAll}>
            Reset all progress
          </button>
        </div>
        <div className="profile-selector-row">
          <label htmlFor="profile-set-select">Puzzle set:</label>
          <select
            id="profile-set-select"
            value={profileSetIndex}
            onChange={(e) => {
              setProfileSetIndex(parseInt(e.target.value));
              setProfileChapterIndex(0);
            }}
          >
            {puzzleSets.map((set, i) => (
              <option key={set.id} value={i}>{set.name}</option>
            ))}
          </select>
          <button className="button mark-done-button" onClick={handleMarkSetDone}>
            Mark set done
          </button>
          <button className="button reset-button" onClick={handleResetSet}>
            Reset puzzle set
          </button>
        </div>
        <div className="profile-selector-row">
          <label htmlFor="profile-chapter-select">Chapter:</label>
          <select
            id="profile-chapter-select"
            value={profileChapterIndex}
            onChange={(e) => setProfileChapterIndex(parseInt(e.target.value))}
          >
            {activeSet.chapters.map((chapter, i) => (
              <option key={i} value={i}>{chapter.title}</option>
            ))}
          </select>
          <button className="button mark-done-button" onClick={handleMarkChapterDone}>
            Mark chapter done
          </button>
          <button className="button reset-button" onClick={handleResetChapter}>
            Reset chapter
          </button>
        </div>
      </div>

      <p className="profile-summary">
        {solvedCount} / {puzzles.length} solved
      </p>

      <div className="progress-grid">
        {puzzles.map((p, index) => {
          const solved = !!setProgress[p.puzzle_id]?.solved;
          return (
            <div
              key={p.puzzle_id}
              className={`progress-box ${solved ? 'solved' : 'unsolved'}`}
              title={`Puzzle ${isNaN(p.puzzle_id) ? index + 1 : p.puzzle_id}`}
              onClick={() => onNavigate(profileSetIndex, profileChapterIndex, index)}
              onContextMenu={(e) => handleContextMenu(e, p, solved)}
            >
              <span className="progress-box-label">{index + 1}</span>
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="context-menu-item" onClick={handleToggleDone}>
            {contextMenu.solved ? 'Mark as not done' : 'Mark as done'}
          </button>
          <button className="context-menu-item" onClick={handleMarkChapterDoneToHere}>
            Mark chapter done to here
          </button>
        </div>
      )}
    </div>
  );
}

export default ProfilePage;

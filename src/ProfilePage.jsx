import { useState } from 'react';
import puzzleSets from './assets/puzzleSets';
import './ProfilePage.css';

function ProfilePage({ userProgress, initialSetIndex, initialChapterIndex, onBack, onNavigate }) {
  const [profileSetIndex, setProfileSetIndex] = useState(initialSetIndex ?? 0);
  const [profileChapterIndex, setProfileChapterIndex] = useState(initialChapterIndex ?? 0);

  const activeSet = puzzleSets[profileSetIndex];
  const activeChapter = activeSet.chapters[profileChapterIndex];
  const puzzles = activeChapter.puzzles;
  const setProgress = userProgress[activeSet.id] || {};

  const solvedCount = puzzles.filter((p) => setProgress[p.puzzle_id]?.solved).length;

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
              title={`Puzzle ${p.puzzle_id}`}
              onClick={() => onNavigate(profileSetIndex, profileChapterIndex, index)}
            >
              <span className="progress-box-label">{index + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ProfilePage;

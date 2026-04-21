/**
 * Converts source JSON files into the standard puzzle set format used by the app.
 *
 * Standard format per puzzle set:
 * {
 *   "id": string,
 *   "name": string,
 *   "chapters": [
 *     {
 *       "title": string,
 *       "puzzles": [
 *         {
 *           "puzzle_id": string,
 *           "fen": string,           // position the player starts from
 *           "moves": string[],       // UCI array, e.g. ["f6g7", "h8g8"]
 *           "first": string,         // "White to Move" | "Black to Move"
 *           "type": string,          // e.g. "Mate in One", "Back Rank Mate"
 *           // optional metadata (Lichess only):
 *           "rating": number,
 *           "rating_deviation": number,
 *           "popularity": number,
 *           "nb_plays": number,
 *           "game_url": string
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * Move format notes:
 *   - Polgar source:  "f6-g7;h8-g8"  → ["f6g7", "h8g8"]
 *   - Lichess source: ["a7a8", "c8c1", ...]  moves[0] is the computer's setup move;
 *     player starts from display_fen, correctMoves = moves.slice(1)
 */

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '../src/assets');

// ─── Polgar conversion ────────────────────────────────────────────────────────

function convertPolgarMoves(movesStr) {
  // "f6-g7;h8-g8" → ["f6g7", "h8g8"]
  return movesStr.split(';').map((m) => m.replace('-', ''));
}

function convertPolgar() {
  const src = JSON.parse(
    fs.readFileSync(path.join(ASSETS_DIR, 'problems.json'), 'utf8')
  );

  // Chapter boundaries (start indices from the original app)
  const chapterDefs = [
    { title: 'Mates in One', start: 0 },
    { title: 'Mates in Two - White to Move', start: 306 },
    { title: 'Mates in Two - Black to Move', start: 1254 },
    { title: 'Mates in Three - White to Move', start: 3718 },
    { title: 'Mates in Three - Black to Move', start: 4138 },
  ];

  const allPuzzles = src.problems;

  const chapters = chapterDefs.map((def, i) => {
    const end =
      i + 1 < chapterDefs.length ? chapterDefs[i + 1].start : allPuzzles.length;
    const puzzles = allPuzzles.slice(def.start, end).map((p) => ({
      puzzle_id: String(p.problemid),
      fen: p.fen,
      moves: convertPolgarMoves(p.moves),
      first: p.first,
      type: p.type,
    }));
    return { title: def.title, puzzles };
  });

  return {
    id: 'polgar',
    name: 'Chess by László Polgár',
    chapters,
  };
}

// ─── Lichess Mating Patterns conversion ──────────────────────────────────────

function convertLichess() {
  const src = JSON.parse(
    fs.readFileSync(
      path.join(ASSETS_DIR, 'mating_patterns_100_by_theme.json'),
      'utf8'
    )
  );

  // Each source chapter is split into two: White to Move and Black to Move
  const chapters = [];

  for (const srcChapter of src.chapters) {
    const whiteToMove = [];
    const blackToMove = [];

    for (const p of srcChapter.puzzles) {
      const isBlack = p.side_to_move === 'b';
      const puzzle = {
        puzzle_id: p.puzzle_id,
        // display_fen is the position after the computer's setup move — this is
        // where the player starts
        fen: p.display_fen,
        // moves[0] is the setup move; correctMoves for the player are moves[1:]
        moves: p.moves.slice(1),
        first: isBlack ? 'Black to Move' : 'White to Move',
        type: srcChapter.title,
        // optional metadata
        rating: p.rating,
        rating_deviation: p.rating_deviation,
        popularity: p.popularity,
        nb_plays: p.nb_plays,
        game_url: p.game_url,
      };

      if (isBlack) {
        blackToMove.push(puzzle);
      } else {
        whiteToMove.push(puzzle);
      }
    }

    if (whiteToMove.length > 0) {
      chapters.push({
        title: `${srcChapter.title} - White to Move`,
        puzzles: whiteToMove,
      });
    }
    if (blackToMove.length > 0) {
      chapters.push({
        title: `${srcChapter.title} - Black to Move`,
        puzzles: blackToMove,
      });
    }
  }

  return {
    id: 'lichess_mating_patterns',
    name: 'Lichess Mating Patterns',
    chapters,
  };
}

// ─── Write output ─────────────────────────────────────────────────────────────

const polgar = convertPolgar();
const lichess = convertLichess();

fs.writeFileSync(
  path.join(ASSETS_DIR, 'polgar.json'),
  JSON.stringify(polgar, null, 2)
);
console.log(
  `polgar.json: ${polgar.chapters.length} chapters, ${polgar.chapters.reduce((s, c) => s + c.puzzles.length, 0)} puzzles`
);

fs.writeFileSync(
  path.join(ASSETS_DIR, 'lichess_mating_patterns.json'),
  JSON.stringify(lichess, null, 2)
);
console.log(
  `lichess_mating_patterns.json: ${lichess.chapters.length} chapters, ${lichess.chapters.reduce((s, c) => s + c.puzzles.length, 0)} puzzles`
);

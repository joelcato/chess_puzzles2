// Parses a list-of-lists of UCI moves (e.g. [["f6g7", "c7c8q"], ...]) into
// a list of solution paths, each being an array of { from, to, promotion }
// objects used by chess.js.
const parseMove = (move) => {
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  const promotion = move.length > 4 ? move[4] : undefined;
  return { from, to, promotion };
};

const unpackSolution = (movesListOfLists) => {
  return movesListOfLists.map((solution) => solution.map(parseMove));
};

export default unpackSolution;
  
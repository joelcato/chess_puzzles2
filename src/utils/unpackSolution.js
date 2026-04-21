// Parses a UCI moves array (e.g. ["f6g7", "c7c8q"]) into
// { from, to, promotion } objects used by chess.js.
const unpackSolution = (movesArray) => {
  return movesArray.map((move) => {
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promotion = move.length > 4 ? move[4] : undefined;
    return { from, to, promotion };
  });
};

export default unpackSolution;
  
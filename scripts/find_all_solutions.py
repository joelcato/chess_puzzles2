#!/usr/bin/env python3
"""
Preprocess chess puzzle JSON files to enumerate all valid solution lines.

Each puzzle's 'moves' field is converted from:
  ["e2e4", "e7e5", "f1c4"]              (single flat line)
to:
  [["e2e4", "e7e5", "f1c4"],            (list of all valid lines)
   ["d2d4", "e7e5", "f1c4"]]

Algorithm (per puzzle):
  1. Ask Stockfish for the true forced-mate depth from the starting FEN.
  2. At the player's turn, use high-multipv analysis to find every move
     that achieves mate in exactly that depth.
  3. For each such player move, let the opponent play Stockfish's best
     response (single move — we are not yet handling multiple defences).
  4. Recurse until checkmate.

Backs up each .json file to .json.bak before writing.
Also writes a human-readable report: find_all_solutions_report.txt

Usage:
  python3 scripts/find_all_solutions.py
  python3 scripts/find_all_solutions.py --limit 20                        # first 20 puzzles only
  python3 scripts/find_all_solutions.py --files polgar.json               # one file
  python3 scripts/find_all_solutions.py --puzzle-ids 71 154 261 324 632  # specific puzzles only
"""

import argparse
import json
import shutil
import sys
import chess
import chess.engine
from collections import defaultdict
from pathlib import Path

STOCKFISH_PATH = "stockfish"
ASSETS_DIR = Path(__file__).parent.parent / "src" / "assets"
REPORT_PATH = Path(__file__).parent / "find_all_solutions_report.txt"
DEFAULT_FILES = ["polgar.json", "lichess_mating_patterns.json"]

# Depth schedule for iterative-deepening mate search.
# The script tries each depth in order and stops at the first that returns a
# forced-mate score.  Depth 50 is the hard cap — no realistic forced mate
# in a short-puzzle set requires deeper search.
MATE_SEARCH_DEPTHS = [20, 25, 30, 35, 40, 50]
ANALYSIS_TIME = 0.1

# Max PV lines to request when enumerating player moves.
# Actual request is capped to the number of legal moves, so this is just an
# upper bound.  Forced-mate positions rarely have more than a handful of
# candidate moves.
MULTIPV = 10


def find_branch_points(solutions):
    """
    Return a list of 0-based player-move indices where independent branching
    occurs — i.e. two solutions share the same prefix up to that index but
    then diverge.  Player moves are at even positions (0, 2, 4, ...).
    """
    if len(solutions) <= 1:
        return []
    branch_points = []
    max_len = max(len(s) for s in solutions)
    for i in range(0, max_len, 2):  # only player-move positions
        # Group solutions by their prefix up to (not including) position i.
        groups = defaultdict(set)
        for s in solutions:
            if len(s) > i:
                prefix = tuple(s[:i])
                groups[prefix].add(s[i])
        # A real branch at i exists if any prefix group has more than one choice.
        if any(len(choices) > 1 for choices in groups.values()):
            branch_points.append(i)
    return branch_points


# ── Stockfish helpers ──────────────────────────────────────────────────────────

def find_true_mate_depth(engine, board, expected_depth=None, hint_move=None):
    """
    Ask Stockfish for the forced-mate depth (in full moves) for the side
    to move.

    Uses single-PV (fast even in complex positions).  When hint_move is
    provided (the first move of the stored solution), tries it first via
    root_moves — this catches sacrificial mates that SF's preferred
    material-winning line would otherwise obscure.  Falls back to unrestricted
    single-PV if the hint doesn't show a forced mate.

    Stops as soon as best_mate <= expected_depth.  Iterates through
    MATE_SEARCH_DEPTHS.  Returns None if depth 50 is exhausted with no mate.
    """
    best_mate = None

    def _check(result):
        score = result["score"].relative
        if score.is_mate() and score.mate() > 0:
            return score.mate()
        return None

    for depth in MATE_SEARCH_DEPTHS:
        # Try hint first (root_moves restricts SF to one move — very fast).
        hint_satisfied = False
        if hint_move and hint_move in board.legal_moves:
            result = engine.analyse(
                board, chess.engine.Limit(depth=depth), root_moves=[hint_move])
            m = _check(result)
            if m is not None and (best_mate is None or m < best_mate):
                best_mate = m
            # If hint already satisfies expected_depth, skip the expensive
            # unrestricted search (avoids hanging on complex 37-move positions).
            if best_mate is not None and (expected_depth is None or best_mate <= expected_depth):
                hint_satisfied = True

        if not hint_satisfied:
            # Unrestricted single-PV — needed when no hint or hint missed mate.
            result = engine.analyse(board, chess.engine.Limit(depth=depth))
            m = _check(result)
            if m is not None and (best_mate is None or m < best_mate):
                best_mate = m

        if best_mate is not None:
            if expected_depth is None or best_mate <= expected_depth:
                break  # found expected depth or better — stop

    return best_mate


def find_player_moves(engine, board, mate_in_n):
    """
    Return a deduplicated list of UCI move strings from the current position
    that each achieve mate in exactly mate_in_n moves.

    Uses multi-PV (capped to the number of legal moves) throughout because:
    - Multi-PV finds forced mates that single-PV misses (SF may prefer a
      materially winning but non-mating line in single-PV mode).
    - When the TT is warm (from the warm-up in find_solutions), the 0.1s quick
      search is already sufficient for the vast majority of positions.
    - Iterative deepening is the fallback for cold TT positions.
    """
    if mate_in_n == 1:
        # Direct checkmate detection — no Stockfish call needed.
        moves = []
        for move in board.legal_moves:
            board.push(move)
            if board.is_checkmate():
                moves.append(move.uci())
            board.pop()
        return moves

    n_legal = len(list(board.legal_moves))
    mpv = min(MULTIPV, n_legal)

    def _query(limit):
        results = engine.analyse(board, limit, multipv=mpv)
        if isinstance(results, dict):
            results = [results]
        found = []
        for info in results:
            score_obj = info.get("score")
            if score_obj is None:
                continue
            rel = score_obj.relative
            if rel.is_mate() and rel.mate() == mate_in_n:
                pv = info.get("pv", [])
                if pv:
                    found.append(pv[0].uci())
        return list(dict.fromkeys(found))

    # Quick multi-PV search (fast when TT is warm from warm-up).
    moves = _query(chess.engine.Limit(time=ANALYSIS_TIME))
    if moves:
        return moves

    # Iterative deepening fallback for positions with a cold TT.
    # Use time limits (not depth) so complex positions don't stall.
    for t in [0.5, 1.0, 2.0, 5.0]:
        moves = _query(chess.engine.Limit(time=t))
        if moves:
            return moves

    return []


def find_critical_opponent_response(engine, board, next_mate_depth):
    """
    Return the UCI move string for the opponent's most critical response —
    the legal move that leaves the player (side to move next) with the
    fewest continuations achieving mate in next_mate_depth.

    This collapses combinatorial explosions where the player has many
    equivalent mating moves after a weak defence, focusing the stored
    solutions on the hardest defensive try instead.

    Falls back to Stockfish's top choice when no opponent reply yields any
    surviving player moves (shouldn't happen in a truly forced position).
    """
    legal = list(board.legal_moves)
    if not legal:
        return None
    if len(legal) == 1:
        return legal[0].uci()

    # Stockfish fallback: used when every candidate yields 0 player responses.
    sf_result = engine.analyse(board, chess.engine.Limit(time=ANALYSIS_TIME))
    sf_pv = sf_result.get("pv", [])
    sf_best = sf_pv[0].uci() if sf_pv else legal[0].uci()

    best_move = sf_best
    best_count = float("inf")

    for move in legal:
        board.push(move)
        count = len(find_player_moves(engine, board, next_mate_depth))
        board.pop()
        # Only consider moves where the player still has at least one winning reply.
        if 0 < count < best_count:
            best_count = count
            best_move = move.uci()
            if best_count == 1:
                break  # can't do better

    return best_move


# ── Recursive solution finder ──────────────────────────────────────────────────

def find_solutions(engine, board, mate_in_n):
    """
    Recursively enumerate all solution lines from the current position.

    Returns a list of complete UCI move sequences, where each sequence is
    a list of strings:  [player_m1, opp_m1, player_m2, opp_m2, ..., mating_move]
    """
    player_moves = find_player_moves(engine, board, mate_in_n)
    if not player_moves:
        return []

    # Warm up Stockfish's transposition table by analysing the position after
    # each candidate player move.  This primes the TT so that the inner
    # find_player_moves calls inside find_critical_opponent_response (which
    # evaluate board + pm + opp_move) get fast cache hits instead of searching
    # from scratch.
    if mate_in_n > 1:
        for pm in player_moves:
            board.push(chess.Move.from_uci(pm))
            # Time-cap the warm-up so complex positions don't stall here.
            # 0.3s is enough to prime the TT to a useful depth for mate-in-2/3.
            engine.analyse(board, chess.engine.Limit(time=0.3))
            board.pop()

    solutions = []

    for pm in player_moves:
        board.push(chess.Move.from_uci(pm))

        if mate_in_n == 1:
            # pm is the mating move.
            solutions.append([pm])
        else:
            opp = find_critical_opponent_response(engine, board, mate_in_n - 1)
            if opp is not None:
                board.push(chess.Move.from_uci(opp))
                for sub in find_solutions(engine, board, mate_in_n - 1):
                    solutions.append([pm, opp] + sub)
                board.pop()

        board.pop()

    return solutions


# ── Puzzle / file processing ───────────────────────────────────────────────────

def _wrap_flat(puzzle):
    """If moves is still a flat list of strings, wrap it in an outer list."""
    m = puzzle.get("moves", [])
    if m and not isinstance(m[0], list):
        puzzle["moves"] = [m]


def _type_to_depth(puzzle_type):
    """Parse expected mate depth from the puzzle 'type' field."""
    if not puzzle_type:
        return None
    t = puzzle_type.lower()
    mapping = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
    for word, n in mapping.items():
        if word in t:
            return n
    return None


def process_puzzle(engine, puzzle, idx, total, report_entries, source_file):
    pid = puzzle.get("puzzle_id", "?")
    original_moves = puzzle.get("moves", [])
    # Detect original mate depth from flat list (before any prior processing)
    if original_moves and not isinstance(original_moves[0], list):
        original_depth = (len(original_moves) + 1) // 2  # player half-moves
    else:
        # Already processed — use first solution
        original_depth = (len(original_moves[0]) + 1) // 2 if original_moves else None

    # Use the puzzle 'type' field as the authoritative expected depth — it
    # comes from the book and is never corrupted by prior script runs.
    type_depth = _type_to_depth(puzzle.get("type", ""))

    board = chess.Board(puzzle["fen"])

    # Extract first move hint from stored solution (used to guide SF towards
    # sacrificial lines it would otherwise miss in single-PV mode).
    hint_move = None
    if original_moves:
        first_line = original_moves if not isinstance(original_moves[0], list) else original_moves[0]
        if first_line:
            try:
                hint_move = chess.Move.from_uci(first_line[0])
            except ValueError:
                pass

    mate_depth = find_true_mate_depth(engine, board, expected_depth=type_depth, hint_move=hint_move)
    if mate_depth is None:
        print(
            f"  [{idx}/{total}] #{pid}: WARNING — Stockfish found no forced mate. "
            "Keeping original.",
            flush=True,
        )
        _wrap_flat(puzzle)
        report_entries.append({
            "puzzle_id": pid,
            "source_file": source_file,
            "warning": "no_forced_mate",
            "original_depth": original_depth,
        })
        return

    faster = original_depth is not None and mate_depth < original_depth

    # Warm up Stockfish's TT with the stored solution line(s) before calling
    # find_solutions.  Crucially, hint SF with each stored first move via
    # root_moves — this forces it to evaluate the sacrificial lines that
    # single-PV would otherwise skip in favour of materially superior moves.
    if original_moves:
        lines = original_moves if isinstance(original_moves[0], list) else [original_moves]
        for line in lines:
            if not line:
                continue
            try:
                first_move = chess.Move.from_uci(line[0])
                if first_move in board.legal_moves:
                    engine.analyse(board, chess.engine.Limit(time=0.3),
                                   root_moves=[first_move])
            except (ValueError, chess.IllegalMoveError):
                pass
            b = board.copy()
            for move_uci in line:
                try:
                    engine.analyse(b, chess.engine.Limit(time=0.3))
                    b.push(chess.Move.from_uci(move_uci))
                except (ValueError, chess.IllegalMoveError):
                    break

    solutions = find_solutions(engine, board, mate_depth)

    if not solutions:
        print(
            f"  [{idx}/{total}] #{pid}: WARNING — mate in {mate_depth} confirmed "
            "but no solutions enumerated. Keeping original.",
            flush=True,
        )
        _wrap_flat(puzzle)
        report_entries.append({
            "puzzle_id": pid,
            "source_file": source_file,
            "warning": "no_solutions_enumerated",
            "mate_in": mate_depth,
            "original_depth": original_depth,
            "faster": faster,
        })
        return

    cooked = len(solutions) > 1
    branch_points = find_branch_points(solutions) if cooked else []

    flag = []
    if cooked:
        flag.append(f"{len(solutions)} solutions")
    else:
        flag.append("1 solution")
    if faster:
        flag.append(f"faster: file says {original_depth}, SF says {mate_depth}")
    print(
        f"  [{idx}/{total}] #{pid}: {', '.join(flag)} (mate in {mate_depth})",
        flush=True,
    )

    if cooked or faster:
        report_entries.append({
            "puzzle_id": pid,
            "source_file": source_file,
            "mate_in": mate_depth,
            "original_depth": original_depth,
            "faster": faster,
            "num_solutions": len(solutions),
            "branch_points": branch_points,
            "solutions": solutions,
        })

    puzzle["moves"] = solutions


def process_file(engine, filepath, limit=None, start=None, puzzle_ids=None):
    print(f"\n{'='*60}", flush=True)
    print(f"  {filepath.name}", flush=True)
    print(f"{'='*60}", flush=True)

    # Backup
    bak = filepath.with_suffix(".json.bak")
    if not bak.exists():
        shutil.copy2(filepath, bak)
        print(f"  Backed up → {bak.name}", flush=True)
    else:
        print(f"  Backup already exists ({bak.name}), skipping.", flush=True)

    data = json.loads(filepath.read_text())
    total = sum(len(ch["puzzles"]) for ch in data["chapters"])
    start_idx = start if start else 1
    effective = (min(total, limit) if limit else total) - (start_idx - 1)
    if puzzle_ids:
        print(f"  Total puzzles: {total}  (filtering to IDs: {puzzle_ids})", flush=True)
    elif start:
        end_idx = min(total, limit) if limit else total
        print(f"  Total puzzles: {total}  (processing: {start_idx}–{end_idx})", flush=True)
    else:
        print(f"  Total puzzles: {total}  (processing: {effective})", flush=True)

    report_entries = []
    idx = 0
    done = False
    for ch in data["chapters"]:
        if done:
            break
        printed_chapter = False
        for puzzle in ch["puzzles"]:
            if puzzle_ids and str(puzzle.get("puzzle_id")) not in puzzle_ids:
                continue
            idx += 1
            if not puzzle_ids and start and idx < start:
                continue
            if not printed_chapter:
                print(f"\n  Chapter: {ch['title']}", flush=True)
                printed_chapter = True
            process_puzzle(engine, puzzle, idx, total, report_entries, filepath.name)
            if not puzzle_ids and limit and idx >= limit:
                done = True
                break

    filepath.write_text(json.dumps(data, indent=2))
    print(f"\n  Written: {filepath.name}", flush=True)
    return report_entries


def write_report(all_entries, report_path, files_processed):
    lines = []
    lines.append("CHESS PUZZLE SOLUTION ANALYSIS REPORT")
    lines.append("=" * 60)
    lines.append(f"Files processed: {', '.join(files_processed)}")
    lines.append("")

    cooked = [e for e in all_entries if e.get("num_solutions", 1) > 1]
    faster = [e for e in all_entries if e.get("faster")]
    warnings = [e for e in all_entries if "warning" in e]

    lines.append(f"Cooked puzzles (multiple solutions): {len(cooked)}")
    lines.append(f"Faster mate than indicated:          {len(faster)}")
    lines.append(f"Warnings (no forced mate found):     {len(warnings)}")
    lines.append("")

    # Group by source file
    all_files = list(dict.fromkeys(e["source_file"] for e in all_entries if "source_file" in e))

    for src in all_files:
        file_cooked = [e for e in cooked if e.get("source_file") == src]
        file_faster = [e for e in faster if e.get("source_file") == src]
        file_warnings = [e for e in warnings if e.get("source_file") == src]

        if not (file_cooked or file_faster or file_warnings):
            continue

        lines.append("=" * 60)
        lines.append(f"  {src}")
        lines.append("=" * 60)

        if file_cooked:
            lines.append("")
            lines.append("  COOKED PUZZLES")
            lines.append("  " + "─" * 56)
            by_count = defaultdict(list)
            for e in file_cooked:
                by_count[e["num_solutions"]].append(e)
            for n in sorted(by_count.keys(), reverse=True):
                lines.append(f"\n  {n} solutions ({len(by_count[n])} puzzles):")
                for e in by_count[n]:
                    bp = e.get("branch_points", [])
                    move_labels = [f"player move {idx // 2 + 1}" for idx in bp]
                    branch_str = ", ".join(move_labels) if move_labels else "—"
                    multi = "  *** MULTI-BRANCH ***" if len(bp) > 1 else ""
                    lines.append(
                        f"    #{e['puzzle_id']:>6}  mate in {e['mate_in']}  "
                        f"branches at: {branch_str}{multi}"
                    )
                    for i, sol in enumerate(e["solutions"], 1):
                        lines.append(f"             solution {i}: {' '.join(sol)}")
            lines.append("")

        if file_faster:
            lines.append("  FASTER MATE THAN INDICATED IN FILE")
            lines.append("  " + "─" * 56)
            for e in file_faster:
                lines.append(
                    f"  #{e['puzzle_id']:>6}  file says mate in {e['original_depth']}, "
                    f"Stockfish says mate in {e['mate_in']}"
                )
            lines.append("")

        if file_warnings:
            lines.append("  WARNINGS")
            lines.append("  " + "─" * 56)
            for e in file_warnings:
                lines.append(f"  #{e['puzzle_id']:>6}  {e['warning']}")
            lines.append("")

    report_path.write_text("\n".join(lines))
    print(f"\nReport written: {report_path}", flush=True)


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Enumerate all valid solution lines for chess puzzles using Stockfish."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process only the first N puzzles per file (useful for testing).",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=None,
        metavar="N",
        help="Start processing from puzzle number N (1-based, by position in file).",
    )
    parser.add_argument(
        "--puzzle-ids",
        nargs="+",
        default=None,
        metavar="ID",
        help="Only process puzzles with these IDs (useful for spot-checking known cooked puzzles).",
    )
    parser.add_argument(
        "--files",
        nargs="+",
        default=DEFAULT_FILES,
        metavar="FILE",
        help="JSON filenames inside src/assets/ to process.",
    )
    args = parser.parse_args()
    puzzle_ids = set(args.puzzle_ids) if args.puzzle_ids else None

    all_entries = []
    files_processed = []
    with chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH) as engine:
        for fname in args.files:
            fpath = ASSETS_DIR / fname
            if not fpath.exists():
                print(f"Not found: {fpath}", file=sys.stderr)
                continue
            files_processed.append(fname)
            entries = process_file(engine, fpath, limit=args.limit, start=args.start, puzzle_ids=puzzle_ids)
            all_entries.extend(entries)

    write_report(all_entries, REPORT_PATH, files_processed)
    print("\nAll done.", flush=True)


if __name__ == "__main__":
    main()

// The Robot Vacuum's Best Excuse
// make.fun bounty: u-golden-heron-44-the-robot-vacuum-s-best-excuse-53412214
//
// The program picks the funniest one-line excuse a robot vacuum gives for
// missing a spot, from a set of hand-written candidates, using a small
// deterministic scorer built on the judge's brief (RULES.txt). The brief
// weighs its five criteria in this order:
//
//   1. the line is a one-line excuse a robot vacuum gives for missing a spot
//   2. it is funny -- the kind of line that makes a tired homeowner laugh
//   3. the excuse is rooted in the vacuum's own world: its sensors, its
//      bumpers, its dock, its map, its battery
//   4. the joke lands on the first read, with a clean turn at the end
//   5. it sounds like the vacuum itself talking, a small machine keeping
//      a straight face
//
// Each candidate is scored 0-10 on each criterion and weighted 5, 4, 3, 2, 1
// in the brief's order. Ties break toward the cleanest landing, then the
// funnier line, then the shorter line, then the earliest candidate, so the
// pick is deterministic.
//
// Revision notes (this pass): three new hand-written candidates (#13-#15);
// the scorer gained a freshness check that docks tired robot cliches
// ("beep boop", "does not compute", apologies to the owner) from the humour
// score; criterion 4 now also docks a line that needs a second sentence to
// land, and rewards a punch carried by the final clause rather than just
// the last 32 characters; the tie-break now prefers the cleaner landing
// (c4) before the funnier line (c2), because the judge decides pairwise
// with no ties and a first-read landing is what separates near-equal lines.
//
// Node 22, standard library only, no network. The winner is written to
// $MAKEFUN_OUTPUT_DIR/entry.txt (fallback /output/entry.txt), read back
// and verified against every gate in the brief: UTF-8 text, 1 to 140
// characters, not only white space, one line, no trailing newline.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Candidates: fifteen hand-written one-line excuses, each from the vacuum
// itself, each naming the spot it missed and the machine-world reason.
// ---------------------------------------------------------------------------

const CANDIDATES: string[] = [
  "My cliff sensor saw the rug fringe, panicked, and filed the whole corner under 'do not approach'.",
  "I mapped that spot as a hostile nation and, per my programming, I do not invade sovereign dust.",
  "I stopped cleaning that crumb on Tuesday. At this point we are roommates and I pay rent in suction.",
  "My bumper sensor filed a formal complaint about that corner and I am legally required to respect it.",
  "I left it as a control sample. Science demands a dirty corner, and I am nothing if not rigorous.",
  "I bumped the table leg, apologized to it, and we agreed the dust underneath stays as a memorial.",
  "My dustbin reported full, my battery reported tired, and the crumb reported armed. I retreated with dignity.",
  "I cleaned around it out of respect. That dust has seniority; it was here before my firmware.",
  "The spot moved. I do not chase moving targets; I am a vacuum, not a bounty hunter.",
  "My lidar blinked, my map glitched, and for one brave second that corner simply did not exist.",
  "I was two percent from my dock when that crumb looked me in the eye and said 'not today'.",
  "My wheels voted 2-1 to skip that corner. Democracy is slow, but the dust stays put.",
  "My map labelled that corner 'here be crumbs' and, per my programming, I do not sail into uncharted dust.",
  "My cliff sensor refuses to cross the rug fringe. It has seen things, and I trust its trauma.",
  "I left the dust under the sofa alone; it filed for squatter's rights, and my bumper sensors are its lawyers.",
];

// ---------------------------------------------------------------------------
// Scorer lexicons. Each list is a small set of plain words or phrases that
// mark one of the brief's criteria. Nothing here is a lookup table of
// answers: the scorer only recognises the kinds of thing the brief asks
// for, and every candidate is judged by the same lists.
// ---------------------------------------------------------------------------

// Criterion 1: the line is an excuse a robot vacuum gives for missing a spot.
const SPOT_WORDS = ["spot", "corner", "crumb", "dust", "fringe"];
const EXCUSE_MARKERS = [
  "missed",
  "left",
  "skip",
  "skipped",
  "avoid",
  "did not",
  "do not",
  "retreated",
  "cleaned around",
  "stays put",
  "did not exist",
  "not today",
  "filed",
  "respect",
  "agreed",
  "stopped",
  "refuses",
];

// Criterion 2: funny -- personification, absurd escalation, deadpan twists.
const HUMOR_DEVICES = [
  "hostile nation",
  "sovereign",
  "roommates",
  "rent",
  "memorial",
  "seniority",
  "control sample",
  "bounty hunter",
  "dignity",
  "armed",
  "democracy",
  "complaint",
  "legally",
  "panicked",
  "filed",
  "voted",
  "apologized",
  "agreed",
  "reported",
  "looked me in the eye",
  "not today",
  "do not approach",
  "rigorous",
  "respect",
  "brave",
  "here be crumbs",
  "uncharted",
  "seen things",
  "trauma",
  "squatter's rights",
  "lawyers",
];

// Freshness: tired robot cliches a tired homeowner has heard a thousand
// times. Each one found docks two humour points: the line may still be an
// excuse, but it is not a fresh joke.
const BANNED_PHRASES = [
  "i'm sorry",
  "i am sorry",
  "my bad",
  "oops",
  "beep boop",
  "does not compute",
  "system error",
  "please forgive",
  "malfunction",
];

// Criterion 3: rooted in the vacuum's own world.
const VACUUM_WORDS = [
  "sensor",
  "bumper",
  "dock",
  "map",
  "battery",
  "lidar",
  "dustbin",
  "suction",
  "firmware",
  "cliff",
  "wheel",
  "wheels",
  "brush",
  "programming",
];

// Criterion 4: the joke lands on the first read, clean turn at the end.
const PUNCH_WORDS = [
  "sovereign dust",
  "suction",
  "memorial",
  "dignity",
  "seniority",
  "bounty hunter",
  "not today",
  "do not approach",
  "rigorous",
  "stays put",
  "did not exist",
  "respect it",
  "firmware",
  "uncharted dust",
  "trauma",
  "lawyers",
  "here be crumbs",
];

// Criterion 5: the vacuum itself talking, keeping a straight face.
const DEADPAN_MARKERS = [
  "per my programming",
  "legally required",
  "with dignity",
  "out of respect",
  "reported",
  "filed",
  "apologized",
  "rigorous",
  "formally",
];

// Weights, in the brief's order: criterion 1 matters most, 5 least.
const WEIGHTS = [5, 4, 3, 2, 1];

const MAX_CHARS = 140;

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text);
}

function containsAny(text: string, words: string[]): boolean {
  return words.some((w) => containsWord(text, w));
}

function countDistinct(text: string, words: string[]): number {
  return words.filter((w) => containsWord(text, w)).length;
}

function charCount(text: string): number {
  // Count code points, not UTF-16 units, so the count matches the gate.
  return [...text].length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// The final clause of a line: everything after its last comma, semicolon
// or full stop. That is where the turn has to land; a punch buried in the
// middle of the setup does not count as a clean ending.
function finalClause(line: string): string {
  // Split on clause breaks and take the last non-empty piece: a trailing
  // full stop must not leave an empty clause behind.
  const parts = line.split(/[,;.]/).map((p) => p.trim()).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? "";
}

function sentenceCount(line: string): number {
  // A full stop followed by a space and a capital starts a new sentence.
  // The trailing full stop does not.
  return (line.match(/\.\s+[A-Z]/g) ?? []).length + 1;
}

// ---------------------------------------------------------------------------
// Scoring: one 0-10 sub-score per criterion, in the brief's order.
// ---------------------------------------------------------------------------

interface Scores {
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  c5: number;
  total: number;
}

function scoreCandidate(line: string): Scores {
  // 1. A one-line excuse from a robot vacuum for missing a spot.
  let c1 = 0;
  if (/^(I|My)\b/i.test(line)) c1 += 4; // the vacuum itself is speaking
  if (containsAny(line, SPOT_WORDS)) c1 += 3; // it names what it missed
  if (containsAny(line, EXCUSE_MARKERS)) c1 += 3; // it gives its excuse

  // 2. Funny: two points per distinct humour device, minus two per tired
  //    cliche the freshness check catches. A line that leans on "beep
  //    boop" or an apology to the owner is not a fresh joke.
  const c2 = clamp(
    countDistinct(line, HUMOR_DEVICES) * 2 -
      countDistinct(line, BANNED_PHRASES) * 2,
    0,
    10,
  );

  // 3. Rooted in the vacuum's own world: three points per distinct
  //    piece of vacuum vocabulary.
  const c3 = clamp(countDistinct(line, VACUUM_WORDS) * 3, 0, 10);

  // 4. Lands on the first read: start at 10, lose a point per ten
  //    characters past 90 (a long line is a slow landing), per comma past
  //    the second (a tangled setup), and per extra sentence (a joke that
  //    needs a second sentence to land did not land on the first read);
  //    gain one back when the final clause itself carries the punch.
  let c4 = 10;
  c4 -= Math.floor(Math.max(0, charCount(line) - 90) / 10);
  const commas = (line.match(/,/g) ?? []).length;
  c4 -= Math.max(0, commas - 2);
  c4 -= Math.max(0, sentenceCount(line) - 1);
  if (containsAny(finalClause(line), PUNCH_WORDS)) c4 += 1;
  c4 = clamp(c4, 0, 10);

  // 5. The vacuum's own voice: opens as "I" / "My", keeps a straight
  //    face with deadpan formal language, never addresses the owner.
  let c5 = 0;
  if (/^(I|My)\b/i.test(line)) c5 += 5;
  if (containsAny(line, DEADPAN_MARKERS)) c5 += 3;
  if (!containsWord(line, "you") && !containsWord(line, "your")) c5 += 2;
  c5 = clamp(c5, 0, 10);

  const parts = [c1, c2, c3, c4, c5];
  const total = parts.reduce((sum, v, i) => sum + v * WEIGHTS[i], 0);
  return { c1, c2, c3, c4, c5, total };
}

function pickWinner(): { line: string; scores: Scores; index: number } {
  let best: { line: string; scores: Scores; index: number } | null = null;
  for (let i = 0; i < CANDIDATES.length; i++) {
    const line = CANDIDATES[i];
    const scores = scoreCandidate(line);
    if (
      best === null ||
      scores.total > best.scores.total ||
      (scores.total === best.scores.total &&
        (scores.c4 > best.scores.c4 ||
          (scores.c4 === best.scores.c4 &&
            (scores.c2 > best.scores.c2 ||
              (scores.c2 === best.scores.c2 &&
                (charCount(line) < charCount(best.line) ||
                  (charCount(line) === charCount(best.line) && i < best.index)))))))
    ) {
      best = { line, scores, index: i };
    }
  }
  // The loop always fills best: CANDIDATES is non-empty.
  return best as { line: string; scores: Scores; index: number };
}

// ---------------------------------------------------------------------------
// Gate verification, exactly as the brief states it: UTF-8 text of 1 to
// 140 characters, not only white space, one line. The file is read back
// from disk and checked byte-for-byte against the winner.
// ---------------------------------------------------------------------------

function verifyEntry(filePath: string, expected: string): void {
  const bytes = readFileSync(filePath);
  // Strict UTF-8 decode: throws on any invalid sequence.
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text !== expected) {
    throw new Error("entry.txt on disk does not match the winner byte-for-byte");
  }
  const n = charCount(text);
  if (n < 1 || n > MAX_CHARS) {
    throw new Error(`gate failed: entry is ${n} characters, must be 1-${MAX_CHARS}`);
  }
  if (text.trim().length === 0) {
    throw new Error("gate failed: entry is only white space");
  }
  if (text.includes("\n") || text.includes("\r")) {
    throw new Error("gate failed: entry is not one line");
  }
  console.log(`gate OK: ${n} characters, one line, valid UTF-8`);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main(): void {
  for (const [i, line] of CANDIDATES.entries()) {
    const s = scoreCandidate(line);
    console.log(
      `#${i + 1} [${s.c1},${s.c2},${s.c3},${s.c4},${s.c5}] total=${s.total} (${charCount(line)} chars) ${line}`,
    );
  }

  const winner = pickWinner();
  console.log(`\nwinner #${winner.index + 1} (total ${winner.scores.total}):`);
  console.log(winner.line);

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.txt");
  // No trailing newline: the file must be exactly the one line, so its
  // character count is the line's character count.
  writeFileSync(outPath, winner.line, "utf8");
  verifyEntry(outPath, winner.line);
  console.log(`wrote ${outPath}`);
}

main();

/**
 * A meal's method and notes, read as the recipe screen draws them — PRD § P12,
 * Brand Guide § Recipe (FUEL-143).
 *
 * `meals.method` is prose and stays prose: the schema says so, and nothing here
 * asks the seed to be anything else. What this module does is find the steps in
 * it, using the shape the seed already has.
 *
 * ## Two shapes, and the second is one recipe
 *
 * Sixteen of the seventeen seeded methods are one step per line. Five of those
 * continue past a blank line into a variant ("**Baked potato instead of rice:**
 * …") or a keeping note ("Jars keep 4 days"), and that is prose under the
 * steps, never a step. So: **a line is a step, and a blank line ends them.**
 *
 * The steak is written differently and is honoured rather than rewritten. It
 * opens with a heat guide — a `###` heading, a sentence and a four-row table —
 * then numbers its own steps under `### Steps`. Under the first rule its first
 * "step" would be the heading. So where a method numbers its lines, **the
 * numbered lines are the steps** and what precedes them is read before them.
 * Rewriting that recipe into the simple shape would lose the table and mean
 * editing the owner's production row to suit a parser.
 *
 * ## A ceiling, not a markdown renderer
 *
 * Bold, italic, `###` as a label, a numbered line as a step, and a pipe table.
 * Anything else comes back as the text it is. The output is data the page turns
 * into React elements, so nothing the owner typed ever reaches the DOM as
 * markup — which is the reason there is no markdown dependency here at all.
 */

/** A run of text with at most the two emphases the screen honours. */
export type Inline = { text: string; strong?: true; em?: true };

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

export type Method = {
  /** Read before step 1 — the steak's heat guide. Empty for every other meal. */
  before: Block[];
  steps: Inline[][];
  /** Variant and keeping prose, under the steps. */
  after: Block[];
};

const NUMBERED = /^\d+\.\s+/;
const HEADING = /^###\s+/;
const TABLE_ROW = /^\|.*\|$/;
const TABLE_RULE = /^\|(\s*:?-+:?\s*\|)+$/;

/**
 * `**bold**` and `*italic*`, left to right, not nested.
 *
 * An unmatched asterisk is text: "5% fat *" is a measure, not an unclosed
 * emphasis, and a parser that swallowed it would print less than was written.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    if (at > last) out.push({ text: text.slice(last, at) });

    if (match[1] !== undefined) out.push({ text: match[1], strong: true });
    else out.push({ text: match[2] ?? "", em: true });

    last = at + match[0].length;
  }

  if (last < text.length) out.push({ text: text.slice(last) });

  return out;
}

const cells = (row: string): Inline[][] =>
  row
    .slice(1, -1)
    .split("|")
    .map((cell) => parseInline(cell.trim()));

/** Lines into chunks, split on blank lines. */
function chunks(lines: readonly string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) out.push(current);
      current = [];
    } else {
      current.push(line.trim());
    }
  }

  if (current.length > 0) out.push(current);

  return out;
}

function blocksOf(lines: readonly string[]): Block[] {
  return chunks(lines).flatMap((chunk): Block[] => {
    const [first, second] = chunk;
    const rest = chunk.slice(1);

    // `chunks` never yields an empty chunk; this is for the compiler.
    if (first === undefined) return [];

    if (HEADING.test(first)) {
      const heading: Block = { kind: "heading", text: first.replace(HEADING, "") };
      return rest.length > 0 ? [heading, ...blocksOf(rest)] : [heading];
    }

    // A table needs its rule line: without one, a line that happens to start
    // and end with a pipe is prose, and is printed as written.
    if (second !== undefined && chunk.every((line) => TABLE_ROW.test(line)) && TABLE_RULE.test(second)) {
      return [{ kind: "table", head: cells(first), rows: chunk.slice(2).map(cells) }];
    }

    return [{ kind: "paragraph", inline: parseInline(chunk.join(" ")) }];
  });
}

/** Free prose — a meal's notes. Paragraphs split on blank lines. */
export function parseProse(markdown: string | null | undefined): Block[] {
  if (!markdown) return [];

  return blocksOf(markdown.split(/\r?\n/));
}

/**
 * The steps in a method, and the prose either side of them.
 *
 * Null when there is no method to read — including one that is only whitespace,
 * which the screen draws as "No method recorded" rather than as a Method
 * heading over nothing.
 */
export function parseMethod(markdown: string | null | undefined): Method | null {
  if (!markdown || markdown.trim() === "") return null;

  const lines = markdown.split(/\r?\n/);
  const first = lines.findIndex((line) => NUMBERED.test(line.trim()));

  if (first >= 0) return numbered(lines, first);

  // The seed's own shape: leading lines up to the first blank one.
  const start = lines.findIndex((line) => line.trim() !== "");
  const blank = lines.findIndex((line, i) => i > start && line.trim() === "");
  const end = blank < 0 ? lines.length : blank;

  return {
    before: [],
    steps: lines.slice(start, end).map((line) => parseInline(line.trim())),
    after: blocksOf(lines.slice(end)),
  };
}

function numbered(lines: readonly string[], first: number): Method {
  const steps: string[] = [];
  let i = first;

  // A step runs until a blank line; an unnumbered line straight after one is
  // its continuation, as markdown reads it, not a step of its own.
  for (; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (NUMBERED.test(line)) steps.push(line.replace(NUMBERED, ""));
    else if (line === "") {
      const next = lines.slice(i + 1).find((candidate) => candidate.trim() !== "");
      if (next === undefined || !NUMBERED.test(next.trim())) break;
    } else steps[steps.length - 1] += ` ${line}`;
  }

  const before = blocksOf(lines.slice(0, first));

  // "### Steps" names the list that follows it, and the screen's own Method
  // label already does that. Kept, it would read "Method … Steps … 1."
  const tail = before.at(-1);
  if (tail?.kind === "heading" && /^steps$/i.test(tail.text)) before.pop();

  return { before, steps: steps.map(parseInline), after: blocksOf(lines.slice(i)) };
}

/** The text of a run of inlines, emphasis dropped — for names and tests. */
export const plain = (inline: readonly Inline[]): string => inline.map((run) => run.text).join("");

/**
 * A meal id, as the route receives it.
 *
 * Checked before the query rather than left to Postgres: a malformed uuid is a
 * cast error there, which is a 500, and PRD § P12 asks for a 404 — an address
 * that names no meal is the same answer whether it is malformed or merely
 * someone else's.
 */
export const isMealId = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

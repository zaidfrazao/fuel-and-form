/**
 * A table of text, as CSV — the serialising half of FUEL-38's weekly export.
 *
 * Pure, importing nothing, and knowing nothing about weeks, meals or training.
 * It is handed rows of strings and returns the file's text; `lib/export-week.ts`
 * decides what those rows SAY and `app/api/export/week/route.ts` does the
 * responding. The same three-way split `lib/export.ts` keeps for the JSON, and
 * it is worth the extra module for one reason: escaping is the part of a CSV
 * that is wrong or right independently of the data, so it should be assertable
 * independently of the data.
 *
 * ## RFC 4180, and the two places this is stricter than it
 *
 * Fields are quoted only when they have to be — a field containing a comma, a
 * double quote, or a line break — with embedded quotes doubled. Records end
 * CRLF, which is what the RFC specifies and what a spreadsheet importing on
 * Windows expects; a lone LF is the more common thing to emit and the more
 * common thing to have mangled at the far end.
 *
 * Beyond the RFC, a field with leading or trailing whitespace is quoted too.
 * The RFC says spaces are part of a field and must not be ignored, but readers
 * disagree in practice — several trim unquoted fields — and a note that ends in
 * a space is one whose trailing space nobody will ever notice going missing.
 * Quoting removes the disagreement.
 *
 * ## The formula guard
 *
 * A field beginning `=`, `+`, `-`, `@`, tab or carriage return is prefixed with
 * a single quote, so the spreadsheet stores it as text rather than evaluating
 * it. This is the only file in the app whose contents are opened BY ANOTHER
 * PROGRAM, on someone else's machine: PRD § Target Users has the nutrition
 * assistant consuming the export in a spreadsheet, and the meal and session
 * notes in it are free text. `=cmd|...` in a note is a well-known way to turn a
 * data file into an instruction, and the person it would run against is not the
 * person who typed it.
 *
 * The cost is stated plainly because it is real: a note that legitimately opens
 * with a minus sign — "-2 today" — arrives in the sheet as "'-2 today", visible
 * in the formula bar. That is the trade taken deliberately, and it falls only on
 * notes: every generated column here is a date, an enum, a name or a
 * non-negative number, none of which can begin with a guarded character.
 *
 * ## No byte-order mark
 *
 * Not written, deliberately. The response declares `charset=utf-8` and UTF-8 is
 * what a CSV is assumed to be; a BOM is a workaround for a reader that ignores
 * the header, and it is itself a defect for every reader that does not — it
 * arrives as three stray characters glued to the first cell. Recorded here so a
 * future "Excel shows a strange character" report is diagnosed rather than
 * patched by adding one.
 */

/** RFC 4180's record separator. */
const ROW_END = "\r\n";

/**
 * When a field cannot be written bare: the RFC's three characters, plus the
 * surrounding-whitespace case argued above.
 */
const NEEDS_QUOTES = /["\r\n,]|^\s|\s$/;

/**
 * What a spreadsheet may treat as the start of a formula rather than of text.
 *
 * Tab and carriage return are on the list with the four obvious characters
 * because a leading one of either is stripped by some readers before the next
 * character is examined — which puts an `=` back at the front of the field.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One field, guarded and then quoted — in that order, and the order matters.
 *
 * The guard changes what the field STARTS with, so quoting has to be decided
 * against the guarded text: a value of `=1, 2` needs its quotes because of the
 * comma, and the quotes have to contain the prefix rather than sit inside it.
 */
function field(value: string): string {
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;

  if (!NEEDS_QUOTES.test(guarded)) return guarded;

  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * Rows of fields, as the text of a CSV file.
 *
 * Every row is terminated rather than joined, so the file ends with a newline
 * and an empty table is an empty string — no special case, and nothing to get
 * backwards when a section happens to have no rows.
 *
 * A row may be empty. `[]` writes a blank line, which is how `export-week.ts`
 * separates its three sections: the file is deliberately ragged — three tables
 * with three different column counts, which PRD § P6 asks for as "one section
 * or file each" — and a blank line is the separator every spreadsheet's import
 * already understands.
 */
export function csvTable(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(field).join(",") + ROW_END).join("");
}

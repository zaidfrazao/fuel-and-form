#!/usr/bin/env bash
#
# check-no-metrics.sh — repository hygiene for a public repo (FUEL-16)
#
# PRD § P7: "No personal metrics in git history, ever", and its acceptance
# criterion "`git log -p` contains no real weight, target, or body-metric
# values". Testing Strategy § 1.5 is the specification this implements.
#
#
# WHY THIS IS AN ALLOWLIST AND NOT A DENYLIST
#
# The obvious design is a list of the owner's real figures to grep for. That
# design is self-defeating: this script is committed to a public repository, so
# the list would publish the very numbers it exists to protect. The check would
# become the leak.
#
# So it works the other way round. It matches the *shape* of a body metric —
# a weight in kg, a height in cm, a daily kcal or macro target — and passes only
# values that are known to belong to Sam Rivera, the fictional demo persona.
# Sam's figures are safe to name here precisely because Sam is invented; they are
# already published in docs/PRD.md and labelled as fictional.
#
# Anything else metric-shaped fails. That has two advantages over a denylist:
# it catches figures nobody thought to enumerate (a new weigh-in, a changed
# target), and this file never needs to contain a real number.
#
# The corollary is a rule for anyone editing this script: never add a real
# figure to it, not even in a comment, not even to explain a false positive.
# During development this check fired on its own source for exactly that reason.
#
#
# NO DIRECTORY IS EXEMPT
#
# There is no `docs/` exemption. docs/PRD.md and docs/BRAND_GUIDE.md are where
# the historical leak actually happened; exempting them would convert a real
# exposure into a green check. The two exclusions that do exist are narrow and
# justified at their definitions below (a generated lockfile, and unit-test
# fixtures for the numeric-field check only).
#
#
# EXPECTED RESULT ON THIS REPOSITORY TODAY
#
# The default (full) run FAILS, and that is correct rather than a bug. FUEL-14
# replaced the owner's figures in the working tree with Sam's, but the old
# values remain reachable in already-published git history. Rewriting those
# commits is FUEL-43's job. Until it lands, `--tree-only` is clean and the full
# scan is red — which is the honest report, and the reason this script scans
# `git log -p` at all: a clean checkout is not evidence of a clean repository.
#
# Usage:
#   ./scripts/check-no-metrics.sh               # full scan: tree + history + structure
#   ./scripts/check-no-metrics.sh --tree-only   # working tree + structure only (pre-commit)
#   ./scripts/check-no-metrics.sh --show-values # print matches unredacted (local only)
#
# Exit: 0 clean · 1 findings · 2 usage or environment error
#
set -euo pipefail

readonly SELF="${0##*/}"

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

TREE_ONLY=0
SHOW_VALUES=0

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; $d'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tree-only) TREE_ONLY=1 ;;
    # Findings are redacted by default because CI logs on a public repository
    # are themselves public: a check that prints the leaked value into a build
    # log has moved the leak rather than reported it.
    --show-values) SHOW_VALUES=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '%s: unknown option %s (try --help)\n' "$SELF" "$1" >&2
      exit 2
      ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  printf '%s: not inside a git repository\n' "$SELF" >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

FINDINGS=0
FAILED_CHECKS=""

fail_check() {
  FINDINGS=1
  case " $FAILED_CHECKS " in
    *" $1 "*) ;;
    *) FAILED_CHECKS="$FAILED_CHECKS $1" ;;
  esac
}

hr() { printf '%s\n' "------------------------------------------------------------"; }

# Mask every digit run down to its first character, leaving everything else
# intact. The unit and any field name survive, so "7****kg" and "1**g protein"
# are still tellable apart in a log that must not carry either figure — and a
# fix is still confirmable, because the finding disappears.
redact_match() {
  if [ "$SHOW_VALUES" -eq 1 ]; then
    printf '%s' "$1"
    return
  fi
  printf '%s' "$1" | awk '{
    out = ""; inrun = 0
    for (i = 1; i <= length($0); i++) {
      c = substr($0, i, 1)
      if (c ~ /[0-9]/) {
        if (inrun) { out = out "*" } else { out = out c; inrun = 1 }
      } else if (inrun && (c == "," || c == ".")) {
        out = out "*"
      } else {
        inrun = 0; out = out c
      }
    }
    printf "%s", out
  }'
}

# The numeric token inside a match. Every pattern below wraps exactly one
# number, so the last digit-run is the value: "84.2kg" -> 84.2,
# "1,780 kcal" -> 1780, a profile field assignment -> its literal.
extract_token() {
  printf '%s' "$1" |
    grep -oE '[0-9][0-9,]*(\.[0-9]+)?' |
    tail -1 |
    tr -d ','
}

is_allowed() {
  local token="$1" allowed="$2" candidate
  for candidate in $allowed; do
    [ "$token" = "$candidate" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# The patterns
#
# Held as parallel arrays indexed in lockstep, NOT as delimited strings. Every
# regex here contains `|` for alternation, so any single-character field
# delimiter collides with the data: the first version of this script packed the
# four fields into one `|`-separated string, `IFS='|' read` truncated each regex
# at its first alternation, grep rejected the fragment as invalid, the error went
# to /dev/null, and zero matches was reported as a clean history. A check that
# fails open is worse than no check, hence both the array-of-arrays below and the
# validate_patterns startup guard.
#
# Bounds are domain knowledge, and they are what makes this quiet enough to
# leave switched on. A body weight is forty to two hundred kilograms, so the
# plate weights and the rate-of-loss figures in docs/PRD.md never match. A
# standing height is between one hundred forty and two hundred centimetres, so
# the ingredient sizes in src/lib/seed/meals.ts never match. A daily macro
# target runs from one hundred to three hundred grams, so per-recipe macros
# never match. Widening any bound means re-checking it against the tree.
#
# (The bounds are spelled out in words rather than digits on purpose: written as
# numerals next to their units, this comment matched its own patterns.)
#
# Two patterns cannot be separated on bounds alone and carry a line filter as
# well, requiring a target-ish word nearby:
#
#   fat  — a daily fat target and one meal's fat content share a numeric range.
#   kcal — four-digit kilocalorie figures are ordinary. They show up as
#          typography specimens, as the seed library's aggregate output, and in
#          test-fixture prose. This is the weakest discriminator in the set, so
#          it is also scoped away from test files below. That is acceptable
#          because it is not load-bearing: the owner's kcal figure has never
#          appeared without their protein, carb, weight and height figures
#          beside it, and all four of those are caught on bounds alone, in every
#          file, with no filter.
#
# ALLOW_* lists hold Sam Rivera's figures, per-unit rather than pooled: fifty is
# a legitimate fat target but must not therefore pass as a body weight.
# ---------------------------------------------------------------------------

readonly ALLOW_KG="84.2 76"
readonly ALLOW_CM="172"
readonly ALLOW_KCAL="1780"
readonly ALLOW_PROTEIN="148"
readonly ALLOW_CARB="185"
readonly ALLOW_FAT="50"

readonly PATTERN_NAMES=(
  "body-weight-kg"
  "height-cm"
  "target-kcal"
  "target-protein-g"
  "target-carb-g"
  "target-fat-g"
)

readonly PATTERN_REGEX=(
  '(^|[^0-9A-Za-z.])([4-9][0-9]|1[0-9]{2})(\.[0-9]{1,2})?[ ]?kg'
  '(^|[^0-9A-Za-z.])1[4-9][0-9][ ]?cm'
  '(^|[^0-9A-Za-z.])[1-4],?[0-9]{3}[ ]?kcal'
  '(^|[^0-9A-Za-z.])[12][0-9]{2}[ ]?g[ ]?protein'
  '(^|[^0-9A-Za-z.])[12][0-9]{2}[ ]?g[ ]?carb'
  '(^|[^0-9A-Za-z.])[2-9][0-9][ ]?g[ ]?fat'
)

readonly PATTERN_ALLOW=(
  "$ALLOW_KG"
  "$ALLOW_CM"
  "$ALLOW_KCAL"
  "$ALLOW_PROTEIN"
  "$ALLOW_CARB"
  "$ALLOW_FAT"
)

# Empty means "report every match"; otherwise the line must also match this.
readonly PATTERN_LINEFILTER=(
  ""
  ""
  "target|goal|cutting|daily|deficit"
  ""
  ""
  "target|goal|cutting|daily|deficit"
)

# "all" scans every file; "notest" skips unit-test fixtures. Only the kcal
# pattern is narrowed, for the reason given above.
readonly PATTERN_SCOPE=(
  "all"
  "all"
  "notest"
  "all"
  "all"
  "all"
)

# Prose patterns only see prose. A figure written as a bare field assignment —
# one of the profile column names, a colon, a number — is invisible to them, so
# the profile columns get a field-form pattern too. Scoped to the schema's own
# profile field names: those hold one person's configuration, so any literal
# assigned to them is a body metric by definition. Deliberately excludes the
# weigh-in series field (weight_logs.weightKg) — a 12-week series is an
# open-ended set of values that no allowlist can track, and it is covered
# instead by the structural check that keeps scripts/seed-local.ts unstaged.
readonly PROFILE_FIELD_REGEX='(heightCm|startWeightKg|targetWeightKg|targetKcal|targetProteinG|targetFatG|targetCarbG)"?[ ]*[:=][ ]*[0-9]+(\.[0-9]+)?'
readonly PROFILE_FIELD_ALLOW="$ALLOW_CM $ALLOW_KG $ALLOW_KCAL $ALLOW_PROTEIN $ALLOW_CARB $ALLOW_FAT"

# Reject an unusable regex loudly at startup. grep exits 2 on a bad pattern and
# 1 on "no match"; only the former is a defect, and it must never be mistaken
# for a clean result.
validate_patterns() {
  local i rc regex
  for i in "${!PATTERN_REGEX[@]}"; do
    regex="${PATTERN_REGEX[$i]}"
    rc=0
    printf '' | grep -qE "$regex" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -ge 2 ]; then
      printf '%s: pattern %s is not a valid ERE\n' "$SELF" "${PATTERN_NAMES[$i]}" >&2
      exit 2
    fi
  done
  rc=0
  printf '' | grep -qE "$PROFILE_FIELD_REGEX" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ge 2 ]; then
    printf '%s: profile-field pattern is not a valid ERE\n' "$SELF" >&2
    exit 2
  fi
}

# Every match on one line that the allowlist does not excuse, one per output
# line, normalised so it starts at its first digit — the leading character the
# patterns capture as a word boundary is not part of the value.
#
# Emits the matched text ("<n>kg", "<n>g protein") rather than the bare number.
# The number alone is useless downstream: `git log -S` on a two-digit figure
# pickaxes every base64 blob in the repository, and a comma-stripped one finds
# nothing at all. The text with its unit attached is specific enough to count
# and to search.
#
# Shared by the tree and history scans so the two cannot drift apart in what
# they consider a finding.
offending_matches_in_line() {
  local line="$1" regex="$2" allow="$3" linefilter="$4" match token

  if [ -n "$linefilter" ]; then
    printf '%s' "$line" | grep -qiE "$linefilter" || return 0
  fi

  while IFS= read -r match; do
    [ -z "$match" ] && continue
    # Drop the leading boundary punctuation the pattern captured, keeping any
    # field name (which starts with a letter, not a digit).
    match="${match#"${match%%[0-9A-Za-z]*}"}"
    [ -z "$match" ] && continue
    token="$(extract_token "$match")"
    [ -z "$token" ] && continue
    is_allowed "$token" "$allow" && continue
    printf '%s\n' "$match"
  done < <(printf '%s\n' "$line" | grep -oE "$regex" 2>/dev/null || true)
}

# ---------------------------------------------------------------------------
# Check 1 — the working tree
#
# `git ls-files -co --exclude-standard` is tracked files plus untracked ones,
# minus anything gitignored. Ignored files are skipped on purpose:
# scripts/seed-local.ts exists to hold the owner's real profile and weigh-ins,
# and scanning it would mean this check could never pass. That is not an
# exemption for personal data, it is a division of labour — check 4 asserts the
# file stays out of the index, which is the property that actually matters.
# ---------------------------------------------------------------------------

# package-lock.json only: npm integrity hashes are base64, so they contain
# arbitrary digit runs that can end in a unit-looking suffix. It is generated,
# and no metric can meaningfully leak through it.
tree_files() {
  git ls-files -co --exclude-standard | grep -v '^package-lock\.json$' || true
}

# Unit-test fixtures are excluded from the field-form check only. Synthetic
# round numbers are exactly what belongs in a fixture, and allowlisting every
# one of them would make the pre-commit hook fire on each new test. Prose
# patterns still apply to test files in full, so a real figure written with its
# unit in a test is still caught.
tree_files_no_tests() {
  tree_files | grep -vE '(^|/)tests/|\.test\.(ts|tsx|js|jsx|mts)$' || true
}

scan_tree() {
  printf '\n[1/4] working tree — tracked and untracked files, no directory exempt\n'

  local files_all files_notest
  files_all="$(tree_files)"
  files_notest="$(tree_files_no_tests)"

  if [ -z "$files_all" ]; then
    printf '  no files to scan\n'
    return
  fi

  local hits=0 i name regex allow linefilter scope files raw location content match

  # One grep per pattern over the whole file list, then per-line evaluation.
  for i in "${!PATTERN_REGEX[@]}"; do
    name="${PATTERN_NAMES[$i]}"
    regex="${PATTERN_REGEX[$i]}"
    allow="${PATTERN_ALLOW[$i]}"
    linefilter="${PATTERN_LINEFILTER[$i]}"
    scope="${PATTERN_SCOPE[$i]}"

    if [ "$scope" = "notest" ]; then
      files="$files_notest"
    else
      files="$files_all"
    fi
    [ -z "$files" ] && continue

    while IFS= read -r raw; do
      [ -z "$raw" ] && continue
      location="$(printf '%s' "$raw" | cut -d: -f1,2)"
      content="$(printf '%s' "$raw" | cut -d: -f3-)"
      while IFS= read -r match; do
        [ -z "$match" ] && continue
        printf '  %-18s %s  %s\n' "$name" "$location" "$(redact_match "$match")"
        hits=$((hits + 1))
      done < <(offending_matches_in_line "$content" "$regex" "$allow" "$linefilter")
    done < <(printf '%s\n' "$files" | tr '\n' '\0' |
      xargs -0 --no-run-if-empty grep -IHnE "$regex" 2>/dev/null || true)
  done

  if [ -n "$files_notest" ]; then
    while IFS= read -r raw; do
      [ -z "$raw" ] && continue
      location="$(printf '%s' "$raw" | cut -d: -f1,2)"
      content="$(printf '%s' "$raw" | cut -d: -f3-)"
      while IFS= read -r match; do
        [ -z "$match" ] && continue
        printf '  %-18s %s  %s\n' "profile-field" "$location" "$(redact_match "$match")"
        hits=$((hits + 1))
      done < <(offending_matches_in_line "$content" "$PROFILE_FIELD_REGEX" "$PROFILE_FIELD_ALLOW" "")
    done < <(printf '%s\n' "$files_notest" | tr '\n' '\0' |
      xargs -0 --no-run-if-empty grep -IHnE "$PROFILE_FIELD_REGEX" 2>/dev/null || true)
  fi

  if [ "$hits" -eq 0 ]; then
    printf '  clean — no unrecognised body-metric values\n'
  else
    printf '\n  %d finding(s). Each is a value that looks like a body metric and is\n' "$hits"
    printf '  not one of the demo persona'"'"'s. Either it is real and must come out,\n'
    printf '  or it is fictional and belongs in an ALLOW_* list in this script.\n'
    fail_check "working-tree"
  fi
}

# ---------------------------------------------------------------------------
# Check 2 — git history
#
# The point of the whole exercise: `git log -p --all` is what a stranger can
# read after cloning, and it does not change when a file is edited.
# ---------------------------------------------------------------------------

scan_history() {
  printf '\n[2/4] git history — every patch on every ref\n'

  # A shallow clone has no history to scan, so scanning one and reporting
  # "clean" would be a false pass. Actions' default checkout is depth 1.
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    printf '  ERROR: shallow clone — history cannot be scanned.\n'
    printf '  This is a failure, not a pass: a depth-1 checkout would report a\n'
    printf '  dirty history as clean. In GitHub Actions set:\n'
    printf '      - uses: actions/checkout@v5\n'
    printf '        with: { fetch-depth: 0 }\n'
    fail_check "history(shallow)"
    return
  fi

  # One dump, reused by every pattern: six `git log -p --all` walks would be six
  # times the work. It holds real metrics, so it is mode 600 and trapped.
  local dump
  dump="$(mktemp "${TMPDIR:-/tmp}/check-no-metrics.XXXXXX")"
  chmod 600 "$dump"
  # shellcheck disable=SC2064
  trap "rm -f '$dump'" EXIT INT TERM
  git log -p --all --no-color >"$dump" 2>/dev/null || true

  if [ ! -s "$dump" ]; then
    printf '  ERROR: "git log -p --all" produced no output.\n'
    printf '  Refusing to report a clean history that was never read.\n'
    fail_check "history(empty)"
    return
  fi

  local i name regex allow linefilter line match count hits=0
  local -a offenders=()

  for i in "${!PATTERN_REGEX[@]}"; do
    name="${PATTERN_NAMES[$i]}"
    regex="${PATTERN_REGEX[$i]}"
    allow="${PATTERN_ALLOW[$i]}"
    linefilter="${PATTERN_LINEFILTER[$i]}"

    # Tally identical matches rather than counting substrings in the dump: an
    # occurrence count is only meaningful for the value *as matched*, unit and
    # all.
    while read -r count match; do
      [ -z "$match" ] && continue
      printf '  %-18s %-22s %s occurrence(s)\n' \
        "$name" "$(redact_match "$match")" "$count"
      offenders+=("$match")
      hits=$((hits + 1))
    done < <(
      while IFS= read -r line; do
        offending_matches_in_line "$line" "$regex" "$allow" "$linefilter"
      done < <(grep -hE "$regex" "$dump" 2>/dev/null || true) |
        sort | uniq -c | sort -rn
    )
  done

  if [ "$hits" -eq 0 ]; then
    printf '  clean — no unrecognised body-metric values in any patch\n'
    return
  fi

  # Commit subjects and SHAs are already public, so naming them costs nothing
  # and it is what a history rewrite actually needs as input. Pickaxing the
  # matched text rather than the bare number is what keeps this list to the
  # commits that actually carry a metric.
  printf '\n  Commits to rewrite (FUEL-43):\n'
  {
    for match in "${offenders[@]}"; do
      git log --all --format='%h %s' -S"$match" 2>/dev/null || true
    done
  } | sort -u | sed 's/^/    /'

  printf '\n  %d distinct value(s) reachable in published history.\n' "$hits"
  printf '  Editing a file does not remove it from the commits behind that file;\n'
  printf '  this needs a history rewrite and a force-push. That is FUEL-43.\n'
  fail_check "git-history"
}

# ---------------------------------------------------------------------------
# Check 3 — no .env file is tracked
#
# .env.example is the deliberate exception, kept in the index by the
# `!.env.example` negation in .gitignore: it is the template the setup docs
# point at and it carries no values. Anything else matching .env* is a secret.
# ---------------------------------------------------------------------------

check_env_files() {
  printf '\n[3/4] .env files — none tracked except the template\n'

  local tracked
  tracked="$(git ls-files | grep -E '(^|/)\.env' | grep -vE '(^|/)\.env\.example$' || true)"

  if [ -z "$tracked" ]; then
    printf '  clean — only .env.example is tracked\n'
    return
  fi

  printf '%s\n' "$tracked" | sed 's/^/  tracked: /'
  printf '\n  A tracked .env is a committed secret. Remove it from the index\n'
  printf '  (git rm --cached <file>) and rotate whatever it contained — it is in\n'
  printf '  history from the commit that added it, not just the working tree.\n'
  fail_check "env-tracked"
}

# ---------------------------------------------------------------------------
# Check 4 — the local seed script stays out of the index
#
# The counterpart to skipping ignored files in check 1. scripts/seed-local.ts
# is where the owner's real profile and weigh-in history live, so the guarantee
# that matters is not "it contains nothing" but "it is never committed".
# ---------------------------------------------------------------------------

readonly LOCAL_SEED="scripts/seed-local.ts"

check_local_seed_ignored() {
  printf '\n[4/4] %s — ignored and never tracked\n' "$LOCAL_SEED"

  local ok=1

  if git ls-files --error-unmatch "$LOCAL_SEED" >/dev/null 2>&1; then
    printf '  TRACKED: %s is in the index.\n' "$LOCAL_SEED"
    printf '  This file holds real body metrics. git rm --cached it before committing.\n'
    ok=0
  fi

  if ! git check-ignore -q "$LOCAL_SEED" 2>/dev/null; then
    printf '  NOT IGNORED: no .gitignore rule covers %s.\n' "$LOCAL_SEED"
    printf '  Without the rule, the next "git add -A" commits real metrics.\n'
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    printf '  clean — ignored, not tracked\n'
  else
    fail_check "local-seed"
  fi
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

validate_patterns

printf 'check-no-metrics'
[ "$TREE_ONLY" -eq 1 ] && printf ' (--tree-only)'
printf '\n'
hr

scan_tree

if [ "$TREE_ONLY" -eq 1 ]; then
  printf '\n[2/4] git history — SKIPPED (--tree-only)\n'
  printf '  A commit cannot fix history, so the hook does not gate on it.\n'
  printf '  Run without --tree-only before publishing.\n'
else
  scan_history
fi

check_env_files
check_local_seed_ignored

hr
if [ "$FINDINGS" -eq 0 ]; then
  if [ "$TREE_ONLY" -eq 1 ]; then
    printf 'PASS — working tree and structure clean (history not scanned).\n'
  else
    printf 'PASS — no real body metrics in the tree or history.\n'
  fi
  exit 0
fi

printf 'FAIL —%s\n' "$FAILED_CHECKS"
printf '\nDo not silence this by exempting a path. If a finding is a fictional\n'
printf 'figure, add it to the matching ALLOW_* list in this script. If it is\n'
printf 'real, remove it.\n'
exit 1

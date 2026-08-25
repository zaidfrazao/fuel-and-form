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
# Checks 1, 2, 4 and 5 pass. Check 3 does not, and that is the honest report
# rather than a bug.
#
# The history this script was written to condemn has been rewritten. FUEL-14
# replaced the owner's figures in the working tree with Sam's, and on 2026-08-19
# `git filter-repo` plus a force-push removed the originals from every branch.
# A fresh clone is clean, and checks 1 and 2 say so.
#
# What a force-push does not touch is the host's own refs. GitHub creates
# `refs/pull/N/head` when a pull request is opened and keeps it for the life of
# the repository: rewriting a branch does not rewrite those, closing or merging
# the PR does not delete them, and they remain fetchable by anyone. On this
# repository they still carry the pre-FUEL-14 figures.
#
# That is a deliberate, accepted state — the owner chose force-push-only on
# 2026-08-19 knowing this — and check 3 exists to keep it accepted rather than
# forgotten. It is the reason this script does not simply print PASS: a green
# scan against local refs is not evidence of a clean repository, only of a clean
# clone, and the difference is the whole point of the exercise.
#
# Closing the gap needs GitHub Support to purge the stale refs, or the
# repository deleted and recreated. Neither is something this script can do.
#
# Usage:
#   ./scripts/check-no-metrics.sh               # full scan: tree + history + published refs
#   ./scripts/check-no-metrics.sh --tree-only   # working tree + structure only (pre-commit)
#   ./scripts/check-no-metrics.sh --no-remote   # skip the published-refs check (offline)
#   ./scripts/check-no-metrics.sh --show-values # print matches unredacted (local only)
#
# Exit: 0 clean · 1 findings · 2 usage or environment error
#       3 published-refs residue only — see the note by the exit itself
#
set -euo pipefail

readonly SELF="${0##*/}"

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

TREE_ONLY=0
SHOW_VALUES=0
NO_REMOTE=0

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; $d'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tree-only) TREE_ONLY=1 ;;
    # Opt out of the published-refs check when there is deliberately no network
    # (an offline machine, an air-gapped CI). It still SKIPs loudly and still
    # fails the run — see scan_published_refs — because "I could not look" and
    # "I looked and it was clean" must never print the same result.
    --no-remote) NO_REMOTE=1 ;;
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

# Temp files holding real metrics, removed on any exit. A registry rather than a
# `trap` per check: bash keeps one handler per signal, so the second check to
# call `trap` would silently disarm the first one's cleanup and leave a dump of
# the owner's figures in TMPDIR.
CLEANUP_FILES=""

# The ref namespace check 3 borrows to hold the host's refs while it reads them.
# Defined here, above the trap that calls it, so an early exit cannot fire a
# handler that does not exist yet.
readonly PUBLISHED_NS="refs/remotes/check-no-metrics"

# Delete every ref under that namespace. The fetched objects stay in the object
# store until the next gc, but with no ref pointing at them they are unreachable
# — which matters, because otherwise check 2's `git log -p --all` would pick up
# the host's refs on the next run and report them as this clone's own history.
drop_published_ns() {
  local ref
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    git update-ref -d "$ref" 2>/dev/null || true
  done < <(git for-each-ref --format='%(refname)' "$PUBLISHED_NS" 2>/dev/null || true)
}

cleanup() {
  local f
  for f in $CLEANUP_FILES; do
    rm -f "$f"
  done
  drop_published_ns
}
trap cleanup EXIT INT TERM

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

# FUEL-34's weigh-in fixtures, kept apart from ALLOW_KG on purpose.
#
# The note above on `weight_logs.weightKg` says a 12-week series is "an
# open-ended set of values that no allowlist can track", and excludes the FIELD
# form for that reason. What it did not anticipate is the same series rendered
# as PROSE: `/weight` prints "79.3 kg" on the screen, so its tests assert that
# string, and the body-weight pattern matches it exactly as designed.
#
# These are the values those fixtures and doc comments use. Every one is
# invented and none is the owner's — the fixtures file states the same rule
# ("Body metrics in tests are fixtures, never data"). They are a separate
# constant rather than more entries in ALLOW_KG because the two sets mean
# different things and only one of them belongs in a profile: PROFILE_FIELD_ALLOW
# below takes ALLOW_KG alone, so any of these assigned to a profile column is
# still a finding — as the line this sentence used to name was, correctly, when
# it spelled the assignment out.
#
# Keep this list short. Every value on it is a value the history scan will also
# wave through, so a new fixture should reuse one of these before adding another.
readonly ALLOW_KG_FIXTURE="77.4 79.3 80.1 80.4 80.8 88.2"
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
  # The tradeoff, stated where it is made: these values are waved through by the
  # TREE scan and the HISTORY scan alike, in prose position. They are plausible
  # human weights, so a real figure that happened to equal one would pass. See
  # ALLOW_KG_FIXTURE above — profile-field assignments are unaffected.
  "$ALLOW_KG $ALLOW_KG_FIXTURE"
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
  printf '\n[1/5] working tree — tracked and untracked files, no directory exempt\n'

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
  printf '\n[2/5] git history — every patch on every ref\n'

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
  CLEANUP_FILES="$CLEANUP_FILES $dump"
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
# Check 3 — refs the host publishes that this clone does not have
#
# Checks 1 and 2 answer "what is in my copy". This one answers the question that
# actually matters for a public repository: what can a stranger read?
#
# Those are not the same question, and on this repository they have not had the
# same answer since 2026-08-19. A `git filter-repo` rewrite plus a force-push
# removed the pre-FUEL-14 figures from every branch — so check 2, which walks
# `git log -p --all` over LOCAL refs, went green and has been green since.
#
# GitHub kept serving the originals anyway. It creates `refs/pull/N/head` when a
# pull request is opened and never deletes it: not on force-push, not on merge,
# not on close. Those refs are outside `refs/heads/*`, so a rewrite cannot reach
# them and a normal `git fetch` never downloads them — which is precisely why
# check 2 could not see them and reported a clean history regardless.
#
# A check whose result depends on which refs happen to be local is a check that
# fails open. This script already refuses that twice (the shallow-clone guard
# and the empty-dump guard, both below and above); this is the same defect in
# its third disguise, and it is the one that was actually live.
#
# So: enumerate the host's refs, fetch the ones this clone cannot already reach,
# and run the same patterns over the patches unique to them. Findings are
# redacted exactly as everywhere else — a public CI log must not carry the value
# this check exists to report.
# ---------------------------------------------------------------------------

scan_published_refs() {
  printf '\n[3/5] published refs — what the host serves that a clone does not\n'

  if [ "$NO_REMOTE" -eq 1 ]; then
    printf '  SKIPPED (--no-remote): the host was not contacted.\n'
    printf '  This counts as a failure, not a pass. The whole point of this check\n'
    printf '  is that a clean local clone proves nothing about the published\n'
    printf '  repository, so "I did not look" cannot be allowed to print PASS.\n'
    fail_check "published-refs(skipped)"
    return
  fi

  local remote
  remote="$(git remote | grep -Fxq origin && printf 'origin' || git remote | head -1)"

  if [ -z "$remote" ]; then
    printf '  no git remote configured — nothing is published from here.\n'
    printf '  clean by construction\n'
    return
  fi

  # The refs this clone can already reach, captured BEFORE the fetch. Everything
  # below is expressed as "reachable from the host, but not from these", so the
  # list has to be taken while it is still true.
  local local_refs
  local_refs="$(git for-each-ref --format='%(refname)' |
    grep -v "^$PUBLISHED_NS/" || true)"

  # Start from a clean namespace: a previous interrupted run could otherwise
  # leave refs behind and have them counted as local.
  drop_published_ns

  # Pull requests and branches both. A branch is normally already local, and
  # `--not` will drop it; including it costs nothing and covers the case of a
  # branch that was pushed and never fetched back.
  if ! git fetch --no-tags --quiet "$remote" \
    "+refs/pull/*/head:$PUBLISHED_NS/pull/*" \
    "+refs/heads/*:$PUBLISHED_NS/heads/*" 2>/dev/null; then
    printf '  ERROR: could not fetch from "%s".\n' "$remote"
    printf '  Refusing to report a clean repository that was never read. If this\n'
    printf '  machine is deliberately offline, pass --no-remote — it fails too,\n'
    printf '  but it says so rather than implying the host was checked.\n'
    fail_check "published-refs(unreachable)"
    return
  fi

  local published_refs
  published_refs="$(git for-each-ref --format='%(refname)' "$PUBLISHED_NS" || true)"

  if [ -z "$published_refs" ]; then
    printf '  the host publishes no refs beyond this clone\n'
    printf '  clean\n'
    return
  fi

  local dump
  dump="$(mktemp "${TMPDIR:-/tmp}/check-no-metrics-pub.XXXXXX")"
  chmod 600 "$dump"
  CLEANUP_FILES="$CLEANUP_FILES $dump"

  # Patches unique to the host: everything reachable from its refs, minus
  # everything reachable from ours. On a repository whose history has never been
  # rewritten this is empty and the check is nearly free.
  # shellcheck disable=SC2086
  git log -p --no-color $published_refs --not $local_refs >"$dump" 2>/dev/null || true

  if [ ! -s "$dump" ]; then
    printf '  %s serves nothing this clone cannot already reach\n' "$remote"
    printf '  clean\n'
    return
  fi

  local i name regex allow linefilter line match count hits=0
  local -a offenders=()

  for i in "${!PATTERN_REGEX[@]}"; do
    name="${PATTERN_NAMES[$i]}"
    regex="${PATTERN_REGEX[$i]}"
    allow="${PATTERN_ALLOW[$i]}"
    linefilter="${PATTERN_LINEFILTER[$i]}"

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
    printf '  clean — nothing metric-shaped in what %s serves and we do not have\n' \
      "$remote"
    return
  fi

  # Name the refs, not just the commits. "refs/pull/14/head" tells the owner
  # which pull request page still renders the value; a bare sha does not.
  printf '\n  Reachable from these published refs:\n'
  {
    for match in "${offenders[@]}"; do
      local ref sha
      while IFS= read -r ref; do
        [ -z "$ref" ] && continue
        sha="$(git log --format='%h' -1 -S"$match" "$ref" --not $local_refs 2>/dev/null || true)"
        [ -n "$sha" ] && printf '%s\n' "${ref#"$PUBLISHED_NS/"}"
      done <<<"$published_refs"
    done
  } | sort -u -V | sed 's|^|    refs/|'

  printf '\n  %d distinct value(s) served by %s and absent from this clone.\n' \
    "$hits" "$remote"
  printf '  A force-push does not reach refs/pull/*; they outlive the branch, the\n'
  printf '  merge and the pull request. Removing them needs the host — GitHub\n'
  printf '  Support can purge stale refs — or the repository recreated.\n'
  printf '\n'
  printf '  On THIS repository a known set of pre-2026-08-19 values is expected\n'
  printf '  here and has been accepted deliberately — see the header. That is not\n'
  printf '  a licence to wave the check through: anything outside that set is new,\n'
  printf '  and this output cannot tell you which you are looking at. Compare\n'
  printf '  against the header before dismissing a finding.\n'
  fail_check "published-refs"
}

# ---------------------------------------------------------------------------
# Check 4 — no .env file is tracked
#
# .env.example is the deliberate exception, kept in the index by the
# `!.env.example` negation in .gitignore: it is the template the setup docs
# point at and it carries no values. Anything else matching .env* is a secret.
# ---------------------------------------------------------------------------

check_env_files() {
  printf '\n[4/5] .env files — none tracked except the template\n'

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
# Check 5 — the local seed script stays out of the index
#
# The counterpart to skipping ignored files in check 1. scripts/seed-local.ts
# is where the owner's real profile and weigh-in history live, so the guarantee
# that matters is not "it contains nothing" but "it is never committed".
# ---------------------------------------------------------------------------

readonly LOCAL_SEED="scripts/seed-local.ts"

check_local_seed_ignored() {
  printf '\n[5/5] %s — ignored and never tracked\n' "$LOCAL_SEED"

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

# Clear the borrowed namespace before check 2 reads history, not merely before
# check 3 fills it. The trap covers a normal exit and an interrupt, but nothing
# can run on SIGKILL — and a ref left behind by a killed run is a ref that
# `git log -p --all` counts as this clone's own history, so the next run would
# report the host's commits as local ones. That is a false RED rather than a
# false green, and it self-heals on the run after, but "the scan told me my
# history was dirty and then it wasn't" is a bad half-hour for whoever hits it.
drop_published_ns

printf 'check-no-metrics'
[ "$TREE_ONLY" -eq 1 ] && printf ' (--tree-only)'
printf '\n'
hr

scan_tree

if [ "$TREE_ONLY" -eq 1 ]; then
  printf '\n[2/5] git history — SKIPPED (--tree-only)\n'
  printf '  A commit cannot fix history, so the hook does not gate on it.\n'
  printf '  Run without --tree-only before publishing.\n'
  printf '\n[3/5] published refs — SKIPPED (--tree-only)\n'
  printf '  Needs the network, and a commit cannot fix the host either.\n'
  printf '  Run without --tree-only before publishing.\n'
else
  scan_history
  scan_published_refs
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

# Exit 3 when the ONLY thing wrong is the published-refs residue described in
# the header — the pre-2026-08-19 values that GitHub still serves from
# refs/pull/*, which no commit in this repository can remove.
#
# The distinction exists so CI can gate. Without it the workflow would be red on
# every run from the day it was added, for a state nobody can fix from here, and
# a permanently red check teaches everyone to ignore it — which would cost more
# than the check is worth on the day a real regression lands.
#
# It is deliberately narrow. "published-refs(skipped)" and
# "published-refs(unreachable)" do NOT qualify: those mean the host was not
# read, and an unread host is a failure like any other. Only a scan that ran,
# looked, and found nothing but the known residue exits 3.
if [ "$FAILED_CHECKS" = " published-refs" ]; then
  printf '\nExit 3: the published-refs residue only — the accepted state, and not\n'
  printf 'fixable from this repository. Nothing in the tree or this history is\n'
  printf 'dirty. Compare the values above against the header before treating this\n'
  printf 'as the expected result.\n'
  exit 3
fi

exit 1

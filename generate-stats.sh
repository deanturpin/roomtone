#!/bin/bash

# Generate codebase statistics for ROOMTONE
echo "Generating codebase statistics..."

# Count lines by file type
JS_LINES=$(find docs/ -name "*.js" | xargs wc -l | tail -1 | awk '{print $1}')
HTML_LINES=$(find docs/ -name "*.html" | xargs wc -l | tail -1 | awk '{print $1}')
CSS_LINES=$(find docs/ -name "*.css" | xargs wc -l | tail -1 | awk '{print $1}')
MD_LINES=$(wc -l *.md CLAUDE.md | tail -1 | awk '{print $1}')
MAKE_LINES=$(wc -l Makefile | awk '{print $1}')

# Count files
JS_FILES=$(find docs/ -name "*.js" | wc -l | tr -d ' ')
HTML_FILES=$(find docs/ -name "*.html" | wc -l | tr -d ' ')
CSS_FILES=$(find docs/ -name "*.css" | wc -l | tr -d ' ')
MD_FILES=$(ls *.md CLAUDE.md 2>/dev/null | wc -l | tr -d ' ')

# Total lines (avoiding duplicates by counting unique source files only)
TOTAL_LINES=$(($(find docs/latest/ docs/stable/ -name "*.js" -o -name "*.html" -o -name "*.css" | head -6 | xargs wc -l | tail -1 | awk '{print $1}') + $MD_LINES + $MAKE_LINES))

# Get git stats
COMMITS=$(git rev-list --count HEAD)
LAST_COMMIT=$(git log -1 --format="%h")
LAST_DATE=$(git log -1 --format="%cd" --date=short)

# Generate JSON for landing page
cat > docs/stats.json << EOF
{
  "generated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "lines": {
    "javascript": $JS_LINES,
    "html": $HTML_LINES,
    "css": $CSS_LINES,
    "markdown": $MD_LINES,
    "makefile": $MAKE_LINES,
    "total": $TOTAL_LINES
  },
  "files": {
    "javascript": $JS_FILES,
    "html": $HTML_FILES,
    "css": $CSS_FILES,
    "markdown": $MD_FILES,
    "total": $((JS_FILES + HTML_FILES + CSS_FILES + MD_FILES + 1))
  },
  "git": {
    "commits": $COMMITS,
    "lastCommit": "$LAST_COMMIT",
    "lastDate": "$LAST_DATE"
  }
}
EOF

echo "Stats generated in docs/stats.json"
echo "Total lines of code: $TOTAL_LINES"
echo "Total commits: $COMMITS"
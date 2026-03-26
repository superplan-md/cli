#!/bin/bash
set -euo pipefail

# This script populates the output/ directory with agent-specific configuration files
# and skills from the canonical source (the skills/ directory).

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/output"
SKILLS_DIR="$REPO_ROOT/output/skills"

echo "Populating output directory..."

# 1. Clean up and ensure structure exists
mkdir -p "$OUTPUT_DIR/agents/workflows"
mkdir -p "$OUTPUT_DIR/claude/skills"
mkdir -p "$OUTPUT_DIR/claude-plugin"
mkdir -p "$OUTPUT_DIR/cursor/skills"
mkdir -p "$OUTPUT_DIR/cursor-plugin"
mkdir -p "$OUTPUT_DIR/opencode-plugin"
mkdir -p "$OUTPUT_DIR/codex-plugin"
mkdir -p "$OUTPUT_DIR/opencode/skills"
mkdir -p "$OUTPUT_DIR/codex/skills"
mkdir -p "$OUTPUT_DIR/gemini"
mkdir -p "$OUTPUT_DIR/playwright"

# 2. Populate Gemini/Antigravity (Agents workflows)
# Each SKILL.md in a subfolder of skills/ becomes a separately named file
echo "Populating Agents workflows..."
find "$SKILLS_DIR" -maxdepth 2 -name "SKILL.md" | while read -r skill_path; do
  skill_name=$(basename "$(dirname "$skill_path")")
  cp "$skill_path" "$OUTPUT_DIR/agents/workflows/$skill_name.md"
done

# 3. Populate common skills for other tools
# For now, this is just 00-superplan-principles.md
echo "Populating common skills..."
COMMON_SKILLS="00-superplan-principles.md"
for tool in claude cursor opencode codex; do
  cp "$SKILLS_DIR/$COMMON_SKILLS" "$OUTPUT_DIR/$tool/skills/"
done

# 4. Handle tool-specific skill subdirectories
if [ -d "$REPO_ROOT/.codex/skills/office-hours" ]; then
    cp -r "$REPO_ROOT/.codex/skills/office-hours" "$OUTPUT_DIR/codex/skills/"
fi

# 5. Fix template paths
echo "Fixing template paths..."
if [ -f "$OUTPUT_DIR/gemini/GEMINI.md" ]; then
    sed 's|@./skills/|@.superplan/skills/|g' "$OUTPUT_DIR/gemini/GEMINI.md" > "$OUTPUT_DIR/gemini/GEMINI.md.tmp"
    mv "$OUTPUT_DIR/gemini/GEMINI.md.tmp" "$OUTPUT_DIR/gemini/GEMINI.md"
fi

echo "Output directory populated successfully."

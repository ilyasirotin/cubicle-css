#!/usr/bin/env bash
# PreToolUse hook for Bash: stops publishing actions until the maintainer does them.
# AGENTS.md Section 11: "Git Authority: Do not push to remote or create Git tags without the maintainer's explicit instruction."
#
# A permission rule such as Bash(git push *) can be bypassed by `git -C . push`,
# so this hook inspects the whole command instead. Exit code 2 blocks the call and
# sends the message below back to Claude.
#
# To allow one publishing command yourself, run it in your own terminal.
# Set CUBICLE_ALLOW_PUBLISH=1 in the environment to disable this guard for a session.

input=$(cat)

[ "${CUBICLE_ALLOW_PUBLISH:-0}" = "1" ] && exit 0
grep -q '"tool_name"[[:space:]]*:[[:space:]]*"Bash"' <<<"$input" || exit 0

if grep -Eq '(git[^"|;&]*[[:space:]](push|tag)([[:space:]"]|\\)|gh[[:space:]]+(release|pr[[:space:]]+(create|merge))|npm[[:space:]]+publish|git[^"|;&]*[[:space:]]reset[[:space:]]+--hard)' <<<"$input"; then
  echo "Blocked: pushing, tagging, releasing, publishing and hard resets need the maintainer's explicit instruction (AGENTS.md Section 11). Prepare the commit and the changelog entry, then stop and ask." >&2
  exit 2
fi

exit 0

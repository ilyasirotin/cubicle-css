#!/usr/bin/env bash
# PreToolUse hook for Bash: stops publishing actions until the maintainer does them.
# AGENTS.md Section 11: "Git Authority: Do not push to remote or create Git tags without the maintainer's explicit instruction."
#
# A permission rule such as Bash(git push *) can be bypassed by `git -C . push`,
# so this hook inspects the whole command instead. Exit code 2 blocks the call and
# sends the message below back to Claude.
#
# Only a real subcommand is blocked: `git`, optional global options (-C dir, -c k=v,
# --long[=value]), then push, tag or `reset --hard`, where a command starts: at the
# beginning, after ; & | ( or a newline. The words alone, for example in a commit
# message or inside a quoted string, are not. The input is the tool call as JSON, so a
# command may start after `":"` or after an escaped newline (\n), and a quoted string
# inside the command shows up as \".
#
# To allow one publishing command yourself, run it in your own terminal.
# Set CUBICLE_ALLOW_PUBLISH=1 in the environment to disable this guard for a session.

input=$(cat)

[ "${CUBICLE_ALLOW_PUBLISH:-0}" = "1" ] && exit 0
grep -q '"tool_name"[[:space:]]*:[[:space:]]*"Bash"' <<<"$input" || exit 0

start='(^|[;&|(]|[^\\]"|\\n)[[:space:]]*'
options='([[:space:]]+(-C|-c)[[:space:]]+[^[:space:]"\\]+|[[:space:]]+--[a-z-]+(=[^[:space:]"\\]+)?)*'
git_publish="${start}git${options}[[:space:]]+(push|tag|reset[[:space:]]+--hard)([[:space:]\";&|)]|\\\\|\$)"
other_publish='gh[[:space:]]+(release|pr[[:space:]]+(create|merge))|npm[[:space:]]+publish'

if grep -Eq "(${git_publish}|${other_publish})" <<<"$input"; then
  echo "Blocked: pushing, tagging, releasing, publishing and hard resets need the maintainer's explicit instruction (AGENTS.md Section 11). Prepare the commit and the changelog entry, then stop and ask." >&2
  exit 2
fi

exit 0

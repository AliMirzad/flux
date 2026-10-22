#!/bin/zsh
set -euo pipefail
configure="$HOME/Library/Application Support/Flux/Media Companion/configure"
if [[ ! -x "$configure" ]]; then
  print 'Install the Flux media companion first, then run this file again.'
  read -r '?Press Return to close this window.' || true
  exit 1
fi
if ! folder=$(/usr/bin/osascript -e 'POSIX path of (choose folder with prompt "Approve a save folder for Flux media")'); then
  exit 0
fi
label="${folder%/}"
label="${label:t}"
if ! "$configure" approve "$folder" --label "${label:-Media}"; then
  print 'Could not approve this folder. Read the error above and choose another folder.'
  read -r '?Press Return to close this window.' || true
  exit 1
fi
print '\nFolder approved. Return to Flux and choose Refresh save folders.'
read -r '?Press Return to close this window.' || true

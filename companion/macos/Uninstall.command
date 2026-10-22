#!/bin/zsh
set -euo pipefail
cd -- "${0:A:h}"
finish() {
  result=$?
  if (( result != 0 )); then
    print '\nRemoval stopped. Read the error above.'
  fi
  read -r '?Press Return to close this window.' || true
  exit $result
}
trap finish EXIT
runtime="$HOME/Library/Application Support/Flux/Media Runtime/bin/python"
if [[ ! -x "$runtime" ]]; then
  print -u2 'The companion runtime is unavailable. Use the manual uninstall instructions.'
  exit 1
fi
read -r 'confirmed?Remove the Flux companion registration and host files? Close any media review first. [y/N] '
if [[ "$confirmed" != [yY] ]]; then
  print 'Removal canceled.'
  exit 0
fi
"$runtime" -B install.py uninstall
print 'Companion removed. Your save folders, approvals and Python runtime were preserved.'

#!/bin/zsh
set -euo pipefail
cd -- "${0:A:h}"
umask 077

finish() {
  result=$?
  if (( result != 0 )); then
    print '\nSetup stopped. Keep this window open to read the error above.'
  fi
  read -r '?Press Return to close this window.' || true
  exit $result
}
trap finish EXIT

print 'Flux media companion · macOS development installer'
print 'This installs a local Chrome helper and downloads the pinned yt-dlp Python package.'
print 'Python 3.10 or later is required. FFmpeg is needed for future downloads and conversion.'
print 'Your normal Flux downloads do not need this companion. No administrator password is required.\n'
read -r 'extension_id?Paste the extension ID shown in Flux Settings: '
if [[ ! "$extension_id" =~ '^[a-p]{32}$' ]]; then
  print -u2 'Invalid extension ID. Copy the 32-letter ID from Flux Settings.'
  exit 1
fi
candidate="$(command -v python3 || true)"
read -r "python_choice?Python executable [${candidate:-enter an absolute path}]: "
python_bin="${python_choice:-$candidate}"
if [[ "$python_bin" != /* || ! -x "$python_bin" ]]; then
  print -u2 'Enter the absolute path of an installed Python 3.10+ executable.'
  exit 1
fi
"$python_bin" -I -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else "Python 3.10 or later is required.")'
read -r 'confirmed?Install the companion and its Python dependencies? [y/N] '
if [[ "$confirmed" != [yY] ]]; then
  print 'Installation canceled.'
  exit 0
fi

runtime="$HOME/Library/Application Support/Flux/Media Runtime"
host="$HOME/Library/Application Support/Flux/Media Companion"
manifest="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.flux.media_companion.json"
if [[ ! -e "$runtime" ]]; then
  "$python_bin" -I -m venv "$runtime"
fi
if [[ ! -x "$runtime/bin/python" ]]; then
  print -u2 "The runtime folder already exists without a usable Python: $runtime"
  exit 1
fi
"$runtime/bin/python" -I -m pip install --disable-pip-version-check -r requirements.txt
if [[ -e "$manifest" || -e "$host" ]]; then
  read -r 'replace?Replace the existing Flux companion? Close any media review first. [y/N] '
  if [[ "$replace" != [yY] ]]; then
    print 'Installation canceled; existing registration retained.'
    exit 0
  fi
  "$runtime/bin/python" -B install.py uninstall
fi
"$runtime/bin/python" -B install.py install --extension-id "$extension_id"
print '\nCompanion installed. Return to Flux Settings and choose Check companion connection.'
print 'Run Choose save folder.command to approve a destination, then refresh save folders in Flux.'

# Flux media companion setup for macOS

This development preview supports media inspection and save-folder approvals. It does not download media yet. Ordinary Flux downloads work without the companion.

## Install

1. In Flux Settings, choose **Copy extension ID**.
2. Unzip this folder and open **Install.command**.
3. Paste the extension ID and select an installed Python 3.10+ executable. The command shows the default path; enter another absolute path if needed.
4. Confirm installation. Setup creates a Python runtime in `~/Library/Application Support/Flux/Media Runtime` and downloads the pinned yt-dlp package. Internet access is required. No administrator password is needed.
5. Return to Flux Settings, choose **Check companion connection** and grant Chrome access when asked.

This installer is unsigned. If macOS blocks it, review the downloaded files and allow the command through **System Settings → Privacy & Security**. Keep the extension folder in place to retain its ID. If its ID changes, run setup again with the new ID.

The installer asks before replacing an existing companion. Close any media review first. FFmpeg and ffprobe are not included; the upcoming download/conversion flow will require them. Settings reports whether they are installed.

## Approve a save folder

Open **Choose save folder.command**, choose a folder in the macOS picker, then select **Refresh save folders** in Flux. Folder approval is local. Chrome receives an opaque ID and display label. A moved or replaced folder needs approval again.

The folder setup command is also downloadable separately from Flux Settings. Unzip it before opening it.

## Remove the companion

Open **Uninstall.command** in this downloaded folder and confirm removal. Close any media review first. If the runtime has moved, use an installed Python 3.10+ with the copy of `install.py` in this downloaded folder:

```sh
python3 -B "/path/to/Flux Media Companion/install.py" uninstall
```

Uninstall removes native registration and owned host files. Save-folder approvals, your media and the independently created Python runtime remain. Remove `~/Library/Application Support/Flux/Media Companion Data` and `~/Library/Application Support/Flux/Media Runtime` locally if you also want to erase approvals and the runtime.

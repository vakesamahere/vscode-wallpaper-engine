# Change Log

All notable changes to the "vscode-wallpaper-engine" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.2] - 2025-11-23

### Fixed

- **Server**: Fixed `EADDRINUSE` error where the wallpaper server port (23333) remained occupied after reload (Zombie Server issue).
- **Web Wallpapers**: Fixed `api/get-entry` 404 error for wallpapers with dependencies (e.g. `index.html` in a referenced folder).
- **Persistence**: Fixed issue where wallpaper type (Video/Web) was lost after VS Code restart.

## [0.0.1] - Initial Release

- Basic Wallpaper Engine support (Video, Image, Web).
- Transparency patch.

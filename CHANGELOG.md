# Change Log

All notable changes to the "vscode-wallpaper-engine" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.4] - 2025-12-06

### Added

- **Transparency**: Expanded transparency support for more UI elements including Title Bar, Notifications, Menus, Quick Input, and Status Bar items.

### Fixed

- **Settings Panel**: Fixed an issue where transparency settings appeared to reset when reopening the panel due to workspace settings shadowing global configuration.
- **Core**: Fixed workbench background transparency by injecting CSS rule for `div[role="application"]` via JS.

## [0.0.3] - 2025-11-23

### Added

- **Settings Panel**: Added "Open Wallpaper Folder" button to quickly access the wallpaper directory.
- **Settings Panel**: Added "Wallpaper Info" section displaying Name, Type, Entry File, and Path.
- **Debug Sidebar**: Added "Open Wallpaper Folder" button.

### Fixed

- **Core**: Fixed `net::ERR_FILE_NOT_FOUND` for relative paths in wallpapers by injecting `<base>` tag.
- **Core**: Fixed `SecurityError: Tainted canvases` in WebGL wallpapers by forcing `crossOrigin="anonymous"` on media elements.
- **Core**: Fixed Regex syntax errors in injected script due to incorrect backslash escaping.
- **UI**: Fixed Settings Panel sliders and switches color to match VS Code theme button color.

## [0.0.2] - 2025-11-23

### Fixed

- **Server**: Fixed `EADDRINUSE` error where the wallpaper server port (23333) remained occupied after reload (Zombie Server issue).
- **Web Wallpapers**: Fixed `api/get-entry` 404 error for wallpapers with dependencies (e.g. `index.html` in a referenced folder).
- **Persistence**: Fixed issue where wallpaper type (Video/Web) was lost after VS Code restart.

## [0.0.1] - Initial Release

- Basic Wallpaper Engine support (Video, Image, Web).
- Transparency patch.

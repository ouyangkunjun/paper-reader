# GitHub Pages Build

This folder is the static build for Paper Reader.

Publish this folder with GitHub Pages using:

- Branch: `main`
- Folder: `/docs`

The page reads local files selected by the visitor through the browser folder picker. PDFs and notes are not uploaded. Read state, notes, tags, progress, and per-paper AI chat history are stored in the visitor's browser localStorage.

The static build can call a user-configured MiMo-compatible API for per-paper Q&A, pasted-image questions, and screenshot translation. Server-side login, multi-user libraries, full-paper AI translation, related-paper search, and server-side uploads remain available in the Python enhanced version from the repository root.

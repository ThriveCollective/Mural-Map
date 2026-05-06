@echo off
REM Simple HTTP server for running the Thrive Mural Map locally on Windows
REM This is needed because browsers block fetch requests when opening HTML files directly (file:// protocol).

echo Starting server at http://localhost:8000
echo Open http://localhost:8000 in your browser to view the map.
echo Press Ctrl+C to stop the server.
echo.

python server.py

pause


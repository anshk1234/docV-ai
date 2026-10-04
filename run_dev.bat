@echo off
echo ========================================================
echo   docV.ai - Intelligent Document Investigator
echo   Starting Backend (FastAPI) and Frontend (Next.js)
echo ========================================================

start "docV.ai Backend (FastAPI)" cmd /k "cd /d D:\algo hackathon\backend && .venv\Scripts\activate && uvicorn main:app --reload --port 8000"
start "docV.ai Frontend (Next.js)" cmd /k "cd /d D:\algo hackathon\frontend && npm run dev"

echo.
echo Both servers are launching:
echo   - Backend API: http://localhost:8000
echo   - Frontend UI:  http://localhost:3000
echo.
pause

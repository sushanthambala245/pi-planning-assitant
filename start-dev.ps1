# Starts the backend (port 8000) and the frontend (port 5173) in two new PowerShell windows.
# Run the one-time installs from README.md first.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

if (-not (Test-Path (Join-Path $backend ".venv\Scripts\python.exe"))) {
    Write-Error "backend\.venv not found: run the backend install steps in README.md first."; exit 1
}
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Error "frontend\node_modules not found: run 'npm install' in frontend first."; exit 1
}
# Vite 8 needs Node 20.19+ or 22.12+; on older Node, npm silently skips its native bundler.
$node = [version]((node --version) -replace '^v', '')
if (-not (($node.Major -eq 20 -and $node.Minor -ge 19) -or ($node.Major -eq 22 -and $node.Minor -ge 12) -or $node.Major -ge 23)) {
    Write-Warning "Node $node is older than Vite 8 supports: if the frontend window fails with 'Cannot find native binding', install Node 22.12+ (or 20.19+) and run 'npm install' in frontend again."
}

Start-Process powershell -WorkingDirectory $backend -ArgumentList "-NoExit", "-Command",
    "& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
Start-Process powershell -WorkingDirectory $frontend -ArgumentList "-NoExit", "-Command", "npm.cmd run dev"
Write-Output "Backend: http://localhost:8000/docs   Frontend: http://localhost:5173"

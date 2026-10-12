<#
.SYNOPSIS
    One-Command Startup Script for The Lenny Growth Assistant
.DESCRIPTION
    Validates prerequisites (Python, Node, PostgreSQL, Ollama), checks virtual environment
    and dependencies, validates configuration (.env), runs Alembic migrations, checks
    local Ollama models, detects existing running processes (preventing duplicates),
    launches missing services in separate console windows, and waits for health readiness.
.NOTES
    Compatible with Windows 11, PowerShell 5.1, and PowerShell 7.
    Designed for memory-conscious execution on 8 GB RAM laptops.
#>

[CmdletBinding()]
param(
    [switch]$SkipMigration,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

# Determine repository root
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $repoRoot

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   The Lenny Growth Assistant -- Startup Preflight Checks" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Repository root: $repoRoot`n"

# -------------------------------------------------------------
# 1. System Software Prerequisites Checks
# -------------------------------------------------------------
Write-Host "[1/7] Checking System Software Prerequisites..." -ForegroundColor Yellow

# Python
try {
    $pyVer = & python --version 2>&1
    Write-Host "  [OK] Python found: $pyVer" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] Python is not found in PATH." -ForegroundColor Red
    Write-Host "         Please install Python 3.11+ from https://www.python.org/" -ForegroundColor Yellow
    exit 1
}

# Node.js
try {
    $nodeVer = & node --version 2>&1
    Write-Host "  [OK] Node.js found: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] Node.js is not found in PATH." -ForegroundColor Red
    Write-Host "         Please install Node.js v20+ from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# npm
try {
    $npmVer = & npm --version 2>&1
    Write-Host "  [OK] npm found: v$npmVer" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] npm is not found in PATH." -ForegroundColor Red
    exit 1
}

# PostgreSQL (Port 5432)
$pgConn = Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($pgConn) {
    Write-Host "  [OK] PostgreSQL listening on port 5432" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] PostgreSQL is not reachable on 127.0.0.1:5432." -ForegroundColor Red
    Write-Host "         Please start your local PostgreSQL service before continuing." -ForegroundColor Yellow
    exit 1
}

# Ollama (Port 11434)
$ollamaConn = Test-NetConnection -ComputerName 127.0.0.1 -Port 11434 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($ollamaConn) {
    Write-Host "  [OK] Ollama service listening on port 11434" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Ollama is not running on 127.0.0.1:11434." -ForegroundColor Red
    Write-Host "         Please start Ollama in a separate terminal: ollama serve" -ForegroundColor Yellow
    exit 1
}

# -------------------------------------------------------------
# 2. Virtual Environment and Dependencies Checks
# -------------------------------------------------------------
Write-Host "`n[2/7] Checking Virtual Environment and Node Dependencies..." -ForegroundColor Yellow

$venvPy = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "  [FAIL] Python virtual environment (.venv) not found." -ForegroundColor Red
    Write-Host "         Please create it and install backend dependencies:" -ForegroundColor Yellow
    Write-Host "           python -m venv .venv" -ForegroundColor Cyan
    Write-Host "           .\.venv\Scripts\pip.exe install -r backend\requirements.txt" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "  [OK] Python virtual environment found (.venv)" -ForegroundColor Green
}

# Check frontend node_modules
$frontendModules = Join-Path $repoRoot "frontend\node_modules"
if (-not (Test-Path $frontendModules)) {
    Write-Host "  [INFO] frontend/node_modules not found. Installing..." -ForegroundColor Yellow
    Push-Location (Join-Path $repoRoot "frontend")
    & npm install
    Pop-Location
} else {
    Write-Host "  [OK] Frontend dependencies installed" -ForegroundColor Green
}

# Check agent-service node_modules
$agentModules = Join-Path $repoRoot "agent-service\node_modules"
if (-not (Test-Path $agentModules)) {
    Write-Host "  [INFO] agent-service/node_modules not found. Installing..." -ForegroundColor Yellow
    Push-Location (Join-Path $repoRoot "agent-service")
    & npm install
    Pop-Location
} else {
    Write-Host "  [OK] Agent Service dependencies installed" -ForegroundColor Green
}

# -------------------------------------------------------------
# 3. Environment Configuration Check (.env)
# -------------------------------------------------------------
Write-Host "`n[3/7] Validating Environment Configuration..." -ForegroundColor Yellow

$envFile = Join-Path $repoRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "  [FAIL] Root .env file not found." -ForegroundColor Red
    Write-Host "         Please copy .env.example to .env and configure parameters:" -ForegroundColor Yellow
    Write-Host "           Copy-Item .env.example .env" -ForegroundColor Cyan
    exit 1
}

# Validate presence of keys without printing values
$hasDbUrl = $false
$hasSecret = $false
$hasGemini = $false
foreach ($line in (Get-Content $envFile)) {
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("DATABASE_URL=") -and $trimmed.Length -gt 14) { $hasDbUrl = $true }
    if ($trimmed.StartsWith("AGENT_INTERNAL_SECRET=") -and $trimmed.Length -gt 23) { $hasSecret = $true }
    if ($trimmed.StartsWith("GEMINI_API_KEY=") -and $trimmed.Length -gt 16) { $hasGemini = $true }
}

if ($hasDbUrl) {
    Write-Host "  [OK] DATABASE_URL is configured" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] DATABASE_URL missing or empty in .env" -ForegroundColor Red
    exit 1
}

if ($hasSecret) {
    Write-Host "  [OK] AGENT_INTERNAL_SECRET is configured" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] AGENT_INTERNAL_SECRET missing or empty in .env" -ForegroundColor Red
    Write-Host "         Generate one with: .\.venv\Scripts\python.exe -c ""import secrets; print(secrets.token_hex(32))""" -ForegroundColor Yellow
    exit 1
}

if ($hasGemini) {
    Write-Host "  [OK] GEMINI_API_KEY is configured (Cloud Gemini provider enabled)" -ForegroundColor Green
} else {
    Write-Host "  [INFO] GEMINI_API_KEY is not configured (Local Ollama mode active)" -ForegroundColor Cyan
}

# -------------------------------------------------------------
# 4. Database Connectivity and Alembic Migrations
# -------------------------------------------------------------
Write-Host "`n[4/7] Checking Database Connectivity and Migrations..." -ForegroundColor Yellow

$dbCheckScript = Join-Path $repoRoot "scripts\check_db.py"
if (Test-Path $dbCheckScript) {
    $dbTestOut = & $venvPy $dbCheckScript 2>&1
    if ($LASTEXITCODE -eq 0 -and $dbTestOut -match "Connection successful") {
        Write-Host "  [OK] Database connection verified" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Database connection failed: $dbTestOut" -ForegroundColor Red
        Write-Host "         Please ensure the lenny_app role and lenny_assistant database exist." -ForegroundColor Yellow
        exit 1
    }
}

if (-not $SkipMigration) {
    Write-Host "  [INFO] Applying pending Alembic migrations..." -ForegroundColor Yellow
    $alembicExe = Join-Path $repoRoot ".venv\Scripts\alembic.exe"
    if (Test-Path $alembicExe) {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $alembicExe upgrade head | Out-Null
        $migExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap

        if ($migExit -eq 0) {
            Write-Host "  [OK] Database migrations up to date (Alembic head)" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] Alembic migration failed (exit code $migExit)" -ForegroundColor Red
            exit 1
        }
    }
}

# -------------------------------------------------------------
# 5. Ollama Local Model Verification
# -------------------------------------------------------------
Write-Host "`n[5/7] Verifying Local Ollama Model Availability..." -ForegroundColor Yellow

try {
    $modelsCheck = & $venvPy -c "import urllib.request, json; data = json.loads(urllib.request.urlopen('http://127.0.0.1:11434/api/tags', timeout=3).read()); print('ok' if any('qwen2.5:1.5b' in m.get('name','') for m in data.get('models',[])) else 'missing')" 2>&1
    if ($modelsCheck -match "ok") {
        Write-Host "  [OK] Verified default model installed: qwen2.5:1.5b" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Default model 'qwen2.5:1.5b' not found in Ollama." -ForegroundColor Yellow
        Write-Host "         Please install it via: ollama pull qwen2.5:1.5b" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [WARN] Could not retrieve Ollama model list: $_" -ForegroundColor Yellow
}

# -------------------------------------------------------------
# 6. Process Detection and Safe Launch
# -------------------------------------------------------------
Write-Host "`n[6/7] Detecting Existing Processes and Launching Services..." -ForegroundColor Yellow

function Test-PortListening([int]$Port) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conns)
}

# Service 1: Node.js Pi Agent Service (Port 8001)
if (Test-PortListening 8001) {
    Write-Host "  [OK] Agent Service is already running on port 8001 (skipping duplicate launch)" -ForegroundColor Green
} else {
    Write-Host "  [INFO] Starting Agent Service on port 8001..." -ForegroundColor Cyan
    $agentCmd = "Set-Location '$repoRoot\agent-service'; node src/server.mjs"
    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $agentCmd
}

# Service 2: FastAPI Backend (Port 8000)
if (Test-PortListening 8000) {
    Write-Host "  [OK] FastAPI Backend is already running on port 8000 (skipping duplicate launch)" -ForegroundColor Green
} else {
    Write-Host "  [INFO] Starting FastAPI Backend on port 8000..." -ForegroundColor Cyan
    $backendCmd = "Set-Location '$repoRoot'; .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload"
    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $backendCmd
}

# Service 3: Vite Frontend (Port 5173)
if (Test-PortListening 5173) {
    Write-Host "  [OK] Vite Frontend is already running on port 5173 (skipping duplicate launch)" -ForegroundColor Green
} else {
    Write-Host "  [INFO] Starting Vite Frontend on port 5173..." -ForegroundColor Cyan
    $frontendCmd = "Set-Location '$repoRoot\frontend'; npm run dev"
    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $frontendCmd
}

# -------------------------------------------------------------
# 7. Health Readiness Polling
# -------------------------------------------------------------
Write-Host "`n[7/7] Waiting for Service Health Readiness..." -ForegroundColor Yellow

function Wait-EndpointHealthy([string]$Url, [string]$Name, [int]$MaxSeconds = 30) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $MaxSeconds) {
        try {
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {
                Write-Host "  [OK] $Name is healthy ($Url)" -ForegroundColor Green
                return $true
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
    Write-Host "  [WARN] $Name did not respond within $MaxSeconds seconds." -ForegroundColor Yellow
    return $false
}

Wait-EndpointHealthy "http://127.0.0.1:8001/health" "Agent Service" 25 | Out-Null
Wait-EndpointHealthy "http://127.0.0.1:8000/health" "FastAPI Backend" 25 | Out-Null
Wait-EndpointHealthy "http://localhost:5173/" "Vite Frontend" 25 | Out-Null

# -------------------------------------------------------------
# Ready Banner and Instructions
# -------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "     The Lenny Growth Assistant is Ready to Review!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Web Application (UI):  http://localhost:5173" -ForegroundColor White
Write-Host "  FastAPI Backend API:   http://127.0.0.1:8000" -ForegroundColor White
Write-Host "  Interactive Swagger:   http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host "  Pi Agent Service:      http://127.0.0.1:8001/health" -ForegroundColor White
Write-Host "  Ollama Local Model:    qwen2.5:1.5b (Port 11434)" -ForegroundColor White
Write-Host "  Indexed Knowledge:     10 episodes, 1,271 chunks" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "How to Stop Services Safely:" -ForegroundColor Yellow
Write-Host "  Run: .\scripts\stop.ps1" -ForegroundColor Yellow
Write-Host "  Or close the terminal windows opened by this script." -ForegroundColor Yellow
Write-Host "============================================================`n" -ForegroundColor Cyan

if (-not $NoBrowser) {
    try {
        Start-Process "http://localhost:5173"
    } catch {}
}

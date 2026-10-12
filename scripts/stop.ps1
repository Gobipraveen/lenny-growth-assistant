<#
.SYNOPSIS
    Stops The Lenny Growth Assistant Application Services Safely
.DESCRIPTION
    Identifies and terminates only the node and python processes listening
    on ports 8001 (Agent Service), 8000 (FastAPI), and 5173 (Vite).
    Preserves PostgreSQL (5432) and Ollama (11434).
#>

[CmdletBinding()]
param()

$ports = @(8001, 8000, 5173)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   The Lenny Growth Assistant — Stopping Application Services" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

foreach ($port in $ports) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($conn in $conns) {
                $procId = $conn.OwningProcess
                $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                if ($proc -and ($proc.ProcessName -match "node|python")) {
                    Write-Host "Stopping $($proc.ProcessName) (PID: $procId) on port $port..." -ForegroundColor Yellow
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                    Write-Host "  [OK] Terminated PID $procId on port $port" -ForegroundColor Green
                }
            }
        } else {
            Write-Host "Port $port is already idle." -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "Error checking port $port : $_" -ForegroundColor DarkGray
    }
}

Write-Host "`nAll application services on ports 8001, 8000, and 5173 have been stopped." -ForegroundColor Green
Write-Host "PostgreSQL (5432) and Ollama (11434) remain running." -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan

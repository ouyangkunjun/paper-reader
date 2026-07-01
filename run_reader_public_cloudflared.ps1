$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$Port = 8765
$BundledCloudflared = Join-Path $ScriptDir "tools\cloudflared.exe"
$Cloudflared = $null
if (Test-Path $BundledCloudflared) {
  $Cloudflared = $BundledCloudflared
} else {
  $CloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($CloudflaredCommand) {
    $Cloudflared = $CloudflaredCommand.Source
  }
}
if (-not $Cloudflared) {
  Write-Host "cloudflared is not installed."
  Write-Host ""
  Write-Host "Put cloudflared.exe in literature_reader\tools, or install Cloudflare Tunnel, then run this script again."
  Write-Host "After installation, this script will print a public https://*.trycloudflare.com address."
  Write-Host ""
  Write-Host "Keep using run_reader.bat for same-Wi-Fi access."
  pause
  exit 1
}

$SecurePassword = Read-Host "Set a public access password" -AsSecureString
$PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringUni(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
)
if (-not $PlainPassword) {
  Write-Host "Password cannot be empty."
  pause
  exit 1
}

$env:READER_PASSWORD = $PlainPassword

Write-Host ""
Write-Host "Starting protected local reader..."
Write-Host "Local access: http://127.0.0.1:$Port"
Write-Host "Username can be anything. Password is the one you just entered."
Write-Host ""

$Python = (Get-Command python).Source
$Server = Start-Process -FilePath $Python -ArgumentList "-u server.py --host 127.0.0.1 --port $Port" -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru

try {
  Start-Sleep -Seconds 2
  Write-Host "Starting public tunnel..."
  Write-Host "Waiting for the public https://*.trycloudflare.com URL..."
  Write-Host "Press Ctrl+C here to stop the public tunnel."
  Write-Host ""

  $PreviousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Cloudflared tunnel --url "http://127.0.0.1:$Port" 2>&1 | ForEach-Object {
      $Line = "$_"
      Write-Host $Line
      $Match = [regex]::Match($Line, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
      if ($Match.Success) {
        Write-Host ""
        Write-Host "============================================================"
        Write-Host "PUBLIC URL:"
        Write-Host $Match.Value
        Write-Host "============================================================"
        Write-Host "Open this URL on another computer. Username can be anything."
        Write-Host ""
      }
    }
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
} finally {
  if ($Server -and -not $Server.HasExited) {
    Stop-Process -Id $Server.Id -Force
  }
}

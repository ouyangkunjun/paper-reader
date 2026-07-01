$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$Port = 8765
$LocalIps = [System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) |
  Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.IPAddressToString -notlike "127.*" } |
  ForEach-Object { $_.IPAddressToString }

Write-Host ""
Write-Host "Literature reader is starting in LAN mode..."
Write-Host "Local access: http://127.0.0.1:$Port"
foreach ($Ip in $LocalIps) {
  Write-Host "LAN access:   http://$Ip`:$Port"
}
Write-Host ""
Write-Host "Keep this window open while reading."
Write-Host ""

python .\server.py --host 0.0.0.0 --port $Port

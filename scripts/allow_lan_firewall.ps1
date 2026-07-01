$ErrorActionPreference = "Stop"

$Port = 8765
$RuleName = "Literature Reader LAN 8765"

$existing = netsh advfirewall firewall show rule name="$RuleName" | Select-String -SimpleMatch $RuleName
if ($existing) {
  Write-Host "Firewall rule already exists: $RuleName"
} else {
  $output = netsh advfirewall firewall add rule name="$RuleName" dir=in action=allow protocol=TCP localport=$Port profile=private 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host $output
    Write-Host ""
    Write-Host "Firewall rule was not added. Please run this script as Administrator."
    exit $LASTEXITCODE
  }
  Write-Host $output
  Write-Host "Firewall rule added for TCP port $Port on private networks."
}

Write-Host ""
Write-Host "If another computer is on the same Wi-Fi/LAN, open:"
Write-Host "http://<this-computer-ip>:$Port"

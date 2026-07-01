$ErrorActionPreference = "Stop"
$ReaderDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ReaderDir
python .\server.py --scan-only

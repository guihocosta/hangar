# Hangar no Windows: abre o hub (sobe o servidor se precisar) ou roda um job.
#   hangar                 abre no navegador
#   hangar --no-open       só sobe o servidor
#   hangar noite|ajustes   abre direto nessa aba
#   hangar pauta           gera a pauta do dia no vault (a tarefa agendada chama isto)
#   hangar ideias "foco"   gera sugestões de caminhos para o foco
#   hangar timer           agenda a pauta diária no Agendador de Tarefas (horário dos Ajustes)
#   hangar inicio          sobe o servidor sozinho quando você entra no Windows
#   hangar parar           derruba o servidor
param([string]$Cmd = "", [string]$Arg = "")
$ErrorActionPreference = "Stop"
$Dir = $PSScriptRoot
$Py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $Py) { $Py = (Get-Command py -ErrorAction Stop).Source }
$env:PYTHONUTF8 = "1"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Invoke-Hub([string]$Code, [string[]]$Rest = @()) {
  & $Py -c "import sys; sys.path.insert(0, sys.argv[1]); $Code" $Dir @Rest
}

$Port = Invoke-Hub "from hub import paths; print(paths.port())"
$Url = "http://127.0.0.1:$Port/"

function Test-Up {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $Url | Out-Null; $true } catch { $false }
}

switch ($Cmd) {
  "pauta" { Invoke-Hub "from hub import claude; print(claude.gerar_pauta())"; exit $LASTEXITCODE }
  "ideias" { Invoke-Hub "from hub import claude; print(claude.gerar_ideias(sys.argv[2]), 'ideias novas')" @($Arg); exit $LASTEXITCODE }
  "timer" {
    $At = Invoke-Hub "from hub import config; print(config.get()['claude']['horario_pauta'])"
    $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Dir\hangar.ps1`" pauta"
    $trg = New-ScheduledTaskTrigger -Daily -At $At
    $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName "Hangar - pauta do dia" -Action $act -Trigger $trg -Settings $set -Force | Out-Null
    "Tarefa agendada: pauta todo dia às $At (roda depois se o PC estiver desligado na hora)."
    exit 0
  }
  "inicio" {
    $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Dir\hangar.ps1`" --no-open"
    $trg = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName "Hangar - servidor" -Action $act -Trigger $trg -Settings $set -Force | Out-Null
    "O servidor do Hangar vai subir sozinho quando você entrar no Windows."
    exit 0
  }
  "parar" {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; "Hangar parado." } else { "O Hangar não estava rodando." }
    exit 0
  }
}

if (-not (Test-Up)) {
  $Log = Invoke-Hub "from hub import paths; paths.LOG_DIR.mkdir(parents=True, exist_ok=True); print(paths.LOG_DIR)"
  Start-Process -FilePath $Py -ArgumentList "`"$Dir\server.py`"" -WorkingDirectory $Dir -WindowStyle Hidden `
    -RedirectStandardOutput "$Log\server.out.log" -RedirectStandardError "$Log\server.log"
  for ($i = 0; $i -lt 50 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 100 }
}
switch ($Cmd) {
  "--no-open" { }
  { $_ -in "noite", "ajustes" } { Start-Process "$Url#$Cmd" }
  default { Start-Process $Url }
}
"Hangar em $Url"

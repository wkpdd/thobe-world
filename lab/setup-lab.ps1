# Thobe World + H47 Pay test lab, on a clean Windows (Windows Sandbox, a VM or a
# rented cloud PC). Nothing here touches the shop's real H47 Pay: run it only
# inside the lab machine.
#
# What it does, each step skipped when already done:
# The lab folder is the folder this script is in: E:\h47-lab on your PC, seen
# as C:\h47-lab inside Windows Sandbox (H47Lab.wsb shares it).
#
#   1. Node.js 22 LTS and MinGit, in <lab>\tools (no installer, no admin rights needed for these)
#   2. the thobe-world code in <lab>\thobe-world (branch deploy-cpanel), npm install
#   3. H47 Pay silently in SERVER mode, from the newest H47Pay-*-setup.exe found in <lab>
#   4. the store on http://127.0.0.1:8080 with an empty catalogue, waiting for H47 Pay
#
# The lab folder is on your real PC, so the code, .deploy.env and the store's
# data survive closing the sandbox. H47 Pay's own data (C:\ProgramData\NewStore
# inside the sandbox) does not: the sandbox starts fresh every time.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is 10x slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Lab   = if ($PSScriptRoot) { $PSScriptRoot } else { 'C:\h47-lab' }
$Tools = Join-Path $Lab 'tools'
$Repo  = Join-Path $Lab 'thobe-world'
$Log   = Join-Path $Lab 'setup-lab.log'
New-Item -ItemType Directory -Force -Path $Tools | Out-Null
Start-Transcript -Path $Log -Append | Out-Null

function Step($text) { Write-Host "`n== $text" -ForegroundColor Yellow }

# 1. Node.js 22 LTS (zip) ------------------------------------------------------
$node = Get-ChildItem $Tools -Directory -Filter 'node-v22*-win-x64' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) {
  Step 'Node.js 22 LTS'
  $sums = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt').Content
  $line = ($sums -split "`n") | Where-Object { $_ -match 'node-v22\.[0-9.]+-win-x64\.zip$' } | Select-Object -First 1
  $hash, $file = $line.Trim() -split '\s+'
  $zip = Join-Path $Tools $file
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v22.x/$file" -OutFile $zip
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $hash) { throw "Node.js download is damaged ($file)" }
  Expand-Archive $zip -DestinationPath $Tools -Force
  Remove-Item $zip
  $node = Get-ChildItem $Tools -Directory -Filter 'node-v22*-win-x64' | Select-Object -First 1
}

# MinGit (portable Git) ----------------------------------------------------------
$git = Join-Path $Tools 'mingit\cmd\git.exe'
if (-not (Test-Path $git)) {
  Step 'Git (MinGit)'
  $release = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'h47-lab' }
  $asset = $release.assets | Where-Object { $_.name -match '^MinGit-[0-9.]+-64-bit\.zip$' } | Select-Object -First 1
  $zip = Join-Path $Tools $asset.name
  Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $zip
  # GitHub publishes each file's sha256: refuse a download that does not match it.
  if ($asset.digest -match '^sha256:([0-9a-f]{64})$') {
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $Matches[1]) { Remove-Item $zip; throw "MinGit download is damaged ($($asset.name))" }
  } else { Write-Warning 'GitHub gave no checksum for MinGit: it could not be verified.' }
  Expand-Archive $zip -DestinationPath (Join-Path $Tools 'mingit') -Force
  Remove-Item $zip
}

$env:Path = "$($node.FullName);$(Split-Path $git);$env:Path"
# Keep them on PATH for every new window in this machine.
[Environment]::SetEnvironmentVariable('Path', "$($node.FullName);$(Split-Path $git);" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')
Write-Host "node $(node --version), $(git --version)"

# 2. The code ---------------------------------------------------------------------
if (-not (Test-Path (Join-Path $Repo '.git'))) {
  Step 'thobe-world (branch deploy-cpanel)'
  git clone -b deploy-cpanel https://github.com/wkpdd/thobe-world.git $Repo
} else {
  Step 'thobe-world: pulling the latest'
  git -C $Repo pull --ff-only
}
Push-Location $Repo
npm install --no-audit --no-fund
if (-not (Test-Path '.deploy.env')) {
  @(
    'SITE_URL=https://thobeworld.com'
    'APP_DIR=thobe-world'
    'DEPLOY_METHOD=ftp'
    '# the FTP server: its IP address (from the hosting welcome email) or its name'
    'FTP_HOST='
    'FTP_PORT=21'
    'FTP_USER='
    '# type the FTP password after the = sign, then: npm run deploy:check'
    'FTP_PASSWORD='
    'FTP_SECURE=true'
    '# with an IP in FTP_HOST, deploy:check tells you the line to add here:'
    '# FTP_TLS_SERVERNAME='
  ) | Set-Content -Encoding ascii '.deploy.env'
}
# The lab store's own settings: a fresh random key that H47 Pay will use.
if (-not (Test-Path '.env')) {
  $bytes = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  @("SITE_URL=http://127.0.0.1:8080", "PORT=8080", "NEWSTORE_SYNC_KEY=$key", "APP_SECRET=$secret", "DATA_DIR=$Lab\store-data") | Set-Content -Encoding ascii '.env'
}
$syncKey = ((Get-Content '.env') | Where-Object { $_ -like 'NEWSTORE_SYNC_KEY=*' }) -replace '^NEWSTORE_SYNC_KEY=', ''
Pop-Location

# 3. H47 Pay ------------------------------------------------------------------------
$installed = Test-Path 'C:\ProgramData\NewStore\data'
$setup = Get-ChildItem $Lab -File -Filter 'H47Pay-*-setup.exe' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $installed -and $setup) {
  Step "H47 Pay: $($setup.Name) /S /MODE=SERVER"
  $p = Start-Process -FilePath $setup.FullName -ArgumentList '/S', '/MODE=SERVER' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Write-Warning "H47 Pay setup ended with code $($p.ExitCode): see C:\ProgramData\NewStore\logs" }
} elseif (-not $installed) {
  Write-Warning "No H47Pay-*-setup.exe in $Lab : copy the installer there and run this script again."
}

# 4. The store --------------------------------------------------------------------------
Step 'Thobe World on http://127.0.0.1:8080'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "title Thobe World (lab) && cd /d `"$Repo`" && npm start" -WorkingDirectory $Repo

$guide = @"
The lab is ready.

  Store (empty until H47 Pay syncs):  http://127.0.0.1:8080
  H47 Pay: open it from the Start menu, create the test company,
           then « Mon site web » → Ajouter un site:
             address : http://127.0.0.1:8080
             key     : $syncKey

  Deploy the real site (thobeworld.com) from here:
    1. notepad $Repo\.deploy.env   → type the FTP server IP and the FTP password
    2. in $Repo :  npm run deploy:check   then   npm run deploy
    3. undo:       npm run deploy:rollback

  This summary is saved in $Lab\LAB-README.txt
"@
$guide | Set-Content -Encoding utf8 (Join-Path $Lab 'LAB-README.txt')
Write-Host $guide -ForegroundColor Green
Stop-Transcript | Out-Null
Start-Process 'http://127.0.0.1:8080'

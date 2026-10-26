# MockMirror - install zh-CN natural (neural) TTS voices on Windows
# Must be run as Administrator (right-click "install-voice-admin.bat" -> Run as administrator).
# After install: restart the browser; Xiaoxiao / Yunxi will appear in Device > Voice.

$ErrorActionPreference = 'Continue'
$log = Join-Path $PSScriptRoot 'voice-install.log'
function W($m) { Write-Host $m; $m | Out-File -FilePath $log -Append -Encoding utf8 }

W "=== $(Get-Date) install zh-CN speech voices ==="
$caps = @(
  'Language.Speech~~~zh-CN~0.0.1.0',
  'Language.Basic~~~zh-CN~0.0.1.0',
  'Language.TextToSpeech~~~zh-CN~0.0.1.0',
  'Language.Handwriting~~~zh-CN~0.0.1.0',
  'Language.OCR~~~zh-CN~0.0.1.0'
)
foreach ($c in $caps) {
  try {
    $r = Get-WindowsCapability -Online -Name $c -ErrorAction Stop
    if ($r.State -eq 'Installed') { W "already installed: $c"; continue }
    W "installing: $c ..."
    $out = Add-WindowsCapability -Online -Name $c -ErrorAction Stop
    if ($out.RestartNeeded) { W "done (reboot needed): $c" } else { W "done: $c" }
  } catch { W "skip/failed: $c -> $($_.Exception.Message)" }
}

W "=== finished ==="
W "If Xiaoxiao/Yunxi still missing: Settings > Time and language > Speech > Add voices > Chinese (China), then restart the browser."
Write-Host "Log saved to: $log"
Read-Host "Press Enter to close"

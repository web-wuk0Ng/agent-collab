# 安装中文（中国）自然神经网络语音包 —— 让面试官声音更像真人
# 用法：右键「以管理员身份运行」，或在管理员 PowerShell 里执行
# 安装完成后：重启浏览器 → 打开面镜 → 设备面板里会出现 Xiaoxiao/Yunxi 等自然音色
$ErrorActionPreference = 'Continue'
$log = Join-Path $PSScriptRoot 'voice-install.log'
function W($m) { $m | Tee-Object -FilePath $log -Append }

W "=== $(Get-Date) 开始安装中文语音包 ==="
$caps = @(
  'Language.Speech~~~zh-CN~0.0.1.0',
  'Language.Basic~~~zh-CN~0.0.1.0',
  'Language.Handwriting~~~zh-CN~0.0.1.0',
  'Language.TextToSpeech~~~zh-CN~0.0.1.0',
  'Language.OCR~~~zh-CN~0.0.1.0'
)
foreach ($c in $caps) {
  try {
    $r = Get-WindowsCapability -Online -Name $c -ErrorAction Stop
    if ($r.State -eq 'Installed') { W "已安装，跳过: $c"; continue }
    W "安装中: $c ..."
    $out = Add-WindowsCapability -Online -Name $c -ErrorAction Stop
    if ($out.RestartNeeded) { W "完成（需重启系统）: $c" } else { W "完成: $c" }
  } catch { W "失败/不适用: $c -> $($_.Exception.Message)" }
}

# Windows 11 22H2+ 的自然语音还会随系统更新下发，这里尝试触发一次"语音"设置页
W "=== 完成 ==="
W "若列表仍无 Xiaoxiao/Yunxi：请打开 设置 → 时间和语言 → 语音 → 添加语音 → 中文(中国)，下载后重启浏览器。"
Write-Host "日志: $log"
Read-Host "按回车关闭"

// Ícone na bandeja do Windows (área de notificação / "ícones ocultos").
//
// O bluemine.exe é marcado como GUI (build_exe_sea.ps1, passo 8): não abre janela
// de console, então, sem isto, a única forma de encerrar o servidor era matar o
// processo pelo Gerenciador de Tarefas. O ícone dá "Abrir Bluemine", "Ver logs do
// servidor" (janela que segue o bluemine.log em tempo real) e "Sair".
//
// Como não dá para criar um NotifyIcon a partir do Node puro (é API do Win32/.NET,
// e o SEA não carrega módulo nativo — mesma restrição do keyboardBridge), a bandeja
// roda num powershell.exe oculto com WinForms, exatamente como o watchdog do
// auto-update (services/updater.js). A conversa de volta é por HTTP no loopback,
// autenticada por um token efêmero gerado a cada boot e passado só para esse
// processo filho — as rotas /api/tray/* ficam ANTES do authMiddleware (a bandeja
// não tem sessão), então o token é o que as protege.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const log = require('../lib/logger');
const { DATA_DIR } = require('../lib/runtime');
const { openAppWindow } = require('../lib/launcher');

let pkgVersion = '0.0.0';
try {
  pkgVersion = require('../../package.json').version || pkgVersion;
} catch {
  /* empacotado: package.json pode não estar acessível */
}

// Token de uso único deste boot. Vive só em memória: reiniciou, muda. Vai para a
// bandeja pelo AMBIENTE do processo filho, não pela linha de comando — command
// line é listável por qualquer processo da máquina (Win32_Process), ambiente não.
// BLUEMINE_TRAY_TOKEN fixo é hook de teste de integração (mesma ideia de
// BLUEMINE_DATA_DIR em lib/runtime.js); não use em produção.
const TOKEN = process.env.BLUEMINE_TRAY_TOKEN || crypto.randomBytes(24).toString('hex');

// Marcador do aviso ("estou aqui na bandeja") — mostrado uma vez por máquina,
// senão vira um balão a cada abertura do app.
const HINT_MARKER = path.join(DATA_DIR, '.bluemine-tray-hint');

const state = { url: null, host: null, child: null };

function isLoopbackHost(host) {
  return !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

// Confere o token da bandeja e exige origem loopback. Usado pelas rotas /api/tray/*.
function isTrayRequest(req) {
  const sent = req.get('x-bluemine-tray') || '';
  const expected = TOKEN;
  if (sent.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) return false;
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Abre a janela do app (mesma lógica do boot: Edge em app mode → navegador padrão).
function openWindow() {
  if (!state.url) return;
  openAppWindow(state.url, { host: state.host });
}

// Script WinForms da bandeja. Recebe tudo por parâmetro (o token, por ambiente)
// para não gravar nada sensível no arquivo — o .ps1 fica ao lado do .exe.
//
// Cuidados que já custaram caro:
//  • o parâmetro do PID NÃO pode se chamar $pid — é variável automática do
//    PowerShell (o PID do próprio powershell) e a bandeja se mataria sozinha;
//  • NotifyIcon.Text tem limite de 63 caracteres — estourar lança exceção;
//  • WinForms exige thread STA (daí o -Sta na linha de comando);
//  • o Timer é o que faz o ícone sumir se o servidor morrer por fora (crash,
//    auto-update, Gerenciador de Tarefas) — sem ele fica ícone fantasma.
function buildTrayScript() {
  return `param(
  [int]$ServerPid,
  [string]$Url,
  [string]$LogFile = '',
  [string]$Version = '',
  [int]$Hint = 0
)
$ErrorActionPreference = 'SilentlyContinue'
$Token = $env:BLUEMINE_TRAY_TOKEN
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Usa o ícone do próprio bluemine.exe (gravado no build); se falhar, ícone padrão.
$icon = $null
try {
  $exe = (Get-Process -Id $ServerPid).Path
  if ($exe) { $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe) }
} catch { }
if (-not $icon) { $icon = [System.Drawing.SystemIcons]::Application }

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Text = 'Bluemine - ' + $Url
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$header = $menu.Items.Add('Bluemine ' + $Version)
$header.Enabled = $false
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$open = $menu.Items.Add('Abrir Bluemine')
$open.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)
$logs = $menu.Items.Add('Ver logs do servidor')
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$quit = $menu.Items.Add('Sair (encerra o servidor)')
$notify.ContextMenuStrip = $menu

$ctx = New-Object System.Windows.Forms.ApplicationContext
$timer = New-Object System.Windows.Forms.Timer

function Invoke-Tray([string]$Route) {
  try {
    $headers = @{ 'X-Bluemine-Tray' = $Token }
    Invoke-RestMethod -Uri ($Url + '/api/tray/' + $Route) -Method Post -TimeoutSec 5 -Headers $headers | Out-Null
    return $true
  } catch { return $false }
}

function Close-Tray {
  $timer.Stop()
  if ($script:logForm) { $script:logForm.Close() }
  $notify.Visible = $false
  $notify.Dispose()
  $ctx.ExitThread()
}

# ── Janela de logs ──────────────────────────────────────────────────────────
# Segue o bluemine.log em tempo real (estilo tail -f). Só lê o que foi acrescentado
# desde a última leitura, e só enquanto a janela está aberta — fechada, não custa
# nada. Toda a formatação é feita aqui porque o arquivo é JSON por linha, ilegível
# a olho nu.
$script:logForm = $null
$script:logBox = $null
$script:logPos = 0
$script:logRest = ''
$script:logSkipFirst = $false
$script:logFollow = $true
$script:logFilter = ''
$script:logLines = New-Object System.Collections.ArrayList
$script:logDec = [System.Text.Encoding]::UTF8.GetDecoder()
$LOG_MAX_LINES = 3000

function Get-LevelColor([string]$Level) {
  switch ($Level) {
    'error' { return [System.Drawing.Color]::FromArgb(244, 135, 113) }
    'warn'  { return [System.Drawing.Color]::FromArgb(229, 192, 123) }
    'debug' { return [System.Drawing.Color]::FromArgb(133, 140, 150) }
    default { return [System.Drawing.Color]::FromArgb(220, 220, 220) }
  }
}

# '{"t":"...","level":"info","msg":"x","a":1}' -> '14:31:02  INFO   x  a=1'
function Format-LogLine([string]$Raw) {
  # Tira CR e, no começo, um BOM: se o arquivo foi recriado por fora (rotação
  # manual, editor), o BOM grudaria no '{' e a linha viraria texto cru.
  $line = $Raw.Trim([char]13, [char]65279)
  if ([string]::IsNullOrWhiteSpace($line)) { return $null }
  $level = 'info'
  $text = $line
  if ($line.StartsWith('{')) {
    try {
      $o = $line | ConvertFrom-Json
      if ($o.level) { $level = ([string]$o.level).ToLower() }
      $ts = ''
      if ($o.t) {
        try { $ts = ([datetime]$o.t).ToLocalTime().ToString('HH:mm:ss') } catch { $ts = [string]$o.t }
      }
      $extra = @()
      foreach ($p in $o.PSObject.Properties) {
        if ('t', 'level', 'msg' -contains $p.Name) { continue }
        $v = $p.Value
        if ($null -ne $v -and $v -isnot [string] -and $v -isnot [valuetype]) {
          $v = ($v | ConvertTo-Json -Compress -Depth 4)
        }
        $extra += ('{0}={1}' -f $p.Name, $v)
      }
      $text = ('{0}  {1,-5}  {2}' -f $ts, $level.ToUpper(), $o.msg)
      if ($extra.Count -gt 0) { $text = $text + '  ' + ($extra -join ' ') }
    } catch {
      # linha truncada ou não-JSON: mostra crua, é melhor que esconder
    }
  }
  return New-Object psobject -Property @{ Text = $text; Level = $level }
}

# Lê o que entrou no arquivo desde a última chamada.
# FileShare ReadWrite+Delete é obrigatório: sem o Delete, o rename da rotação do
# logger (bluemine.log -> .1) falharia enquanto esta janela estivesse aberta.
function Read-LogChunk {
  $entries = @()
  if (-not $LogFile -or -not (Test-Path -LiteralPath $LogFile)) { return $entries }
  try {
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $fs = New-Object System.IO.FileStream($LogFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
      # Encolheu = rotacionou: recomeça do zero em vez de ficar cego.
      if ($fs.Length -lt $script:logPos) { $script:logPos = 0; $script:logRest = '' }
      $fs.Position = $script:logPos
      $len = [int][Math]::Min(1048576, $fs.Length - $script:logPos)
      if ($len -le 0) { return $entries }
      $buf = New-Object byte[] $len
      $read = $fs.Read($buf, 0, $len)
      $script:logPos = $script:logPos + $read
      # Decoder persistente: o flush do servidor pode cair no meio de um caractere
      # multibyte, e ele guarda os bytes soltos para a próxima leitura (acentos).
      $chars = New-Object char[] $read
      $n = $script:logDec.GetChars($buf, 0, $read, $chars, 0)
      $text = $script:logRest + [string]::new($chars, 0, $n)
    } finally {
      $fs.Dispose()
    }
    $parts = $text -split "\`n"
    # A última fatia é a linha ainda incompleta: guarda para a próxima passada.
    $script:logRest = $parts[$parts.Count - 1]
    for ($i = 0; $i -lt $parts.Count - 1; $i++) {
      if ($script:logSkipFirst) { $script:logSkipFirst = $false; continue }
      $e = Format-LogLine $parts[$i]
      if ($e) { $entries += $e }
    }
  } catch {
    # arquivo sumiu no meio da rotação: a próxima passada pega
  }
  return $entries
}

# Rola até o fim. Como toda linha entra com quebra no final, o cursor para na
# coluna 0 de uma linha vazia — a rolagem horizontal não é arrastada junto e o
# horário continua à vista. (Tentar ser esperto aqui com
# GetFirstCharIndexFromLine faz o ScrollToCaret parar dezenas de linhas antes.)
function Set-LogScrollEnd {
  $box = $script:logBox
  if (-not $box) { return }
  $box.SelectionStart = $box.TextLength
  $box.SelectionLength = 0
  $box.ScrollToCaret()
}

function Add-LogEntries($Entries) {
  if (-not $script:logBox -or $Entries.Count -eq 0) { return }
  $box = $script:logBox
  foreach ($e in $Entries) {
    [void]$script:logLines.Add($e)
    if ($script:logFilter -and ($e.Text -notlike ('*' + $script:logFilter + '*'))) { continue }
    $box.SelectionStart = $box.TextLength
    $box.SelectionLength = 0
    $box.SelectionColor = (Get-LevelColor $e.Level)
    $box.AppendText($e.Text + [Environment]::NewLine)
  }
  if ($script:logLines.Count -gt $LOG_MAX_LINES) {
    $script:logLines.RemoveRange(0, $script:logLines.Count - $LOG_MAX_LINES)
  }
  if ($script:logFollow) { Set-LogScrollEnd }
}

# Redesenha tudo a partir do buffer (usado quando o filtro muda).
function Update-LogView {
  if (-not $script:logBox) { return }
  $box = $script:logBox
  $box.Clear()
  foreach ($e in $script:logLines) {
    if ($script:logFilter -and ($e.Text -notlike ('*' + $script:logFilter + '*'))) { continue }
    $box.SelectionStart = $box.TextLength
    $box.SelectionLength = 0
    $box.SelectionColor = (Get-LevelColor $e.Level)
    $box.AppendText($e.Text + [Environment]::NewLine)
  }
  if ($script:logFollow) { Set-LogScrollEnd }
}

function Show-LogWindow {
  # Já aberta: traz para frente em vez de abrir uma segunda.
  if ($script:logForm) {
    if ($script:logForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
      $script:logForm.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    }
    $script:logForm.Activate()
    return
  }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Bluemine - logs do servidor'
  $form.Size = New-Object System.Drawing.Size(960, 560)
  $form.StartPosition = 'CenterScreen'
  $form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
  if ($icon) { $form.Icon = $icon }

  $box = New-Object System.Windows.Forms.RichTextBox
  $box.Dock = 'Fill'
  $box.ReadOnly = $true
  $box.WordWrap = $false
  $box.DetectUrls = $false
  $box.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 24)
  $box.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 220)
  $box.Font = New-Object System.Drawing.Font('Consolas', 9)
  $box.BorderStyle = 'None'
  $box.ScrollBars = 'Both'

  $bar = New-Object System.Windows.Forms.Panel
  $bar.Dock = 'Top'
  $bar.Height = 34
  $bar.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 40)

  $lbl = New-Object System.Windows.Forms.Label
  $lbl.Text = 'Filtro:'
  $lbl.ForeColor = [System.Drawing.Color]::FromArgb(200, 200, 200)
  $lbl.AutoSize = $true
  $lbl.Location = New-Object System.Drawing.Point(8, 9)

  $filter = New-Object System.Windows.Forms.TextBox
  $filter.Location = New-Object System.Drawing.Point(52, 6)
  $filter.Width = 260
  $filter.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 24)
  $filter.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 220)
  $filter.BorderStyle = 'FixedSingle'

  $follow = New-Object System.Windows.Forms.CheckBox
  $follow.Text = 'Acompanhar'
  $follow.Checked = $true
  $follow.AutoSize = $true
  $follow.ForeColor = [System.Drawing.Color]::FromArgb(200, 200, 200)
  $follow.Location = New-Object System.Drawing.Point(324, 8)

  $btnClear = New-Object System.Windows.Forms.Button
  $btnClear.Text = 'Limpar tela'
  $btnClear.Location = New-Object System.Drawing.Point(440, 5)
  $btnClear.Width = 90
  $btnClear.FlatStyle = 'Flat'
  $btnClear.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 220)

  $btnFolder = New-Object System.Windows.Forms.Button
  $btnFolder.Text = 'Abrir pasta'
  $btnFolder.Location = New-Object System.Drawing.Point(536, 5)
  $btnFolder.Width = 90
  $btnFolder.FlatStyle = 'Flat'
  $btnFolder.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 220)

  $bar.Controls.AddRange(@($lbl, $filter, $follow, $btnClear, $btnFolder))
  # O Fill entra ANTES do Top: no WinForms o último a entrar é o primeiro a docar,
  # invertendo isso a barra ficaria por cima do texto.
  $form.Controls.Add($box)
  $form.Controls.Add($bar)

  $script:logForm = $form
  $script:logBox = $box
  $script:logFilter = ''
  $script:logFollow = $true
  $script:logLines.Clear()
  $script:logRest = ''
  $script:logDec = [System.Text.Encoding]::UTF8.GetDecoder()

  # Começa nos últimos 64 KB: abrir a janela não pode custar reparsear 2 MB de JSON.
  $script:logPos = 0
  $script:logSkipFirst = $false
  try {
    if ($LogFile -and (Test-Path -LiteralPath $LogFile)) {
      $size = (Get-Item -LiteralPath $LogFile).Length
      if ($size -gt 65536) {
        $script:logPos = $size - 65536
        $script:logSkipFirst = $true # a primeira linha do corte vem pela metade
      }
    }
  } catch { }

  # Redesenho do filtro com atraso: sem isso cada tecla redesenharia 3000 linhas.
  $debounce = New-Object System.Windows.Forms.Timer
  $debounce.Interval = 300
  $debounce.add_Tick({
    $debounce.Stop()
    $script:logFilter = $filter.Text.Trim()
    Update-LogView
  })
  $filter.add_TextChanged({ $debounce.Stop(); $debounce.Start() })

  $follow.add_CheckedChanged({ $script:logFollow = $follow.Checked })
  $btnClear.add_Click({ $script:logLines.Clear(); $script:logBox.Clear() })
  $btnFolder.add_Click({
    try { Start-Process explorer.exe -ArgumentList ('/select,"' + $LogFile + '"') } catch { }
  })

  $tail = New-Object System.Windows.Forms.Timer
  $tail.Interval = 1000
  $tail.add_Tick({ Add-LogEntries (Read-LogChunk) })

  $form.add_FormClosed({
    $tail.Stop()
    $debounce.Stop()
    $script:logForm = $null
    $script:logBox = $null
    $script:logLines.Clear()
  })

  # O primeiro Show() de um processo é ENGOLIDO quando ele nasceu com
  # STARTF_USESHOWWINDOW/SW_HIDE — e é assim que o Node cria a bandeja
  # (windowsHide: true). Resultado: a janela existia, com título e tudo, mas
  # IsWindowVisible=False e o clique no menu não parecia fazer nada. O segundo
  # Show() já não sofre a herança. Depois, TopMost por um instante para subir no
  # Z-order: processo de fundo não ganha foreground, mas ao menos aparece na
  # frente em vez de nascer atrás do editor.
  $form.Show()
  $form.Hide()
  $form.Show()
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
  $form.TopMost = $true
  $form.Activate()
  $form.TopMost = $false
  if (-not $LogFile -or -not (Test-Path -LiteralPath $LogFile)) {
    $box.AppendText('Nenhum arquivo de log encontrado' + [Environment]::NewLine +
      '(LOG_TO_FILE=0 desliga a gravacao em disco).' + [Environment]::NewLine)
  } else {
    Add-LogEntries (Read-LogChunk)
  }
  $tail.Start()
}

$open.add_Click({ [void](Invoke-Tray 'open') })
$notify.add_DoubleClick({ [void](Invoke-Tray 'open') })
$logs.add_Click({ Show-LogWindow })
$quit.add_Click({
  # Se o servidor não responder (travado), encerra na marra para o usuário não
  # ficar com um processo invisível preso.
  if (-not (Invoke-Tray 'quit')) { Stop-Process -Id $ServerPid -Force }
  Close-Tray
})

# Servidor morreu por fora? Some da bandeja em vez de virar ícone fantasma.
$timer.Interval = 2000
$timer.add_Tick({
  if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) { Close-Tray }
})
$timer.Start()

if ($Hint -eq 1) {
  $notify.BalloonTipTitle = 'Bluemine está rodando'
  $notify.BalloonTipText = 'O servidor fica neste ícone (veja em "ícones ocultos"). Clique com o botão direito para sair.'
  $notify.ShowBalloonTip(8000)
}

[System.Windows.Forms.Application]::Run($ctx)
`;
}

// Sobe a bandeja. Best-effort: sem PowerShell, ou fora do Windows, é no-op.
// BLUEMINE_NO_TRAY=1 desliga; HOST não-loopback (modo "servidor central") também,
// pois nesse cenário ninguém está na máquina para ver o ícone.
function startTray({ url, host } = {}) {
  state.url = url;
  state.host = host;
  if (process.env.BLUEMINE_NO_TRAY === '1') return;
  if (process.platform !== 'win32') return;
  if (!isLoopbackHost(host)) return;
  if (state.child) return;

  try {
    const scriptPath = path.join(DATA_DIR, 'bluemine-tray.ps1');
    // BOM: sem ele o Windows PowerShell 5.1 lê o .ps1 como ANSI e os acentos do
    // menu ("Sair", "está") viram lixo.
    fs.writeFileSync(scriptPath, '﻿' + buildTrayScript(), 'utf8');

    let hint = 0;
    try {
      if (!fs.existsSync(HINT_MARKER)) {
        fs.writeFileSync(HINT_MARKER, new Date().toISOString());
        hint = 1;
      }
    } catch {
      /* sem marcador: só não mostra o balão */
    }

    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Sta',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-ServerPid',
        String(process.pid),
        '-Url',
        url,
        '-LogFile',
        log.LOG_FILE,
        '-Version',
        `v${pkgVersion}`,
        '-Hint',
        String(hint),
      ],
      {
        // NADA de `detached: true` aqui (ao contrário do keyboardBridge/launcher):
        // no Windows isso vira DETACHED_PROCESS, o powershell.exe fica SEM console
        // e o ConsoleHost morre na hora — sai com código 0, sem erro nenhum, e o
        // ícone nunca aparece. Medido: com detached o processo dura <1s; sem ele,
        // fica de pé. `windowsHide` já é o suficiente para não piscar janela.
        // O filho sobrevive ao pai mesmo assim (o timer da bandeja é quem o encerra).
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, BLUEMINE_TRAY_TOKEN: TOKEN },
      },
    );
    child.on('error', (err) => {
      state.child = null;
      log.warn('tray_spawn_failed', { error: err.message });
    });
    child.on('exit', () => {
      state.child = null;
    });
    child.unref();
    state.child = child;
    log.info('tray_started', { pid: child.pid });
  } catch (err) {
    log.warn('tray_spawn_failed', { error: err.message });
  }
}

// No encerramento NÃO matamos o powershell: o Timer da bandeja percebe a morte do
// servidor em até 2s e remove o ícone sozinho. Matar à força deixaria o ícone
// fantasma na barra até o usuário passar o mouse por cima.
function stopTray() {
  state.child = null;
}

module.exports = { startTray, stopTray, isTrayRequest, openWindow, buildTrayScript, TOKEN };

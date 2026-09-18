import { describe, it, expect } from 'vitest';
import tray from './tray.js';

const { isTrayRequest, buildTrayScript, TOKEN } = tray;

// Simula o mínimo de um req do Express usado por isTrayRequest.
function fakeReq({ token, ip = '127.0.0.1' } = {}) {
  return {
    get: (name) => (name.toLowerCase() === 'x-bluemine-tray' ? token : undefined),
    socket: { remoteAddress: ip },
  };
}

describe('isTrayRequest', () => {
  it('aceita o token deste boot vindo do loopback', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isTrayRequest(fakeReq({ token: TOKEN, ip })), ip).toBe(true);
    }
  });

  it('recusa token ausente, errado ou de tamanho diferente', () => {
    expect(isTrayRequest(fakeReq({ token: undefined }))).toBe(false);
    expect(isTrayRequest(fakeReq({ token: '' }))).toBe(false);
    expect(isTrayRequest(fakeReq({ token: 'a'.repeat(TOKEN.length) }))).toBe(false);
    expect(isTrayRequest(fakeReq({ token: TOKEN.slice(0, -1) }))).toBe(false);
  });

  it('recusa origem fora do loopback mesmo com token válido', () => {
    for (const ip of ['192.168.0.10', '10.1.2.3', '']) {
      expect(isTrayRequest(fakeReq({ token: TOKEN, ip })), ip).toBe(false);
    }
  });
});

describe('buildTrayScript', () => {
  const script = buildTrayScript();

  it('não usa $pid como parâmetro (é automática do PowerShell)', () => {
    expect(script).toContain('[int]$ServerPid');
    expect(script).not.toMatch(/\[int\]\$pid\b/i);
  });

  it('não embute o token no arquivo nem na linha de comando — vem do ambiente', () => {
    expect(script).not.toContain(TOKEN);
    expect(script).toContain('$Token = $env:BLUEMINE_TRAY_TOKEN');
  });

  it('remove o ícone quando o servidor morre por fora', () => {
    expect(script).toContain('Get-Process -Id $ServerPid -ErrorAction SilentlyContinue');
    expect(script).toContain('$notify.Visible = $false');
  });

  it('encerra pelo endpoint e só mata o processo se ele não responder', () => {
    expect(script).toContain("Invoke-Tray 'quit'");
    expect(script).toContain(
      "if (-not (Invoke-Tray 'quit')) { Stop-Process -Id $ServerPid -Force }",
    );
  });
});

describe('buildTrayScript — janela de logs', () => {
  const script = buildTrayScript();

  it('tem o item de menu e recebe o caminho do log por parâmetro', () => {
    expect(script).toContain("$logs = $menu.Items.Add('Ver logs do servidor')");
    expect(script).toContain('$logs.add_Click({ Show-LogWindow })');
    expect(script).toContain('[string]$LogFile');
  });

  it('abre o arquivo sem travar a rotação do logger', () => {
    // Sem FileShare.Delete, o rename bluemine.log -> .1 falha enquanto a janela
    // estiver aberta e o servidor para de rotacionar.
    expect(script).toContain(
      '$share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete',
    );
  });

  it('recomeça do zero quando o arquivo encolhe (rotacionou)', () => {
    expect(script).toContain('if ($fs.Length -lt $script:logPos) { $script:logPos = 0');
  });

  it('abre lendo só os últimos 64 KB, descartando a primeira linha cortada', () => {
    expect(script).toContain('$script:logPos = $size - 65536');
    expect(script).toContain('$script:logSkipFirst = $true');
  });

  it('mostra a janela duas vezes — a primeira o Windows engole', () => {
    // A bandeja nasce com STARTF_USESHOWWINDOW/SW_HIDE (spawn windowsHide), e o
    // Windows aplica isso ao PRIMEIRO ShowWindow do processo: com um Show() só, a
    // janela existe mas fica invisível e o clique no menu não faz nada.
    expect(script).toMatch(/\$form\.Show\(\)\s*\n\s*\$form\.Hide\(\)\s*\n\s*\$form\.Show\(\)/);
  });

  it('só segue o arquivo enquanto a janela está aberta', () => {
    expect(script).toContain('$tail.add_Tick({ Add-LogEntries (Read-LogChunk) })');
    expect(script).toContain('$tail.Stop()');
  });
});

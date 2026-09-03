import { describe, it, expect } from 'vitest';
import { buildMonitorSizeQuery, WMI_NAMESPACE } from './displayGeometry';

// -----------------------------------------------------------------------------
// B2.11 — Leitura de EDID no Electron nunca funcionou: `'root\wmi'` colapsa
//         para `rootwmi`.
//
//   'Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams | ' +
//
// Em string literal JavaScript, `\w` **não é um escape reconhecido** — a barra
// é descartada e o comando chega ao PowerShell como `-Namespace rootwmi`. O
// namespace não existe, o PowerShell erra sempre, `err` é não-nulo e o handler
// faz `resolve([])`.
//
// O comentário do módulo chama isso de "falha em silêncio de propósito: fora do
// Windows, com EDID ausente ou driver genérico, devolve lista vazia". Mas o que
// estava sendo mascarado não era ausência de EDID — era um **bug de escape**.
//
// Consequência em cadeia:
//   • `screenGeometrySource` NUNCA sai de `'default'`
//   • `screenDiagonalIn` fica travado em 23,6″
//   • esse número entra no erro angular do relatório (B2.10) e no orçamento de
//     excentricidade que posiciona os alvos de calibração
//
// **O recurso que o README destaca como diferencial — "a diagonal do monitor
// vem do EDID, não de digitação" — nunca funcionou uma única vez.**
//
// O teste mora aqui, no núcleo, e não em `electron/`, porque o CI roda
// `windows-latest` mas não abre o Electron: o que dá para verificar
// deterministicamente é a STRING gerada.
// -----------------------------------------------------------------------------

describe('B2.11 — o namespace WMI sobrevive ao literal JavaScript', () => {
  it('WMI_NAMESPACE contém a barra invertida', () => {
    // O teste mais direto possível. `'root\wmi'.length === 7` (o `\w` virou
    // `w`); `'root\\wmi'.length === 8`.
    expect(WMI_NAMESPACE).toBe('root\\wmi');
    expect(WMI_NAMESPACE).toHaveLength(8);
  });

  it('o namespace NÃO colapsou para "rootwmi"', () => {
    // A assertiva que descreve o bug pelo nome. Se alguém reescrever a
    // constante com aspas simples e uma barra só, ela falha.
    expect(WMI_NAMESPACE).not.toBe('rootwmi');
    expect(WMI_NAMESPACE).toContain('\\');
  });

  it('o comando gerado pede o namespace certo', () => {
    const cmd = buildMonitorSizeQuery();
    expect(cmd).toContain('-Namespace root\\wmi');
    expect(cmd).not.toContain('rootwmi');
  });
});

describe('B2.11 — o comando pede exatamente o que o consumidor espera', () => {
  it('consulta a classe WmiMonitorBasicDisplayParams', () => {
    expect(buildMonitorSizeQuery()).toContain('WmiMonitorBasicDisplayParams');
  });

  it('seleciona as duas dimensões, em centímetros', () => {
    // `MaxHorizontalImageSize`/`MaxVerticalImageSize` vêm em CENTÍMETROS no
    // EDID. O consumidor (`readMonitorSizes`) assume isso ao montar
    // `{widthCm, heightCm}` — se a projeção mudar, a unidade muda em silêncio.
    const cmd = buildMonitorSizeQuery();
    expect(cmd).toContain('MaxHorizontalImageSize');
    expect(cmd).toContain('MaxVerticalImageSize');
  });

  it('pede JSON compacto, que é o que o parser espera', () => {
    const cmd = buildMonitorSizeQuery();
    expect(cmd).toContain('ConvertTo-Json');
    expect(cmd).toContain('-Compress');
  });

  it('o comando é uma linha só, sem quebras que o -Command rejeite', () => {
    expect(buildMonitorSizeQuery()).not.toContain('\n');
  });
});

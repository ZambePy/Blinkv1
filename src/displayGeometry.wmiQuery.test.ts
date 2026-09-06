import { describe, it, expect } from 'vitest';
import { buildMonitorSizeQuery, WMI_NAMESPACE } from './displayGeometry';

// Consulta WMI de EDID gerada para o PowerShell. Em string literal JavaScript
// `\w` não é um escape reconhecido: `'root\wmi'` vira `rootwmi`, o namespace
// não existe e a leitura falha sempre em silêncio (diagonal travada em 23,6″).
// O teste vive no núcleo porque o CI não abre o Electron: verifica-se a STRING.

describe('o namespace WMI sobrevive ao literal JavaScript', () => {
  it('WMI_NAMESPACE contém a barra invertida', () => {
    // `'root\wmi'.length === 7` (o `\w` virou `w`); `'root\\wmi'.length === 8`.
    expect(WMI_NAMESPACE).toBe('root\\wmi');
    expect(WMI_NAMESPACE).toHaveLength(8);
  });

  it('o namespace não colapsou para "rootwmi"', () => {
    // Se alguém reescrever a constante com aspas simples e uma barra só, falha.
    expect(WMI_NAMESPACE).not.toBe('rootwmi');
    expect(WMI_NAMESPACE).toContain('\\');
  });

  it('o comando gerado pede o namespace certo', () => {
    const cmd = buildMonitorSizeQuery();
    expect(cmd).toContain('-Namespace root\\wmi');
    expect(cmd).not.toContain('rootwmi');
  });
});

describe('o comando pede exatamente o que o consumidor espera', () => {
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

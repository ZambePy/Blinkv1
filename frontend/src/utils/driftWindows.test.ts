import { describe, it, expect } from 'vitest';
// @ts-expect-error — arquivo .mjs sem tipos; import ESM funciona no Node/Vitest
import { parseDriftWindows, buildDriftCurveVariants, DEFAULT_DRIFT_WINDOWS_MIN } from '../../scripts/driftWindows.mjs';

// D7.3 (ROADMAP §5) — testes garantem que o parser da curva de drift
// aceita o formato documentado e rejeita entradas malformadas. Sem estes
// testes, o smoke da CLI só falharia quando alguém regravar a fixture de
// 40min (pendência humana), o que torna o feedback loop longo demais.

describe('parseDriftWindows (D7.3)', () => {
  it('sem argumento (raw=undefined) usa o preset 0-5,20-25,40-45', () => {
    const windows = parseDriftWindows(undefined);
    expect(windows).toEqual([
      { startMin: 0, endMin: 5 },
      { startMin: 20, endMin: 25 },
      { startMin: 40, endMin: 45 },
    ]);
  });

  it('DEFAULT_DRIFT_WINDOWS_MIN é o mesmo string documentado no help', () => {
    expect(DEFAULT_DRIFT_WINDOWS_MIN).toBe('0-5,20-25,40-45');
  });

  it('parseia entrada custom com uma janela', () => {
    expect(parseDriftWindows('10-15')).toEqual([{ startMin: 10, endMin: 15 }]);
  });

  it('parseia entrada custom com múltiplas janelas', () => {
    expect(parseDriftWindows('0-5,30-35')).toEqual([
      { startMin: 0, endMin: 5 },
      { startMin: 30, endMin: 35 },
    ]);
  });

  it('lança erro em segmento sem hífen', () => {
    expect(() => parseDriftWindows('30')).toThrow(/Segmento inválido/);
  });

  it('lança erro em start >= end (janela vazia ou invertida)', () => {
    expect(() => parseDriftWindows('30-30')).toThrow(/Segmento inválido/);
    expect(() => parseDriftWindows('40-20')).toThrow(/Segmento inválido/);
  });

  it('lança erro em start negativo', () => {
    expect(() => parseDriftWindows('-5-10')).toThrow();
  });

  it('lança erro em números não-finitos', () => {
    expect(() => parseDriftWindows('abc-def')).toThrow(/Segmento inválido/);
  });

  it('ignora chunks vazios (vírgula à toa) mas mantém os válidos', () => {
    expect(parseDriftWindows('0-5,,20-25')).toEqual([
      { startMin: 0, endMin: 5 },
      { startMin: 20, endMin: 25 },
    ]);
  });

  it('lança erro se input for só vírgulas (nenhuma janela válida)', () => {
    expect(() => parseDriftWindows(',,,')).toThrow(/não produziu janela/);
  });
});

describe('buildDriftCurveVariants (D7.3)', () => {
  it('constrói variantes com timeWindow em SEGUNDOS (min × 60)', () => {
    const variants = buildDriftCurveVariants('0-5,20-25');
    expect(variants).toHaveLength(2);
    expect(variants[0].timeWindow).toBe('0,300');
    expect(variants[1].timeWindow).toBe('1200,1500');
  });

  it('cada variante usa filter=balanceado-v2 (baseline canônico do replay v2)', () => {
    const variants = buildDriftCurveVariants('0-5');
    expect(variants[0].filter).toBe('balanceado-v2');
    expect(variants[0].recomputeFeatures).toBe(false);
  });

  it('nome da variante mostra o intervalo em minutos (comparável na tabela)', () => {
    const variants = buildDriftCurveVariants('20-25');
    expect(variants[0].name).toContain('20-25 min');
  });
});

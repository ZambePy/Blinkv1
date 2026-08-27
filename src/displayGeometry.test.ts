import { describe, it, expect } from 'vitest';
import {
  computeDisplayGeometry,
  pickPrimaryPanel,
  parseWmiMonitorSizes,
  pickPanelForDisplay,
} from './displayGeometry';

describe('computeDisplayGeometry', () => {
  it('recupera a diagonal do monitor de referência (23,6")', () => {
    // 23,6" 16:9 → 52,25 × 29,39 cm. O EDID reporta em cm inteiros.
    const g = computeDisplayGeometry({ widthCm: 52, heightCm: 29 })!;
    expect(g.diagonalIn).toBeCloseTo(23.4, 1);
    expect(g.aspectRatio).toBeCloseTo(16 / 9, 1);
  });

  it('recupera a diagonal de um notebook 15,6"', () => {
    const g = computeDisplayGeometry({ widthCm: 34, heightCm: 19 })!;
    expect(g.diagonalIn).toBeCloseTo(15.3, 1);
  });

  it('devolve null em vez de número errado quando o EDID vem zerado', () => {
    // Caso real e comum. Propagar 0 aqui faria o orçamento de excentricidade
    // dividir por zero e a grade de calibração ir para o infinito.
    expect(computeDisplayGeometry({ widthCm: 0, heightCm: 0 })).toBeNull();
  });

  it('rejeita EDID truncado (dimensão implausivelmente pequena)', () => {
    expect(computeDisplayGeometry({ widthCm: 5, heightCm: 3 })).toBeNull();
  });

  it('rejeita proporção impossível', () => {
    // 52 × 8 cm daria 6,5:1 — não existe monitor assim; é lixo de EDID.
    expect(computeDisplayGeometry({ widthCm: 52, heightCm: 8 })).toBeNull();
  });

  it('rejeita valores não finitos', () => {
    expect(computeDisplayGeometry({ widthCm: NaN, heightCm: 29 })).toBeNull();
    expect(computeDisplayGeometry({ widthCm: 52, heightCm: Infinity })).toBeNull();
  });

  it('aceita ultrawide 21:9', () => {
    expect(computeDisplayGeometry({ widthCm: 80, heightCm: 34 })).not.toBeNull();
  });

  it('null/undefined não explodem', () => {
    expect(computeDisplayGeometry(null)).toBeNull();
    expect(computeDisplayGeometry(undefined)).toBeNull();
  });
});

describe('pickPrimaryPanel', () => {
  it('escolhe o maior — notebook + monitor externo', () => {
    const p = pickPrimaryPanel([
      { widthCm: 34, heightCm: 19 },   // notebook 15,6"
      { widthCm: 52, heightCm: 29 },   // externo 23,6"
    ])!;
    expect(p.widthCm).toBe(52);
  });

  it('ignora painéis com EDID inválido', () => {
    const p = pickPrimaryPanel([
      { widthCm: 0, heightCm: 0 },
      { widthCm: 34, heightCm: 19 },
    ])!;
    expect(p.widthCm).toBe(34);
  });

  it('devolve null quando nenhum painel é utilizável', () => {
    expect(pickPrimaryPanel([{ widthCm: 0, heightCm: 0 }])).toBeNull();
    expect(pickPrimaryPanel([])).toBeNull();
  });
});

describe('parseWmiMonitorSizes', () => {
  it('aceita OBJETO quando há um monitor só', () => {
    // ConvertTo-Json do PowerShell não envelopa em array com um item — fonte
    // clássica de bug em quem assume array.
    const r = parseWmiMonitorSizes({ MaxHorizontalImageSize: 52, MaxVerticalImageSize: 29 });
    expect(r).toEqual([{ widthCm: 52, heightCm: 29 }]);
  });

  it('aceita ARRAY quando há vários', () => {
    const r = parseWmiMonitorSizes([
      { MaxHorizontalImageSize: 52, MaxVerticalImageSize: 29 },
      { MaxHorizontalImageSize: 34, MaxVerticalImageSize: 19 },
    ]);
    expect(r).toHaveLength(2);
  });

  it('descarta linhas sem os campos', () => {
    const r = parseWmiMonitorSizes([{ Foo: 1 }, { MaxHorizontalImageSize: 52, MaxVerticalImageSize: 29 }]);
    expect(r).toEqual([{ widthCm: 52, heightCm: 29 }]);
  });

  it('null/undefined viram lista vazia', () => {
    expect(parseWmiMonitorSizes(null)).toEqual([]);
    expect(parseWmiMonitorSizes(undefined)).toEqual([]);
  });
});

describe('pickPanelForDisplay', () => {
  it('painel único é escolhido sem ambiguidade', () => {
    const r = pickPanelForDisplay([{ widthCm: 52, heightCm: 29 }], 16 / 9);
    expect(r.panel!.widthCm).toBe(52);
    expect(r.ambiguous).toBe(false);
  });

  it('desambigua por proporção — 16:10 vs 16:9', () => {
    // Notebook 16:10 e monitor externo 16:9. "O maior" escolheria pelo tamanho;
    // a proporção escolhe pelo display que está de fato ativo.
    const r = pickPanelForDisplay(
      [{ widthCm: 34, heightCm: 21 }, { widthCm: 52, heightCm: 29 }],
      16 / 10,
    );
    expect(r.panel!.widthCm).toBe(34);
    expect(r.ambiguous).toBe(false);
  });

  it('dois monitores de mesma proporção → cai no maior e ADMITE o chute', () => {
    const r = pickPanelForDisplay(
      [{ widthCm: 34, heightCm: 19 }, { widthCm: 52, heightCm: 29 }],
      16 / 9,
    );
    expect(r.panel!.widthCm).toBe(52);
    expect(r.ambiguous).toBe(true);
  });

  it('sem proporção do display, cai no maior e admite o chute', () => {
    const r = pickPanelForDisplay(
      [{ widthCm: 34, heightCm: 19 }, { widthCm: 52, heightCm: 29 }],
      null,
    );
    expect(r.panel!.widthCm).toBe(52);
    expect(r.ambiguous).toBe(true);
  });

  it('ignora painéis com EDID inválido antes de decidir', () => {
    const r = pickPanelForDisplay(
      [{ widthCm: 0, heightCm: 0 }, { widthCm: 52, heightCm: 29 }],
      16 / 9,
    );
    expect(r.panel!.widthCm).toBe(52);
    expect(r.ambiguous).toBe(false);
  });

  it('lista vazia devolve null', () => {
    expect(pickPanelForDisplay([], 16 / 9).panel).toBeNull();
  });
});

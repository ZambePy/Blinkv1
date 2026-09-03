import { describe, it, expect } from 'vitest';
import { buildContextKeyFrom } from './calibration';

// -----------------------------------------------------------------------------
// B2.9 — Perfil validado pela resolução da TELA, mas treinado em pixels do
//        VIEWPORT.
//
//   const sw = window.screen.width;   // resolução do MONITOR
//   const sh = window.screen.height;
//
// A geometria e o `axisScale` do treino, porém, vêm de
// `document.documentElement.clientWidth/Height` — o VIEWPORT. E não existe
// listener de `resize` no projeto.
//
// Cenário real: o Electron abre em 1280×800, o paciente calibra, o cuidador
// MAXIMIZA a janela (ou dá Ctrl+`+`). `screen.width` não mudou → a chave bate
// → o perfil é restaurado e aplicado com escala e offset errados. O cursor cai
// sistematicamente deslocado, SEM virar `degraded` (o `mapGaze` devolve
// valores válidos, só errados) e sem nenhum aviso.
//
// A chave também não codificava:
//   • `polynomialFeatures` (default **true**, muda 6 → 27 dims)
//   • `enableL2CS`
//   • `expandFactor` — o pior dos três: muda os VALORES de `tan yaw`/`tan pitch`
//     mantendo a dimensão. Nenhum `RangeError` é lançado, o perfil carrega
//     normalmente, e prediz com features cujo significado mudou.
// -----------------------------------------------------------------------------

/** Contexto de referência: viewport 1280×800, flags de produção. */
const BASE = {
  viewportW: 1280,
  viewportH: 800,
  featureVectorId: 'irisCore+l2cs:6',
  formatVersion: 3,
  isotropicLandmarks: false,
  applyGazeCorrection: false,
  polynomialFeatures: true,
  enableL2CS: true,
  expandFactor: 1.4,
} as const;

describe('B2.9 — a chave usa o VIEWPORT, não a resolução do monitor', () => {
  it('viewports diferentes produzem chaves diferentes', () => {
    // O cenário do bug: 1280×800 (janela) vs 1920×1080 (maximizada). Antes,
    // ambas produziam a mesma chave porque `screen.width` não muda ao
    // maximizar — e o perfil da janela pequena era aplicado na grande.
    const janela = buildContextKeyFrom({ ...BASE });
    const maximizada = buildContextKeyFrom({ ...BASE, viewportW: 1920, viewportH: 1080 });
    expect(janela).not.toBe(maximizada);
  });

  it('o mesmo viewport produz a mesma chave', () => {
    expect(buildContextKeyFrom({ ...BASE })).toBe(buildContextKeyFrom({ ...BASE }));
  });

  it('mudança só na altura já invalida', () => {
    // Ctrl+`+` (zoom do Chromium) muda ambas as dimensões do viewport; abrir o
    // devtools na lateral muda só a largura. Os dois casos precisam invalidar.
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, viewportH: 760 }));
  });
});

describe('B2.9 — a chave codifica TODAS as flags que mudam o vetor', () => {
  it('polynomialFeatures entra na chave', () => {
    // Default `true`, e muda 6 → 27 dims. Um perfil treinado com a expansão
    // ligada carregado numa sessão sem ela dispara `RangeError` no primeiro
    // frame e o paciente perde a calibração no meio da sessão.
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, polynomialFeatures: false }));
  });

  it('enableL2CS entra na chave', () => {
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, enableL2CS: false }));
  });

  it('expandFactor entra na chave — o pior dos três', () => {
    // `expandFactor` muda os VALORES de tan(yaw)/tan(pitch) mantendo a
    // dimensão. Sem estar na chave, nenhum erro é lançado: o perfil carrega e
    // prediz com features cujo significado mudou. O sintoma é um cursor
    // sistematicamente deslocado, sem nada na UI que explique.
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, expandFactor: 1.6 }));
  });

  it('isotropicLandmarks continua na chave', () => {
    // Regressão: já estava e não pode ter saído.
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, isotropicLandmarks: true }));
  });

  it('applyGazeCorrection continua na chave', () => {
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, applyGazeCorrection: true }));
  });

  it('featureVectorId continua na chave', () => {
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, featureVectorId: 'iris12+l2cs:19' }));
  });

  it('a versão de formato continua na chave', () => {
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, formatVersion: 4 }));
  });
});

describe('B2.9 — nenhuma flag do vetor pode ser esquecida em silêncio', () => {
  it('mudar QUALQUER campo do contexto muda a chave', () => {
    // Varredura: se alguém adicionar um campo ao contexto e esquecer de
    // incluí-lo na chave, este teste falha. É a defesa contra o bug voltar
    // por uma flag nova.
    const referencia = buildContextKeyFrom({ ...BASE });
    const variacoes: Array<Partial<typeof BASE>> = [
      { viewportW: 1281 },
      { viewportH: 801 },
      { featureVectorId: 'outro:9' },
      { formatVersion: 99 },
      { isotropicLandmarks: true },
      { applyGazeCorrection: true },
      { polynomialFeatures: false },
      { enableL2CS: false },
      { expandFactor: 1.5 },
    ];
    for (const v of variacoes) {
      expect(
        buildContextKeyFrom({ ...BASE, ...v }),
        `campo ${Object.keys(v)[0]} não altera a chave`,
      ).not.toBe(referencia);
    }
  });

  it('a chave é uma string estável e legível', () => {
    // Ela vai para o localStorage e aparece em logs de diagnóstico; precisa
    // ser inspecionável por um humano depurando um perfil que não carrega.
    const k = buildContextKeyFrom({ ...BASE });
    expect(typeof k).toBe('string');
    expect(k).toContain('1280x800');
    expect(k).toContain('irisCore+l2cs:6');
  });
});

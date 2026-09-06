import { describe, it, expect } from 'vitest';
import { buildContextKeyFrom } from './calibration';

// A chave de contexto do perfil salvo precisa usar o VIEWPORT (onde o modelo
// foi treinado), não a resolução do monitor, e codificar toda flag que muda o
// vetor de features ou o alvo (`polynomialFeatures`, `geometricPoseCompensation`,
// `expandFactor`); caso contrário um perfil incompatível carrega em silêncio.

/** Contexto de referência: viewport 1280×800, flags de produção. */
const BASE = {
  viewportW: 1280,
  viewportH: 800,
  featureVectorId: 'irisCore+l2cs:6',
  formatVersion: 3,
  polynomialFeatures: true,
  geometricPoseCompensation: true,
  expandFactor: 1.4,
} as const;

describe('a chave do perfil usa o viewport, não a resolução do monitor', () => {
  it('viewports diferentes produzem chaves diferentes', () => {
    // 1280×800 (janela) vs 1920×1080 (maximizada): `screen.width` não muda ao
    // maximizar, então a chave não pode depender dele.
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

describe('a chave codifica todas as flags que mudam o vetor ou o alvo', () => {
  it('polynomialFeatures entra na chave', () => {
    // Default `true`, e muda 6 → 27 dims. Um perfil treinado com a expansão
    // ligada carregado numa sessão sem ela dispara `RangeError` no primeiro
    // frame e o paciente perde a calibração no meio da sessão.
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, polynomialFeatures: false }));
  });

  it('geometricPoseCompensation entra na chave', () => {
    // Com a compensação ligada os alvos de treino são deslocados pela pose de
    // cada amostra; um perfil treinado assim, carregado numa sessão que não
    // compensa a saída, prediz com um viés sistemático.
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, geometricPoseCompensation: false }));
  });

  it('expandFactor entra na chave — o pior dos três', () => {
    // `expandFactor` muda os VALORES de tan(yaw)/tan(pitch) mantendo a
    // dimensão. Sem estar na chave, nenhum erro é lançado: o perfil carrega e
    // prediz com features cujo significado mudou. O sintoma é um cursor
    // sistematicamente deslocado, sem nada na UI que explique.
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, expandFactor: 1.6 }));
  });

  it('featureVectorId continua na chave', () => {
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, featureVectorId: 'irisCore:4' }));
  });

  it('a versão de formato continua na chave', () => {
    expect(buildContextKeyFrom({ ...BASE }))
      .not.toBe(buildContextKeyFrom({ ...BASE, formatVersion: 4 }));
  });
});

describe('nenhuma flag do vetor pode ser esquecida em silêncio', () => {
  it('mudar qualquer campo do contexto muda a chave', () => {
    // Varredura: se alguém adicionar um campo ao contexto e esquecer de
    // incluí-lo na chave, este teste falha.
    const referencia = buildContextKeyFrom({ ...BASE });
    const variacoes: Array<Partial<typeof BASE>> = [
      { viewportW: 1281 },
      { viewportH: 801 },
      { featureVectorId: 'outro:9' },
      { formatVersion: 99 },
      { polynomialFeatures: false },
      { geometricPoseCompensation: false },
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

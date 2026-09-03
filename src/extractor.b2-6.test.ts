import { describe, it, expect } from 'vitest';
import { BlinkDetector, extractCompactFeatures, EAR_THR_MIN, EAR_THR_MAX } from './extractor';
import type { Point3D } from './extractor';

// -----------------------------------------------------------------------------
// B2.6 — EAR anisotrópico 1,78× contra limiares calibrados para EAR isotrópico.
//
// O MediaPipe normaliza x pela LARGURA e y pela ALTURA. Uma distância física
// `d` px vira `d/W` no eixo x e `d/H` no eixo y. Como W > H:
//
//   EAR = altura_norm / largura_norm
//       = (dy/H) / (dx/W)
//       = (dy/dx) · (W/H)
//       = EAR_isotrópico · 1,78     (em 1920×1080)
//
// O próprio código confirma: `extractor.ts` registra "mediana 0,551 onde a
// escala isotrópica daria 0,314" — e 0,314 × 1,78 = 0,559.
//
// A consequência é que o limiar adaptativo nunca adapta:
//
//   thr = Math.max(0.10, Math.min(0.22, mean * 0.8));
//
// Com `mean ≈ 0,55`, `mean*0.8 = 0,44`, **sempre** cortado pelo teto de 0,22.
// O limiar fica travado no clamp em 100% dos frames e o `blinkRatio` não tem
// efeito nenhum: o detector passa a exigir que o olho feche até **40%** da
// abertura de repouso (0,22/0,55) em vez dos **80%** pretendidos. Piscadas
// parciais, ptose e as fases de abertura/fechamento passam como fixação
// válida e ENTRAM NA CALIBRAÇÃO.
//
// Este é pré-requisito direto de C7 (a especificação pede EAR threshold 0,18,
// que num EAR de escala 0,55 nunca dispararia).
//
// ⚠️ Cuidado registrado no plano: ligar `EXPERIMENT.isotropicLandmarks`
// conserta isso POR ACIDENTE e muda o vetor de features junto. Os dois efeitos
// precisam ficar separados — por isso a correção mora no cálculo do EAR, não
// numa transformação global dos landmarks.
// -----------------------------------------------------------------------------

/**
 * Rosto sintético com olhos de abertura física conhecida.
 *
 * `alturaPx` e `larguraPx` são medidas em PIXELS DE VÍDEO; a função converte
 * para o espaço normalizado do MediaPipe dividindo por H e por W — que é
 * exatamente a origem da anisotropia.
 */
function rosto(alturaPx: number, larguraPx: number, W: number, H: number): Point3D[] {
  const p: Point3D[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const meiaLargura = larguraPx / W / 2;
  const meiaAltura = alturaPx / H / 2;

  const olho = (interno: number, externo: number, topo: number, base: number, cx: number) => {
    p[interno] = { x: cx - meiaLargura, y: 0.5, z: 0 };
    p[externo] = { x: cx + meiaLargura, y: 0.5, z: 0 };
    p[topo]    = { x: cx, y: 0.5 - meiaAltura, z: 0 };
    p[base]    = { x: cx, y: 0.5 + meiaAltura, z: 0 };
  };
  olho(133, 33, 159, 145, 0.4);
  olho(362, 263, 386, 374, 0.6);
  // Íris: precisam existir para o extractor não sair pela porta de "sem
  // landmarks", mas não influenciam o EAR.
  for (const i of [468, 469, 470, 471, 472]) p[i] = { x: 0.4, y: 0.5, z: 0 };
  for (const i of [473, 474, 475, 476, 477]) p[i] = { x: 0.6, y: 0.5, z: 0 };
  return p;
}

/** EAR que o extractor reporta para um olho de geometria física conhecida. */
function earMedido(alturaPx: number, larguraPx: number, W: number, H: number): number {
  const r = extractCompactFeatures(
    rosto(alturaPx, larguraPx, W, H),
    undefined,
    { yaw: 0, pitch: 0, valid: true },
    undefined,
    W,
    H,
  );
  return r.leftEAR!;
}

describe('B2.6 — o EAR é isotrópico', () => {
  it('um olho de 30×100 px reporta EAR ≈ 0,30, não 0,53', () => {
    // Razão física: 30/100 = 0,30. Com a anisotropia de 1920×1080 (1,78×) o
    // código antigo reportava 0,533.
    const ear = earMedido(30, 100, 1920, 1080);
    expect(ear).toBeCloseTo(0.30, 2);
  });

  it('o mesmo olho físico dá o MESMO EAR em 1080p e em 720p', () => {
    // Invariância à resolução — o critério que separa "medida" de "artefato de
    // normalização". Ambas são 16:9, então o valor anisotrópico coincidiria
    // aqui; o teste seguinte usa aspectos diferentes.
    const a = earMedido(30, 100, 1920, 1080);
    const b = earMedido(20, 66.67, 1280, 720);
    expect(a).toBeCloseTo(b, 3);
  });

  it('o EAR não muda com o ASPECTO do vídeo', () => {
    // Este é o teste que o código antigo falharia de forma gritante: em 4:3 o
    // fator de inflação é 1,33 e em 16:9 é 1,78 — o mesmo olho reportaria
    // valores 33% diferentes só por causa do formato do sensor.
    const dezesseisPorNove = earMedido(30, 100, 1920, 1080);
    const quatroPorTres     = earMedido(30, 100, 1600, 1200);
    expect(dezesseisPorNove).toBeCloseTo(quatroPorTres, 3);
  });

  it('a mediana de repouso da gravação (0,551 anisotrópico) vira ~0,31', () => {
    // O número registrado no cabeçalho do extractor: "mediana 0,551 onde a
    // escala isotrópica daria 0,314".
    const alturaPx = 0.314 * 100;
    const ear = earMedido(alturaPx, 100, 1920, 1080);
    expect(ear).toBeCloseTo(0.314, 2);
  });
});

describe('B2.6 — os limiares foram reescalados para a nova escala', () => {
  it('thrMax acomoda o EAR de repouso isotrópico sem travar no clamp', () => {
    // O ponto do bug: com repouso 0,31 e blinkRatio 0,8, o limiar desejado é
    // 0,248. Um teto de 0,22 continuaria cortando — corrigir a escala do EAR
    // sem reescalar o teto não resolveria nada.
    const repousoIsotropico = 0.31;
    const limiarDesejado = repousoIsotropico * 0.8;
    expect(EAR_THR_MAX).toBeGreaterThan(limiarDesejado);
  });

  it('thrMin continua abaixo do limiar fisiológico de olho fechado', () => {
    expect(EAR_THR_MIN).toBeLessThan(0.18);
    expect(EAR_THR_MIN).toBeGreaterThan(0);
  });

  it('o limiar adaptativo de fato ADAPTA com EAR de repouso realista', () => {
    // Antes: `mean*0.8 = 0,44` sempre cortado por 0,22 → limiar constante em
    // 100% dos frames, `blinkRatio` sem efeito.
    const d = new BlinkDetector();
    const REPOUSO = 0.31;
    for (let i = 0; i < 30; i++) d.update(REPOUSO, i * 33);

    // 0,80 × 0,31 = 0,248. Um EAR de 0,26 (84% do repouso) NÃO é piscada;
    // 0,23 (74%) É.
    expect(d.update(0.26, 1000)).toBe(false);
    expect(d.update(0.23, 1033)).toBe(true);
  });

  it('o detector exige fechar até ~80% do repouso, não 40%', () => {
    // A afirmação central do bug, medida diretamente.
    const d = new BlinkDetector();
    const REPOUSO = 0.31;
    for (let i = 0; i < 30; i++) d.update(REPOUSO, i * 33);

    // Encontra a fração de fechamento em que o veredito vira.
    let fracaoLimite = 1;
    for (let f = 1.0; f > 0.3; f -= 0.01) {
      if (d.update(REPOUSO * f, 5000)) { fracaoLimite = f; break; }
    }
    expect(fracaoLimite).toBeGreaterThan(0.70);
    expect(fracaoLimite).toBeLessThan(0.90);
  });
});

describe('B2.6 — a correção é independente de isotropicLandmarks', () => {
  it('o EAR não conta com a flag global para estar correto', () => {
    // O plano avisa: ligar `EXPERIMENT.isotropicLandmarks` conserta o EAR por
    // acidente E muda o vetor de features junto. A correção do EAR precisa
    // valer com a flag DESLIGADA, que é o default de produção.
    //
    // Como este teste roda com o default (flag off), o simples fato de os
    // testes acima passarem já demonstra a independência. Aqui travamos a
    // intenção explicitamente para quem for mexer nisso depois.
    const ear = earMedido(31, 100, 1920, 1080);
    expect(ear).toBeCloseTo(0.31, 2);
  });

  it('sem dimensões de vídeo o EAR não é corrigido às cegas', () => {
    // Sem W e H não há como saber o fator de anisotropia. Chutar 16:9 seria
    // fabricar medição — o mesmo padrão de defeito que o projeto combate.
    // O contrato: devolve o valor cru e quem consome sabe que não foi
    // corrigido.
    const r = extractCompactFeatures(
      rosto(30, 100, 1920, 1080),
      undefined,
      { yaw: 0, pitch: 0, valid: true },
    );
    // Valor cru anisotrópico: 0,533.
    expect(r.leftEAR!).toBeCloseTo(0.533, 2);
  });
});

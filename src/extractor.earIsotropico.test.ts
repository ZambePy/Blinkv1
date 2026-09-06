import { describe, it, expect } from 'vitest';
import { BlinkDetector, extractCompactFeatures, EAR_THR_MIN, EAR_THR_MAX } from './extractor';
import type { Point3D } from './extractor';

// O MediaPipe normaliza x pela largura e y pela altura, então um EAR calculado
// direto nos landmarks sai inflado por W/H (1,78× em 16:9): mediana 0,551 onde
// a escala isotrópica dá 0,314. O EAR precisa ser isotrópico (invariante a
// resolução e aspecto) e os limiares do BlinkDetector reescalados junto, senão
// o limiar adaptativo trava no clamp e piscadas parciais entram na calibração.

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

describe('o EAR é isotrópico', () => {
  it('um olho de 30×100 px reporta EAR ≈ 0,30, não 0,53', () => {
    // Razão física: 30/100 = 0,30. Com a anisotropia de 1920×1080 (1,78×)
    // sairia 0,533.
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
    // Em 4:3 o fator de inflação seria 1,33 e em 16:9, 1,78 — o mesmo olho
    // reportaria valores 33% diferentes só por causa do formato do sensor.
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

describe('os limiares foram reescalados para a nova escala', () => {
  it('thrMax acomoda o EAR de repouso isotrópico sem travar no clamp', () => {
    // Com repouso 0,31 e blinkRatio 0,8, o limiar desejado é 0,248. Um teto
    // de 0,22 continuaria cortando — corrigir a escala do EAR sem reescalar o
    // teto não resolveria nada.
    const repousoIsotropico = 0.31;
    const limiarDesejado = repousoIsotropico * 0.8;
    expect(EAR_THR_MAX).toBeGreaterThan(limiarDesejado);
  });

  it('thrMin continua abaixo do limiar fisiológico de olho fechado', () => {
    expect(EAR_THR_MIN).toBeLessThan(0.18);
    expect(EAR_THR_MIN).toBeGreaterThan(0);
  });

  it('o limiar adaptativo de fato ADAPTA com EAR de repouso realista', () => {
    // Com EAR anisotrópico, `mean*0.8 = 0,44` seria sempre cortado por 0,22:
    // limiar constante em 100% dos frames, `blinkRatio` sem efeito.
    const d = new BlinkDetector();
    const REPOUSO = 0.31;
    for (let i = 0; i < 30; i++) d.update(REPOUSO, i * 33);

    // 0,80 × 0,31 = 0,248. Um EAR de 0,26 (84% do repouso) NÃO é piscada;
    // 0,23 (74%) É.
    expect(d.update(0.26, 1000)).toBe(false);
    expect(d.update(0.23, 1033)).toBe(true);
  });

  it('o detector exige fechar até ~80% do repouso, não 40%', () => {
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

describe('a correção é independente de qualquer transformação global dos landmarks', () => {
  it('o EAR está correto com os landmarks crus do MediaPipe', () => {
    // A correção do EAR precisa valer sem nenhuma reescala prévia dos
    // landmarks, que é o que o pipeline entrega. Os testes acima já rodam
    // assim; aqui a intenção fica explícita para quem for mexer nisso depois.
    const ear = earMedido(31, 100, 1920, 1080);
    expect(ear).toBeCloseTo(0.31, 2);
  });

  it('sem dimensões de vídeo o EAR não é corrigido às cegas', () => {
    // Sem W e H não há como saber o fator de anisotropia. Chutar 16:9 seria
    // fabricar medição. O contrato: devolve o valor cru e quem consome sabe
    // que não foi corrigido.
    const r = extractCompactFeatures(
      rosto(30, 100, 1920, 1080),
      undefined,
      { yaw: 0, pitch: 0, valid: true },
    );
    // Valor cru anisotrópico: 0,533.
    expect(r.leftEAR!).toBeCloseTo(0.533, 2);
  });
});

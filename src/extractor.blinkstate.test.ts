import { describe, it, expect, beforeEach } from 'vitest';
import { BlinkDetector, resetEarHistory } from './extractor';
import { extractFeatures } from './featurePipeline';

// 2.2 — `extractFeatures` mutava estado escondido de módulo.
//
// O detector de piscada era um singleton (`_blinkDetector`) com limiar
// ADAPTATIVO: ele aprende o EAR de repouso dos quadros anteriores. Como
// `extractFeatures` chamava `update()` nesse singleton, a função deixava de ser
// pura — o mesmo quadro podia sair `blinkDetected: true` ou `false` dependendo
// do que tinha sido extraído antes, no mesmo processo.
//
// Isso não é teoria: o replay descarta o quadro quando `blinkDetected` é true.
// Duas variantes que filtram quadros de forma diferente alimentam o detector
// com populações diferentes, o limiar diverge, e o conjunto de quadros que
// sobrevive muda por um motivo que nada tem a ver com o que se está medindo.

/** Rosto sintético com abertura de olho controlada. 478 landmarks, o mínimo
 *  para o path compacto não sair pela porta de "sem landmarks". */
function rosto(aberturaOlho: number): { x: number; y: number; z: number }[] {
  const p = Array.from({ length: 478 }, (_, i) => ({
    x: 0.5 + (i % 17) * 0.001, y: 0.5 + (i % 13) * 0.001, z: (i % 7) * 0.001,
  }));
  // Cantos horizontais fixos, pálpebras variáveis: é a razão altura/largura
  // (EAR) que o detector lê.
  const olho = (interno: number, externo: number, topo: number, base: number) => {
    p[interno] = { x: 0.45, y: 0.50, z: 0 };
    p[externo] = { x: 0.55, y: 0.50, z: 0 };
    p[topo]    = { x: 0.50, y: 0.50 - aberturaOlho / 2, z: 0 };
    p[base]    = { x: 0.50, y: 0.50 + aberturaOlho / 2, z: 0 };
  };
  olho(133, 33, 159, 145);
  olho(362, 263, 386, 374);
  for (const i of [468, 469, 470, 471, 472]) p[i] = { x: 0.50, y: 0.50, z: 0 };
  for (const i of [473, 474, 475, 476, 477]) p[i] = { x: 0.50, y: 0.50, z: 0 };
  return p;
}

// Alturas escolhidas para dar EAR ≈ 0,55 (repouso real medido na gravação) e
// ≈ 0,35. As duas ficam ACIMA de `thrMax` (0,22), o que é essencial: abaixo
// dele o histórico nunca arranca e o detector fica preso — ver o teste de
// bootstrap mais abaixo.
// Alturas escolhidas a partir do que a gravação de referência mede de verdade.
// A largura do olho sintético é 0,10, então EAR = altura / 0,10.
//
// ⚠️ O EAR que o código vê é ANISOTRÓPICO: os landmarks do MediaPipe têm x
// normalizado pela largura e y pela altura, então num vídeo 16:9 uma distância
// vertical vale 1,78× o que deveria. Medido na gravação: EAR anisotrópico 0,551
// contra 0,314 isotrópico, razão 1,754. Ver o teste de escala no fim.
const REPOUSO_REAL = 0.060;      // EAR 0,60 — o que um olho aberto produz aqui
const REPOUSO_BAIXO = 0.025;     // EAR 0,25 — única faixa em que o limiar adapta
const TESTE = 0.021;             // EAR 0,21 — entre os dois limiares resultantes

describe('BlinkDetector — o limiar adaptativo e seus dois pontos cegos', () => {
  const EAR = (altura: number) => altura / 0.10;

  it('o mesmo EAR muda de veredito conforme a história anterior', () => {
    // É esta dependência de história que torna `extractFeatures` impura quando
    // o detector é um singleton de módulo.
    const alto = new BlinkDetector();
    for (let i = 0; i < 30; i++) alto.update(EAR(REPOUSO_REAL));
    // Repouso 0,60 → 0,8×0,60 = 0,48, clampado em thrMax 0,22 → 0,21 é piscada.
    expect(alto.update(EAR(TESTE))).toBe(true);

    const baixo = new BlinkDetector();
    for (let i = 0; i < 30; i++) baixo.update(EAR(REPOUSO_BAIXO));
    // Repouso 0,25 → limiar 0,20, dentro da faixa → 0,21 é normal.
    expect(baixo.update(EAR(TESTE))).toBe(false);
  });

  it('PONTO CEGO 1: com EAR de repouso real o limiar fica preso no clamp', () => {
    // A gravação mede repouso 0,551. 0,8 × 0,551 = 0,44, muito acima de
    // thrMax = 0,22, então o limiar é SEMPRE 0,22 e a adaptação nunca ocorre.
    // Para adaptar de fato, o repouso teria que cair em [0,125, 0,275].
    const d = new BlinkDetector();
    for (let i = 0; i < 40; i++) d.update(0.551);
    // 0,23 está acima do clamp: não é piscada, apesar de ser 42% do repouso.
    expect(d.update(0.23)).toBe(false);
    // E 0,21 é piscada, apesar de estar quase no mesmo lugar. O veredito é
    // decidido pelo clamp, não pela fisiologia do usuário.
    expect(d.update(0.21)).toBe(true);
  });

  it('PONTO CEGO 2: repouso abaixo de thrMax trava o detector para sempre', () => {
    // O histórico só cresce com quadros de NÃO-piscada. Se o repouso do usuário
    // já está abaixo de thrMax (0,22), todo quadro é piscada, nada entra no
    // histórico, e o limiar nunca sai do default. Fica travado.
    //
    // O comentário do módulo diz que thrMax existe para "não confundir olho
    // semi-fechado (ptose) com piscada" — mas é exatamente o usuário com ptose
    // que cai neste buraco, e o público-alvo tem ELA.
    const d = new BlinkDetector();
    for (let i = 0; i < 200; i++) expect(d.update(0.18)).toBe(true);
    expect(d.nonBlinkCount).toBe(0);
  });
});

describe('extractFeatures — pureza', () => {
  beforeEach(() => { resetEarHistory(); });

  it('aceita um detector injetado, e dois detectores não se contaminam', () => {
    const alto = new BlinkDetector();
    const baixo = new BlinkDetector();
    for (let i = 0; i < 30; i++) {
      extractFeatures(rosto(REPOUSO_REAL), undefined, null, 1280, 720, undefined, alto);
      extractFeatures(rosto(REPOUSO_BAIXO), undefined, null, 1280, 720, undefined, baixo);
    }
    const a = extractFeatures(rosto(TESTE), undefined, null, 1280, 720, undefined, alto);
    const b = extractFeatures(rosto(TESTE), undefined, null, 1280, 720, undefined, baixo);
    expect(a.blinkDetected).toBe(true);
    expect(b.blinkDetected).toBe(false);
  });

  it('um detector injetado NÃO mexe no singleton do módulo', () => {
    // É o que permite ao harness rodar uma variante sem perturbar o estado que
    // a próxima veria — inclusive a taxa de piscadas que a UI lê.
    const proprio = new BlinkDetector();
    for (let i = 0; i < 40; i++) {
      extractFeatures(rosto(REPOUSO_BAIXO), undefined, null, 1280, 720, undefined, proprio);
    }
    for (let i = 0; i < 30; i++) extractFeatures(rosto(REPOUSO_REAL), undefined, null, 1280, 720);
    // O singleton só viu repouso alto: veredito coerente com a SUA história.
    expect(extractFeatures(rosto(TESTE), undefined, null, 1280, 720).blinkDetected).toBe(true);
  });

  it('sem detector injetado o comportamento antigo é preservado', () => {
    for (let i = 0; i < 30; i++) extractFeatures(rosto(REPOUSO_REAL), undefined, null, 1280, 720);
    expect(extractFeatures(rosto(TESTE), undefined, null, 1280, 720).blinkDetected).toBe(true);
  });
});

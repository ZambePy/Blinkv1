import { describe, it, expect, beforeEach } from 'vitest';
import { BlinkDetector, resetEarHistory } from './extractor';
import { extractFeatures } from './featurePipeline';

// `extractFeatures` deve ser pura quando um detector é injetado — o singleton
// interno mantém estado escondido de módulo, cujo limiar adaptativo aprende
// EAR ao longo do processo. Injetar um detector isola o teste desse estado.

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

// B2.6 — os valores abaixo estão na escala ISOTRÓPICA do EAR.
//
// Antes de B2.6 o EAR chegava ao detector inflado por W/H (1,78× em 1080p),
// porque o MediaPipe normaliza x pela largura e y pela altura. A gravação de
// referência media 0,551 anisotrópico onde a escala isotrópica dá 0,314.
// Agora `extractEyeFeatures` corrige a anisotropia e os limiares do
// `BlinkDetector` foram reescalados junto (EAR_THR_MIN/MAX = 0,12/0,28).
//
// A largura do olho sintético é 0,10; em 16:9 a correção multiplica por
// H/W = 0,5625. Logo EAR_visto = (altura/0,10) × 0,5625.
//
// Os dois repousos precisam ficar ACIMA de `EAR_THR_MAX` (0,28), senão o
// histórico nunca arranca: todo quadro vira piscada e o limiar fica preso no
// default. Esse é o PONTO CEGO 2, testado explicitamente mais abaixo — aqui
// ele seria só ruído que impediria medir o que se quer medir.
const REPOUSO_ALTO  = 0.0711;    // → EAR ≈ 0,40  (olho bem aberto)
const REPOUSO_MEDIO = 0.0551;    // → EAR ≈ 0,31  (o repouso medido na gravação)
const TESTE         = 0.0462;    // → EAR ≈ 0,26  — entre os dois limiares

describe('BlinkDetector — o limiar adaptativo e seus dois pontos cegos', () => {
  const EAR = (altura: number) => altura / 0.10;

  it('o mesmo EAR muda de veredito conforme a história anterior', () => {
    // É esta dependência de história que torna `extractFeatures` impura quando
    // o detector é um singleton de módulo.
    const alto = new BlinkDetector();
    for (let i = 0; i < 30; i++) alto.update(0.40);
    // Repouso 0,40 → 0,8 × 0,40 = 0,32, cortado pelo teto 0,28.
    // 0,26 fica abaixo de 0,28 → é piscada.
    expect(alto.update(0.26)).toBe(true);

    const medio = new BlinkDetector();
    for (let i = 0; i < 30; i++) medio.update(0.31);
    // Repouso 0,31 → limiar 0,248, DENTRO da faixa (sem clamp).
    // 0,26 fica acima de 0,248 → não é piscada.
    expect(medio.update(0.26)).toBe(false);
  });

  it('B2.6 — com EAR de repouso real o limiar ADAPTA em vez de travar no clamp', () => {
    // ATÉ B2.6 este teste se chamava "PONTO CEGO 1" e afirmava o contrário:
    // que com repouso 0,551 o limiar ficava SEMPRE preso em thrMax=0,22 e a
    // adaptação nunca ocorria. Era o bug — o EAR estava inflado 1,78× e os
    // limiares tinham sido calibrados para a escala isotrópica.
    //
    // Corrigida a escala (repouso ~0,31) e reescalados os limiares
    // (teto 0,28), o limiar desejado 0,8 × 0,31 = 0,248 cabe na faixa e a
    // adaptação passa a acontecer de fato.
    const d = new BlinkDetector();
    for (let i = 0; i < 40; i++) d.update(0.31);
    // 0,26 é 84% do repouso: não é piscada.
    expect(d.update(0.26)).toBe(false);
    // 0,23 é 74% do repouso: é piscada. O veredito agora vem da fisiologia
    // do usuário, não do clamp.
    expect(d.update(0.23)).toBe(true);
  });

  it('PONTO CEGO 2 — CORRIGIDO em P5.4: repouso baixo não trava mais', () => {
    // ⚠️ ESTE TESTE FOI INVERTIDO, e o motivo importa.
    //
    // A versão anterior AFIRMAVA o buraco como comportamento esperado:
    //
    //     for (let i = 0; i < 200; i++) expect(d.update(0.22)).toBe(true);
    //     expect(d.nonBlinkCount).toBe(0);
    //
    // Ou seja: 200 quadros seguidos de piscada e histórico zerado eram o
    // resultado que a suíte protegia. O próprio comentário registrava que era
    // "um ponto cego real" e que atingia justamente o usuário com ptose — e o
    // público-alvo tem ELA. Um defeito conhecido, descrito, e verde.
    //
    // `P5.4` corrigiu na causa: o bootstrap passou a usar
    // `EAR_CLOSED_ABSOLUTE` (0,18) em vez de `thrMax`, mais uma guarda que
    // adota o valor observado quando nem o limiar absoluto arranca. O detector
    // agora aprende o repouso de quem tem abertura reduzida em vez de declarar
    // que essa pessoa pisca o tempo todo.
    const d = new BlinkDetector();
    const vereditos: boolean[] = [];
    for (let i = 0; i < 200; i++) vereditos.push(d.update(0.22));
    expect(vereditos.filter(Boolean).length).toBeLessThan(5);
    expect(d.nonBlinkCount).toBeGreaterThan(0);
    expect(d.restingEar).toBeCloseTo(0.22, 2);
  });
});

describe('extractFeatures — pureza', () => {
  beforeEach(() => { resetEarHistory(); });

  // B1.1: `extractFeatures` passou a LANÇAR quando `l2csGaze` é `null`, porque
  // sem o bloco angular o vetor sai com 37 dims e o conjunto ativo exige 39 —
  // a corrupção silenciosa que custava a calibração do paciente no meio da
  // sessão. Estes testes não têm nada a ver com L2CS: passavam `null` por
  // acidente. Passam agora um gaze INVÁLIDO, que é o caminho de degradação
  // graciosa documentado (§E4): o bloco é anexado zerado, o comprimento fica
  // correto, e o veredito de piscada — o que estes testes medem — não muda.
  const GAZE_INVALIDO = { yaw: 0, pitch: 0, valid: false } as const;

  it('aceita um detector injetado, e dois detectores não se contaminam', () => {
    const alto = new BlinkDetector();
    const baixo = new BlinkDetector();
    for (let i = 0; i < 30; i++) {
      extractFeatures(rosto(REPOUSO_ALTO), undefined, GAZE_INVALIDO, 1280, 720, undefined, alto);
      extractFeatures(rosto(REPOUSO_MEDIO), undefined, GAZE_INVALIDO, 1280, 720, undefined, baixo);
    }
    const a = extractFeatures(rosto(TESTE), undefined, GAZE_INVALIDO, 1280, 720, undefined, alto);
    const b = extractFeatures(rosto(TESTE), undefined, GAZE_INVALIDO, 1280, 720, undefined, baixo);
    expect(a.blinkDetected).toBe(true);
    expect(b.blinkDetected).toBe(false);
  });

  it('um detector injetado NÃO mexe no singleton do módulo', () => {
    // É o que permite ao harness rodar uma variante sem perturbar o estado que
    // a próxima veria — inclusive a taxa de piscadas que a UI lê.
    const proprio = new BlinkDetector();
    for (let i = 0; i < 40; i++) {
      extractFeatures(rosto(REPOUSO_MEDIO), undefined, GAZE_INVALIDO, 1280, 720, undefined, proprio);
    }
    for (let i = 0; i < 30; i++) extractFeatures(rosto(REPOUSO_ALTO), undefined, GAZE_INVALIDO, 1280, 720);
    // O singleton só viu repouso alto: veredito coerente com a SUA história.
    expect(extractFeatures(rosto(TESTE), undefined, GAZE_INVALIDO, 1280, 720).blinkDetected).toBe(true);
  });

  it('sem detector injetado o comportamento antigo é preservado', () => {
    for (let i = 0; i < 30; i++) extractFeatures(rosto(REPOUSO_ALTO), undefined, GAZE_INVALIDO, 1280, 720);
    expect(extractFeatures(rosto(TESTE), undefined, GAZE_INVALIDO, 1280, 720).blinkDetected).toBe(true);
  });
});

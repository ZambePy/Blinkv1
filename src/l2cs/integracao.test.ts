import { describe, it, expect } from 'vitest';
import { extractCompactFeatures, projectFeatureSet, ACTIVE_FEATURE_SET } from '../extractor';
import { extractFeatures } from '../featurePipeline';
import { buildL2CSBlock, isGazePlausible } from './block';

// Onde o L2CS entra no pipeline, e onde ele PARA.
//
// Este teste existe porque a resposta não é óbvia lendo o código: o bloco
// angular é construído e anexado em `extractCompactFeatures`, e a projeção no
// conjunto ativo (em outro arquivo) decide quanto dele chega ao modelo — hoje,
// as duas dims de 1ª ordem. Se o conjunto ativo mudar, estes testes falham —
// e é isso que se quer: a mudança precisa ser deliberada, não silenciosa.

function rosto() {
  const p = Array.from({ length: 478 }, (_, i) => ({
    x: 0.5 + (i % 17) * 0.002, y: 0.5 + (i % 13) * 0.002, z: (i % 7) * 0.002,
  }));
  const olho = (int: number, ext: number, topo: number, base: number) => {
    p[int] = { x: 0.45, y: 0.50, z: 0 }; p[ext] = { x: 0.55, y: 0.50, z: 0 };
    p[topo] = { x: 0.50, y: 0.47, z: 0 }; p[base] = { x: 0.50, y: 0.53, z: 0 };
  };
  olho(133, 33, 159, 145); olho(362, 263, 386, 374);
  p[10] = { x: 0.5, y: 0.3, z: 0 };
  for (const i of [468, 469, 470, 471, 472]) p[i] = { x: 0.50, y: 0.50, z: 0 };
  for (const i of [473, 474, 475, 476, 477]) p[i] = { x: 0.50, y: 0.50, z: 0 };
  return p;
}

const GAZE_A = { yaw: 0.20, pitch: -0.10, valid: true };
const GAZE_B = { yaw: -0.35, pitch: 0.25, valid: true };

describe('o bloco angular é construído e anexado', () => {
  it('o vetor completo cresce de 37 para 44 dims com L2CS', () => {
    const lm = rosto();
    expect(extractCompactFeatures(lm, undefined, null).featuresLeft).toHaveLength(37);
    expect(extractCompactFeatures(lm, undefined, GAZE_A).featuresLeft).toHaveLength(44);
  });

  it('e os sete valores do bloco respondem ao olhar', () => {
    const lm = rosto();
    // Índice fixo [37..43]: localizar o bloco por posição relativa ao fim
    // quebra quando o vetor cresce.
    const a = extractCompactFeatures(lm, undefined, GAZE_A).featuresLeft.slice(37, 44);
    const b = extractCompactFeatures(lm, undefined, GAZE_B).featuresLeft.slice(37, 44);
    expect(a).toHaveLength(7);
    expect(a).not.toEqual(b);
  });
});

describe('…e agora chega ao modelo (tan yaw, tan pitch)', () => {
  it('dois olhares diferentes produzem vetores projetados diferentes', () => {
    // O oposto do estado histórico: com `ACTIVE_FEATURE_SET = 'irisCore+l2cs'`
    // as duas últimas dims [4] e [5] carregam tan(yaw) e tan(pitch), então o
    // vetor entregue ao Ridge responde ao gaze.
    const lm = rosto();
    const a = projectFeatureSet(extractCompactFeatures(lm, undefined, GAZE_A).featuresLeft);
    const b = projectFeatureSet(extractCompactFeatures(lm, undefined, GAZE_B).featuresLeft);
    expect(ACTIVE_FEATURE_SET).toBe('irisCore+l2cs');
    expect(a).toHaveLength(6);
    expect(a).not.toEqual(b);
    // As 4 primeiras dims são o irisCore puro (dependem só dos landmarks),
    // então são iguais entre os dois olhares — quem varia é o par angular.
    expect(a.slice(0, 4)).toEqual(b.slice(0, 4));
    expect(a.slice(4)).not.toEqual(b.slice(4));
  });

  it('sem gaze, o pipeline LANÇA em vez de entregar 37 dims', () => {
    // Antes este teste afirmava `expect(semGaze).toHaveLength(37)` e chamava
    // isso de "fallback do projectFeatureSet". Era o bug: o vetor de 37 dims
    // ia inteiro para o Ridge — com pose [22..24] e as 12 interações [25..36]
    // que a análise do extractor exclui de propósito por memorização (322 px
    // medidos contra 140 px) — enquanto `FEATURE_VECTOR_ID` continuava
    // gravando "irisCore+l2cs:6".
    //
    // Em produção isto NÃO deveria ocorrer: `engine.ts` sempre passa um objeto
    // `L2CSGazeInput` enquanto o conjunto ativo carrega o bloco angular. A
    // barreira existe para o caso em que isso deixar de valer.
    const lm = rosto();
    const comGaze = extractFeatures(lm, undefined, GAZE_A, 1920, 1080).featuresLeft;
    expect(comGaze).toHaveLength(6);
    expect(() => extractFeatures(lm, undefined, null, 1920, 1080)).toThrow(RangeError);

    // Cenário do engine live com worker aquecendo: `{valid:false}` faz o bloco
    // vir zerado, mas o vetor completo cresce para 44 dims e a projeção
    // funciona. Este é o caminho de degradação graciosa e continua válido.
    const stale = extractFeatures(lm, undefined, { yaw: 0, pitch: 0, valid: false }, 1920, 1080).featuresLeft;
    expect(stale).toHaveLength(6);
    expect(stale.slice(4)).toEqual([0, 0]); // tan(0)=0, tan(0)=0
    expect(comGaze).not.toEqual(stale);
  });
});

describe('o que o bloco carregava quando o crop estava preto', () => {
  // O crop entregava imagem preta (`source.width` vale 0 num <video>), então o
  // modelo devolvia sempre o MESMO ângulo. Na gravação de referência: 1563
  // quadros marcados válidos, um único valor de yaw, −1,4315 rad.
  const YAW_TRAVADO = -1.431514;

  it('o ângulo travado é rejeitado por implausibilidade — o bloco vira zeros', () => {
    expect(isGazePlausible(YAW_TRAVADO, 0)).toBe(false);
    expect(buildL2CSBlock(YAW_TRAVADO, 0, true, 60)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('e ANTES da guarda de plausibilidade, cinco dims eram constantes e duas eram a distância', () => {
    // O bloco é [ty, tp, ty·d, tp·d, ty², tp², ty·tp]. Com yaw e pitch fixos,
    // só as duas que multiplicam a distância variam — e o que elas carregam é
    // a distância, não o olhar. Qualquer ganho medido naquele período veio daí.
    const dentroDaFaixa = 0.3;
    const b1 = buildL2CSBlock(dentroDaFaixa, 0.1, true, 50);
    const b2 = buildL2CSBlock(dentroDaFaixa, 0.1, true, 70);
    const iguais = b1.map((v, i) => v === b2[i]);
    expect(iguais.filter(Boolean)).toHaveLength(5);   // constantes
    expect(iguais.filter((v) => !v)).toHaveLength(2); // as que escalam com a distância
  });
});

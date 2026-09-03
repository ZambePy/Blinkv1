import { describe, it, expect } from 'vitest';
import {
  INPUT_SIZE,
  L2CS_INPUT_SIZES,
  tamanhoDoTensor,
  preprocessFromRGBA,
  createCropContext,
  eyeRegionInCrop,
} from './crop';
import { sanitizeExperiment, EXPERIMENT_RANGES } from '../config/experiment';

// -----------------------------------------------------------------------------
// P5.5a — o L2CS passou a aceitar mais de um tamanho de entrada.
//
// O ONNX foi reexportado com eixos espaciais dinâmicos (`['batch', 3, 'height',
// 'width']`), então o mesmo binário roda 224² e 448². Verificado por inferência
// real antes desta mudança: o novo modelo aceita os dois, o antigo rejeita 224
// com `InvalidArgument`, e a saída do novo em 448 é **bit-idêntica** à do
// antigo (os 110 tensores de peso são iguais byte a byte — é reexport, não
// retreino).
//
// ── O risco que estas asserções guardam ─────────────────────────────────────
//
// Com tamanho variável, havia DUAS fontes de verdade que podiam divergir em
// silêncio: a constante `INPUT_SIZE` de `crop.ts`, que dimensiona o canvas e o
// buffer, e o `meta.inputSize`, que o worker usava para declarar o shape do
// tensor. Divergir significa entregar um `Float32Array` de 3·224² floats
// declarado como [1,3,448,448] — erro de runtime no melhor caso.
//
// A resposta é derivar o tamanho DO PRÓPRIO TENSOR. Um buffer de 3·N² floats
// só admite um N, então não há o que divergir.

describe('tamanhoDoTensor — a fonte única de verdade', () => {
  it('deduz o lado a partir do comprimento do buffer', () => {
    expect(tamanhoDoTensor(new Float32Array(3 * 224 * 224))).toBe(224);
    expect(tamanhoDoTensor(new Float32Array(3 * 448 * 448))).toBe(448);
  });

  it('rejeita comprimento que não corresponde a nenhum quadrado', () => {
    // Silenciar aqui devolveria um lado fracionário que viraria um shape
    // inválido lá no worker, longe da origem do problema.
    expect(() => tamanhoDoTensor(new Float32Array(1000))).toThrow(/tensor/i);
    expect(() => tamanhoDoTensor(new Float32Array(0))).toThrow(/tensor/i);
  });

  it('rejeita comprimento não divisível por 3 (canais)', () => {
    expect(() => tamanhoDoTensor(new Float32Array(224 * 224 * 2))).toThrow(/tensor/i);
  });
});

describe('tamanhos suportados', () => {
  it('224 e 448 são os declarados, e 448 continua o default', () => {
    expect(L2CS_INPUT_SIZES).toContain(224);
    expect(L2CS_INPUT_SIZES).toContain(448);
    expect(INPUT_SIZE).toBe(448);
  });

  it('todo tamanho suportado é múltiplo de 32', () => {
    // A ResNet-50 reduz por 32. Um tamanho que não seja múltiplo produz mapa
    // final fracionário — funciona por causa do GlobalAveragePool, mas com
    // padding assimétrico que ninguém mediu.
    for (const s of L2CS_INPUT_SIZES) expect(s % 32).toBe(0);
  });
});

describe('flag l2csInputSize', () => {
  it('o default preserva o comportamento atual (448)', () => {
    expect(sanitizeExperiment({}).l2csInputSize).toBe(448);
  });

  it('aceita 224', () => {
    expect(sanitizeExperiment({ l2csInputSize: 224 }).l2csInputSize).toBe(224);
  });

  it('valor fora da faixa cai no default, com aviso', () => {
    expect(sanitizeExperiment({ l2csInputSize: 64 }).l2csInputSize).toBe(448);
    expect(sanitizeExperiment({ l2csInputSize: 4096 }).l2csInputSize).toBe(448);
  });

  it('a faixa é declarada em EXPERIMENT_RANGES', () => {
    expect(EXPERIMENT_RANGES.l2csInputSize).toBeDefined();
    expect(EXPERIMENT_RANGES.l2csInputSize.min).toBe(224);
    expect(EXPERIMENT_RANGES.l2csInputSize.max).toBe(448);
  });
});

describe('preprocessFromRGBA — normalização em qualquer tamanho', () => {
  it('normaliza 224² com a mesma fórmula de 448²', () => {
    const t224 = preprocessFromRGBA(new Uint8ClampedArray(224 * 224 * 4).fill(255), 224);
    const t448 = preprocessFromRGBA(new Uint8ClampedArray(448 * 448 * 4).fill(255), 448);
    expect(t224.length).toBe(3 * 224 * 224);
    expect(t448.length).toBe(3 * 448 * 448);
    // Mesmo pixel branco → mesmo valor normalizado, independente do tamanho.
    expect(t224[0]).toBeCloseTo(t448[0], 6);
  });

  it('comprimento incoerente com o tamanho pedido falha alto', () => {
    expect(() => preprocessFromRGBA(new Uint8ClampedArray(100), 224)).toThrow();
  });
});

describe('createCropContext — o canvas define o tamanho', () => {
  it('cria canvas do tamanho pedido', () => {
    expect(createCropContext(224).canvas.width).toBe(224);
    expect(createCropContext(448).canvas.width).toBe(448);
  });

  it('sem argumento, mantém o default de 448', () => {
    expect(createCropContext().canvas.width).toBe(INPUT_SIZE);
  });
});

describe('eyeRegionInCrop respeita o tamanho do crop', () => {
  function rosto() {
    const p = new Array(478).fill(null).map(() => ({ x: 0.5, y: 0.5 }));
    p[33] = { x: 0.40, y: 0.45 }; p[133] = { x: 0.47, y: 0.45 };
    p[362] = { x: 0.53, y: 0.45 }; p[263] = { x: 0.60, y: 0.45 };
    p[10] = { x: 0.5, y: 0.2 }; p[152] = { x: 0.5, y: 0.85 };
    return p;
  }

  it('a região escala junto com o tamanho do crop', () => {
    const r448 = eyeRegionInCrop(rosto(), 1280, 720, 1.4, false, 448)!;
    const r224 = eyeRegionInCrop(rosto(), 1280, 720, 1.4, false, 224)!;
    // Metade do lado → aproximadamente metade da região, e sempre dentro dos
    // limites. Um retângulo de coordenadas de 448 aplicado a um crop de 224
    // leria fora do buffer.
    expect(r224.x + r224.width).toBeLessThanOrEqual(224);
    expect(r224.y + r224.height).toBeLessThanOrEqual(224);
    expect(r224.width / r448.width).toBeCloseTo(0.5, 1);
  });
});

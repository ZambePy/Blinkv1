import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANTHAL_DISTANCE_CM,
  INTERPUPILLARY_DISTANCE_CM,
  LM_CANTO_EXTERNO_ESQUERDO,
  LM_CANTO_EXTERNO_DIREITO,
  LM_IRIS_ESQUERDA,
  LM_IRIS_DIREITA,
  distanciaPorTriangulacao,
  fovHorizontalDeg,
} from './anthropometry';

// -----------------------------------------------------------------------------
// P5.3 — uma constante antropométrica, um lugar.
//
// ── O bug que isto previne já custou caro ───────────────────────────────────
//
// `translationCompensation.ts` registra: a primeira versão usava **6,3 cm** (a
// distância INTERPUPILAR) contra uma medida CANTAL — 43% de erro de escala em
// toda a correção de translação. As duas constantes são parecidas, medem coisas
// diferentes, e nada no tipo `number` impede trocar uma pela outra.
//
// A defesa não é escolher "a constante certa": é amarrar cada uma ao LANDMARK
// que a produz. Quem mede entre os landmarks 33↔263 tem que usar a cantal;
// quem mede entre 468↔473 (centros de íris) tem que usar a interpupilar. O
// módulo expõe as duas com os índices ao lado, para que a escolha errada fique
// visível na chamada.
// -----------------------------------------------------------------------------

describe('as constantes e seus landmarks', () => {
  it('cantal e interpupilar são distintas e não se confundem', () => {
    expect(CANTHAL_DISTANCE_CM).toBe(9.0);
    expect(INTERPUPILLARY_DISTANCE_CM).toBe(6.3);
    // A razão entre elas É o erro de 43% que o repositório já pagou.
    expect(CANTHAL_DISTANCE_CM / INTERPUPILLARY_DISTANCE_CM).toBeCloseTo(1.43, 2);
  });

  it('cada constante vem com o par de landmarks que a mede', () => {
    // Cantos EXTERNOS dos olhos — o que `engine.ts` usa para `latestIodPx`.
    expect(LM_CANTO_EXTERNO_ESQUERDO).toBe(33);
    expect(LM_CANTO_EXTERNO_DIREITO).toBe(263);
    // Centros de íris — o refinamento de 478 pontos do Face Mesh.
    expect(LM_IRIS_ESQUERDA).toBe(468);
    expect(LM_IRIS_DIREITA).toBe(473);
  });
});

describe('triangulação — distância a partir do tamanho aparente', () => {
  it('recupera a distância de um setup com FOV e IOD conhecidos', () => {
    // Setup construído para ter resposta analítica: FOV 60°, vídeo 1280 px.
    // A meia-largura do frame a 60 cm é 60·tan(30°) = 34,64 cm, então o frame
    // inteiro cobre 69,28 cm. Um rosto com 9 cm cantais ocupa
    // 9/69,28 × 1280 = 166,3 px.
    const fov = 60, W = 1280, dist = 60;
    const larguraFrameCm = 2 * dist * Math.tan((fov / 2) * Math.PI / 180);
    const iodPx = (CANTHAL_DISTANCE_CM / larguraFrameCm) * W;
    expect(iodPx).toBeCloseTo(166.3, 1);
    expect(distanciaPorTriangulacao(iodPx, W, fov)).toBeCloseTo(dist, 6);
  });

  it('rosto maior no frame = mais perto, e vice-versa', () => {
    const perto = distanciaPorTriangulacao(300, 1280, 60)!;
    const longe = distanciaPorTriangulacao(100, 1280, 60)!;
    expect(perto).toBeLessThan(longe);
    // Relação inversa exata: o dobro de pixels, metade da distância.
    expect(distanciaPorTriangulacao(200, 1280, 60)! / perto).toBeCloseTo(1.5, 6);
  });

  it('entrada degenerada devolve null em vez de Infinity', () => {
    expect(distanciaPorTriangulacao(0, 1280, 60)).toBeNull();
    expect(distanciaPorTriangulacao(100, 0, 60)).toBeNull();
    expect(distanciaPorTriangulacao(100, 1280, 0)).toBeNull();
    expect(distanciaPorTriangulacao(NaN, 1280, 60)).toBeNull();
  });

  it('aceita a constante interpupilar quando a medida vem das íris', () => {
    // Mesma geometria, medida entre centros de íris: como a distância física é
    // menor, o mesmo rosto ocupa menos pixels. Passar a constante errada aqui
    // daria 43% de erro — é exatamente o parâmetro explícito que evita isso.
    const fov = 60, W = 1280, dist = 60;
    const larguraFrameCm = 2 * dist * Math.tan((fov / 2) * Math.PI / 180);
    const ipdPx = (INTERPUPILLARY_DISTANCE_CM / larguraFrameCm) * W;
    expect(distanciaPorTriangulacao(ipdPx, W, fov, INTERPUPILLARY_DISTANCE_CM)).toBeCloseTo(dist, 6);
    // E com a constante errada, o erro aparece:
    expect(distanciaPorTriangulacao(ipdPx, W, fov, CANTHAL_DISTANCE_CM)!).toBeCloseTo(dist * 1.43, 0);
  });
});

describe('fovHorizontalDeg — o inverso da triangulação', () => {
  it('recupera o FOV a partir de uma distância medida com fita métrica', () => {
    const fov = 72, W = 1920, dist = 55;
    const larguraFrameCm = 2 * dist * Math.tan((fov / 2) * Math.PI / 180);
    const iodPx = (CANTHAL_DISTANCE_CM / larguraFrameCm) * W;
    expect(fovHorizontalDeg(iodPx, W, dist)).toBeCloseTo(fov, 6);
  });

  it('ida e volta: FOV → distância → FOV', () => {
    const iodPx = 190, W = 1920, dist = 62;
    const fov = fovHorizontalDeg(iodPx, W, dist)!;
    expect(distanciaPorTriangulacao(iodPx, W, fov)).toBeCloseTo(dist, 6);
  });

  it('entrada degenerada devolve null', () => {
    expect(fovHorizontalDeg(0, 1920, 60)).toBeNull();
    expect(fovHorizontalDeg(190, 1920, 0)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// A verificação que o aceite pede: nenhum literal solto sobrou.
// -----------------------------------------------------------------------------

function arquivosTs(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      arquivosTs(p, out);
    } else if (nome.endsWith('.ts') && !nome.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('nenhum literal antropométrico solto no código de produção', () => {
  it('9.0 e 6.3 só existem em anthropometry.ts', () => {
    const raiz = join(process.cwd(), 'src');
    const infratores: string[] = [];

    for (const arquivo of arquivosTs(raiz)) {
      if (arquivo.endsWith('anthropometry.ts')) continue;
      // ⚠️ `split(/\r?\n/)`, não `split('\n')`. Este repositório é Windows e os
      // arquivos têm CRLF; um `\r` órfão no fim da linha faz o `.*$` que remove
      // o comentário nunca casar (em JS o `.` não casa `\r`), e o teste passa a
      // acusar comentários como se fossem código. Foi exatamente o que
      // aconteceu na primeira versão deste teste.
      const linhas = readFileSync(arquivo, 'utf-8').split(/\r?\n/);
      linhas.forEach((linha, i) => {
        // Só código: comentário citando o número é registro histórico, e é
        // desejável — foi assim que o bug de 43% ficou documentado.
        const semComentario = linha.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (semComentario.trim().startsWith('*')) return;
        // `9.0` ou `6.3` como VALOR, não como parte de outro número
        // (0.9, 19.0, 6.35 não contam).
        if (/(?<![\d.])(9\.0|6\.3)(?![\d])/.test(semComentario)) {
          infratores.push(`${arquivo.replace(raiz, 'src')}:${i + 1}: ${linha.trim()}`);
        }
      });
    }

    expect(infratores).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANTHAL_DISTANCE_CM,
  LM_CANTO_EXTERNO_ESQUERDO,
  LM_CANTO_EXTERNO_DIREITO,
  LM_IRIS_ESQUERDA,
  LM_IRIS_DIREITA,
  fovHorizontalDeg,
} from './anthropometry';

// Uma constante antropométrica, um lugar. Interpupilar (6,3 cm, landmarks
// 468↔473) e cantal (9,0 cm, landmarks 33↔263) são parecidas mas medem coisas
// diferentes — trocar uma pela outra já custou 43% de erro de escala na
// compensação de translação. Cada constante fica amarrada ao landmark que a produz.

describe('as constantes e seus landmarks', () => {
  it('cada constante vem com o par de landmarks que a mede', () => {
    // Cantos EXTERNOS dos olhos — o que `engine.ts` usa para `latestIodPx`.
    expect(LM_CANTO_EXTERNO_ESQUERDO).toBe(33);
    expect(LM_CANTO_EXTERNO_DIREITO).toBe(263);
    // Centros de íris — o refinamento de 478 pontos do Face Mesh.
    expect(LM_IRIS_ESQUERDA).toBe(468);
    expect(LM_IRIS_DIREITA).toBe(473);
  });
});

describe('fovHorizontalDeg — o inverso da triangulação', () => {
  it('recupera o FOV a partir de uma distância medida com fita métrica', () => {
    const fov = 72, W = 1920, dist = 55;
    const larguraFrameCm = 2 * dist * Math.tan((fov / 2) * Math.PI / 180);
    const iodPx = (CANTHAL_DISTANCE_CM / larguraFrameCm) * W;
    expect(fovHorizontalDeg(iodPx, W, dist)).toBeCloseTo(fov, 6);
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
        const conteudo = semComentario.trim();
        // `*` pega as linhas de continuação do JSDoc; `/*` pega a de abertura
        // (inclusive `/** ... */` de uma linha).
        if (conteudo.startsWith('*') || conteudo.startsWith('/*')) return;
        // `9.0` ou `6.3` como VALOR, não como parte de outro número
        // (0.9, 19.0, 6.35 não contam) e não como sufixo de um identificador
        // (a letra na lookbehind evita falsos positivos como `X6.3`).
        if (/(?<![\d.A-Za-z])(9\.0|6\.3)(?![\d])/.test(semComentario)) {
          infratores.push(`${arquivo.replace(raiz, 'src')}:${i + 1}: ${linha.trim()}`);
        }
      });
    }

    expect(infratores).toEqual([]);
  });
});

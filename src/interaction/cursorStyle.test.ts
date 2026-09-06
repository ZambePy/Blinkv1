import { describe, it, expect } from 'vitest';
import {
  estiloDoCursor,
  limitarTamanho,
  contrasteWCAG,
  CURSOR_TAMANHOS,
  CURSOR_TAMANHO_MIN_PX,
  CURSOR_TAMANHO_MAX_PX,
  CURSOR_TAMANHO_PADRAO,
  ANEL_CLARO,
  ANEL_ESCURO,
  type EstadoDoCursor,
  type RGB,
} from './cursorStyle';

// -----------------------------------------------------------------------------
// Cursor de alto contraste com tamanho ajustável.
// -----------------------------------------------------------------------------

const E = (tamanhoPx: number, estado: EstadoDoCursor = 'normal', dwellPct = 0) =>
  estiloDoCursor({ tamanhoPx, estado, dwellPct });

describe('o offset acompanha o tamanho — o bug que o ajuste introduziria', () => {
  it('offset é SEMPRE metade do diâmetro', () => {
    // O `GazeContext` desenha em `x - offset`. Com `width:48px` e um `-24`
    // escrito à mão no outro arquivo, tornar o tamanho ajustável desloca o
    // cursor de `(tamanho-48)/2` px do ponto olhado.
    for (const px of [24, 32, 48, 72, 96, 128]) {
      expect(E(px).offsetPx).toBe(px / 2);
    }
  });

  it('nenhum tamanho oferecido produz offset de 24 por acidente', () => {
    // Se só o `medio` (48 px) fosse testado, um `offsetPx: 24` constante
    // passaria — e o defeito apareceria exatamente nos tamanhos grandes, que
    // são os que os pacientes com baixa visão vão escolher.
    const offsets = Object.values(CURSOR_TAMANHOS).map((px) => E(px).offsetPx);
    expect(new Set(offsets).size).toBe(Object.keys(CURSOR_TAMANHOS).length);
  });

  it('o erro de centralização de um offset fixo seria grande o bastante para ser lido como calibração', () => {
    // Documenta a MAGNITUDE: no maior tamanho, um offset preso em 24 px
    // colocaria o cursor 24 px fora — na mesma ordem do erro angular que o
    // projeto inteiro tenta reduzir. Não é um detalhe cosmético.
    const desvio = E(CURSOR_TAMANHOS.enorme).offsetPx - 24;
    expect(desvio).toBe(24);
  });
});

describe('a faixa de tamanhos', () => {
  it('todos os tamanhos oferecidos estão dentro da faixa', () => {
    for (const px of Object.values(CURSOR_TAMANHOS)) {
      expect(px).toBeGreaterThanOrEqual(CURSOR_TAMANHO_MIN_PX);
      expect(px).toBeLessThanOrEqual(CURSOR_TAMANHO_MAX_PX);
    }
  });

  it('o default é o tamanho de hoje (48 px) — a flag não muda o visual de ninguém', () => {
    expect(CURSOR_TAMANHOS[CURSOR_TAMANHO_PADRAO]).toBe(48);
  });

  it('valores fora da faixa são presos, não rejeitados', () => {
    // Um `NaN` vindo de um `localStorage` corrompido não pode derrubar o
    // cursor: sem cursor, o paciente não tem como chegar às configurações
    // para consertar o valor que quebrou o cursor.
    expect(limitarTamanho(4)).toBe(CURSOR_TAMANHO_MIN_PX);
    expect(limitarTamanho(9999)).toBe(CURSOR_TAMANHO_MAX_PX);
    expect(limitarTamanho(NaN)).toBe(CURSOR_TAMANHOS[CURSOR_TAMANHO_PADRAO]);
    expect(limitarTamanho(Infinity)).toBe(CURSOR_TAMANHOS[CURSOR_TAMANHO_PADRAO]);
  });

  it('o piso fica acima do jitter residual do rastreamento', () => {
    // Abaixo de ~24 px o cursor é menor que o próprio tremor e vira um ponto
    // piscando, que se lê como defeito do sistema.
    expect(CURSOR_TAMANHO_MIN_PX).toBeGreaterThanOrEqual(24);
  });
});

describe('alto contraste é uma razão medida, não uma cor escolhida', () => {
  it('os dois anéis contrastam entre si acima de 7:1 (WCAG AAA)', () => {
    expect(contrasteWCAG(ANEL_CLARO, ANEL_ESCURO)).toBeGreaterThan(7);
  });

  it('sobre QUALQUER fundo, pelo menos um dos anéis contrasta ≥ 3:1', () => {
    // Esta é a propriedade que o anel duplo compra e que nenhuma cor única
    // compra. Varre o cubo RGB e exige que o melhor dos dois anéis passe do
    // limiar de componente gráfico não-textual da WCAG.
    let pior = Infinity;
    let piorFundo: RGB = { r: 0, g: 0, b: 0 };
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const fundo = { r, g, b };
          const melhor = Math.max(
            contrasteWCAG(fundo, ANEL_CLARO),
            contrasteWCAG(fundo, ANEL_ESCURO),
          );
          if (melhor < pior) { pior = melhor; piorFundo = fundo; }
        }
      }
    }
    expect(pior, `pior fundo: rgb(${piorFundo.r},${piorFundo.g},${piorFundo.b})`)
      .toBeGreaterThanOrEqual(3);
  });

  it('o vermelho translúcido de hoje NÃO passa nesse critério', () => {
    // O teste que justifica a mudança. Sobre o botão de emergência (vermelho),
    // o cursor atual some — e o botão de emergência é o alvo onde some é o
    // pior lugar para sumir.
    const cursorAtual: RGB = { r: 239, g: 68, b: 68 };
    const botaoEmergencia: RGB = { r: 220, g: 38, b: 38 };
    expect(contrasteWCAG(cursorAtual, botaoEmergencia)).toBeLessThan(1.5);
  });

  it('o anel sai no estilo, em todos os estados', () => {
    // Se o anel dependesse do estado, o cursor perderia o contraste
    // justamente em `degradado` — quando ele é mais difícil de achar.
    for (const estado of ['normal', 'sobreAlvo', 'degradado', 'segurando'] as const) {
      const s = E(48, estado, 0.5);
      expect(s.anel).toContain('250,250,250');
      expect(s.anel).toContain('17,17,17');
    }
  });
});

describe('o preenchimento sinaliza o estado', () => {
  it('sobre alvo fica verde e escurece com o progresso', () => {
    const inicio = E(48, 'sobreAlvo', 0);
    const fim = E(48, 'sobreAlvo', 1);
    expect(inicio.preenchimento).toContain('34,197,94');
    expect(inicio.preenchimento).not.toBe(fim.preenchimento);
  });

  it('degradado e segurando são visualmente distintos entre si', () => {
    // `degradado` = a predição falhou, o cursor está sobre o nariz.
    // `segurando` = o rosto sumiu e esta é a última posição conhecida.
    // São causas diferentes com ações diferentes; a mesma cor faria o cuidador
    // tratar as duas do mesmo jeito.
    expect(E(48, 'degradado').preenchimento).not.toBe(E(48, 'segurando').preenchimento);
  });

  it('degradado e segurando são tracejados; normal e sobreAlvo não', () => {
    expect(E(48, 'degradado').tracejado).toBe(true);
    expect(E(48, 'segurando').tracejado).toBe(true);
    expect(E(48, 'normal').tracejado).toBe(false);
    expect(E(48, 'sobreAlvo').tracejado).toBe(false);
  });
});

describe('a escala do dwell não desloca o centro', () => {
  it('só cresce sobre alvo', () => {
    expect(E(48, 'normal', 0.9).escala).toBe(1);
    expect(E(48, 'sobreAlvo', 0).escala).toBe(1);
    expect(E(48, 'sobreAlvo', 1).escala).toBeGreaterThan(1);
  });

  it('o offset NÃO muda com a escala', () => {
    // `transform-origin: center center` faz a escala crescer em volta do
    // centro. Se o offset também mudasse, a correção seria aplicada duas vezes
    // e o cursor derivaria enquanto o dwell enche — um movimento que o
    // paciente tenta perseguir com o olhar, quebrando o próprio dwell.
    expect(E(48, 'sobreAlvo', 0).offsetPx).toBe(E(48, 'sobreAlvo', 1).offsetPx);
  });

  it('dwellPct fora de 0–1 é preso', () => {
    expect(E(48, 'sobreAlvo', 5).escala).toBe(E(48, 'sobreAlvo', 1).escala);
    expect(E(48, 'sobreAlvo', -3).escala).toBe(1);
  });
});

describe('determinismo', () => {
  it('a mesma entrada produz o mesmo estilo', () => {
    expect(E(72, 'sobreAlvo', 0.4)).toEqual(E(72, 'sobreAlvo', 0.4));
  });
});

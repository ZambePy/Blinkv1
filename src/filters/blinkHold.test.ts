import { describe, it, expect } from 'vitest';
import { BlinkHold, BLINK_HOLD_MAX_MS } from './blinkHold';
import { Kalman2D } from './kalman2d';

// -----------------------------------------------------------------------------
// P6.3 — hold on blink.
//
// Aceite: piscada de 200 ms com cursor congelado e dwell preservado; olho
// fechado por 3 s com o hold expirando em 2 s e o sistema entrando em fallback.
// -----------------------------------------------------------------------------

const DT = 1 / 30;

/** Kalman treinado numa trajetória de velocidade conhecida. */
function kalmanEmMovimento(velocidadePxPorSeg: number): Kalman2D {
  const k = new Kalman2D({ predictAheadFrames: 0 });
  for (let i = 0; i < 90; i++) {
    k.filter(100 + velocidadePxPorSeg * i * DT, 300, DT);
  }
  return k;
}

describe('o teto é o da especificação', () => {
  it('2 segundos', () => {
    expect(BLINK_HOLD_MAX_MS).toBe(2000);
  });
});

describe('piscada de 200 ms', () => {
  it('congela na predição do Kalman e PRESERVA o dwell', () => {
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    const posicoes: Array<{ x: number; y: number }> = [];

    for (let t = 0; t <= 200; t += 33) {
      const r = h.update(true, 1000 + t, k);
      expect(r.estado).toBe('segurando');
      expect(r.preservarDwell).toBe(true);
      expect(r.posicao).not.toBeNull();
      posicoes.push(r.posicao!);
    }

    // A posição não fica PARADA: ela segue a velocidade que o Kalman aprendeu.
    // Congelar no último valor emitido travaria o cursor no meio de uma sacada.
    expect(posicoes[posicoes.length - 1].x).toBeGreaterThan(posicoes[0].x);
  });

  it('a projeção anda na velocidade aprendida, não em outra', () => {
    const velocidade = 400;
    const k = kalmanEmMovimento(velocidade);
    const h = new BlinkHold();
    const p0 = h.update(true, 1000, k).posicao!;
    const p1 = h.update(true, 1000 + 330, k).posicao!;  // 330 ms depois
    // 330 ms × 400 px/s = 132 px. Tolerância larga porque a velocidade
    // estimada pelo Kalman não é exatamente a nominal.
    expect(p1.x - p0.x).toBeCloseTo(velocidade * 0.33, -1);
  });

  it('ao terminar a piscada, volta a normal imediatamente', () => {
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    h.update(true, 1000, k);
    h.update(true, 1100, k);
    const r = h.update(false, 1200, k);
    expect(r.estado).toBe('normal');
    expect(r.duracaoMs).toBe(0);
    expect(h.segurando).toBe(false);
  });

  it('piscadas separadas são episódios independentes', () => {
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    h.update(true, 1000, k);
    h.update(true, 1200, k);
    h.update(false, 1300, k);
    // Segunda piscada, 5 s depois: a duração recomeça do zero, senão a
    // primeira consumiria o teto da segunda.
    const r = h.update(true, 6000, k);
    expect(r.duracaoMs).toBe(0);
    expect(r.estado).toBe('segurando');
  });
});

describe('olho fechado por 3 s', () => {
  it('o hold EXPIRA em 2 s e o dwell deixa de ser preservado', () => {
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    const estados: string[] = [];
    for (let t = 0; t <= 3000; t += 100) {
      estados.push(h.update(true, 1000 + t, k).estado);
    }
    // Antes de 2 s: segurando. Depois: expirado.
    expect(estados[0]).toBe('segurando');
    expect(estados[19]).toBe('segurando');   // t = 1900 ms
    expect(estados[21]).toBe('expirado');    // t = 2100 ms
    expect(estados[estados.length - 1]).toBe('expirado');
  });

  it('expirado NÃO devolve posição — não se afirma o que ninguém mediu', () => {
    // Devolver a última projeção seria afirmar, com confiança total, uma
    // posição extrapolada de uma medição de mais de dois segundos atrás. É
    // exatamente o padrão de defeito que este repositório combate.
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    const r = h.update(true, 1000, k);
    expect(r.posicao).not.toBeNull();
    const expirado = h.update(true, 1000 + BLINK_HOLD_MAX_MS + 1, k);
    expect(expirado.posicao).toBeNull();
    expect(expirado.preservarDwell).toBe(false);
  });

  it('reabrir depois de expirar volta a normal', () => {
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    h.update(true, 1000, k);
    h.update(true, 4000, k);
    expect(h.update(false, 4100, k).estado).toBe('normal');
  });
});

describe('a distinção que B2.5 deixou pendente', () => {
  it('durante o hold o dwell é preservado; depois do teto, não', () => {
    // O dwell precisa distinguir "piscada" de "perdi o rosto". Durante o hold
    // a posição é confiável (vem do modelo), então o progresso continua.
    // Depois do teto é ausência de verdade, e o progresso não pode continuar.
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    expect(h.update(true, 1000, k).preservarDwell).toBe(true);
    expect(h.update(true, 1500, k).preservarDwell).toBe(true);
    expect(h.update(true, 3500, k).preservarDwell).toBe(false);
  });
});

describe('guardas', () => {
  it('o hold NÃO avança o estado do Kalman', () => {
    // Se avançasse, o hold reescreveria o modelo com dados que não existem, e
    // ao reabrir o olho o filtro estaria convencido de uma posição inventada.
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    const antes = k.state;
    for (let t = 0; t <= 1000; t += 33) h.update(true, 1000 + t, k);
    expect(k.state).toEqual(antes);
  });

  it('piscada antes de o Kalman ter estado: segura, mas sem posição', () => {
    const k = new Kalman2D();
    const h = new BlinkHold();
    const r = h.update(true, 1000, k);
    expect(r.estado).toBe('segurando');
    expect(r.posicao).toBeNull();
    // Ainda assim preserva o dwell: é piscada, não perda de rosto.
    expect(r.preservarDwell).toBe(true);
  });

  it('reset encerra o episódio', () => {
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold();
    h.update(true, 1000, k);
    h.reset();
    expect(h.segurando).toBe(false);
    expect(h.update(true, 5000, k).duracaoMs).toBe(0);
  });

  it('teto configurável, para o benchmark varrer', () => {
    const k = kalmanEmMovimento(400);
    const h = new BlinkHold({ maxMs: 500 });
    expect(h.update(true, 1000, k).estado).toBe('segurando');
    expect(h.update(true, 1600, k).estado).toBe('expirado');
  });

  it('é determinístico', () => {
    const rodar = () => {
      const k = kalmanEmMovimento(400);
      const h = new BlinkHold();
      const out = [];
      for (let t = 0; t <= 900; t += 100) out.push(h.update(true, 1000 + t, k));
      return out;
    };
    expect(rodar()).toEqual(rodar());
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  completeCalibration, getCalibrationTargets, getCollectionMsForPoint,
  duracaoTotalDoPonto,
} from './calibration';
import { startAccuracyTest, feedAccuracyRaw, type AccuracyResult } from './accuracy';

// O fluxo do teste de precisão nunca era exercitado: as telas o mockam e o
// módulo só era testado por partes. Este arquivo dirige o teste inteiro —
// overlay, coleta ponto a ponto e painel final — com relógio e rAF sob
// controle, que é a única forma de ver a transição travar.

const qualidade = () => ({
  yaw: 0.1, pitch: -0.05, roll: 0.01,
  irisVisibilityPercentage: 1, detectorConfidence: 0.99,
  brightnessEstimate: 0.24, contrastEstimate: 0.09, blurEstimate: 0,
});

let relogio = 0;
/** Quadros de vídeo pendentes: o rAF do módulo é servido manualmente. */
let rafQueue: FrameRequestCallback[] = [];

function avancar(ms: number, passo = 16) {
  for (let t = 0; t < ms; t += passo) {
    relogio += passo;
    vi.advanceTimersByTime(passo);
    const fila = rafQueue;
    rafQueue = [];
    for (const cb of fila) cb(relogio);
  }
}

/** Vetor de features com bloco angular válido (posições 4 e 5). */
function vetor(x: number, y: number, ruido: () => number, fase = 0) {
  return Array.from({ length: 6 }, (_, d) =>
    Math.sin(d * 1.7 + 0.3 + fase) * x + Math.cos(d * 2.3 + 1.1 + fase) * y
    + ruido() * 0.002 + (d >= 4 ? 0.3 : 0));
}

function calibrar() {
  let semente = 7;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
  startCalibrationMode();
  for (const t of getCalibrationTargets()) {
    startCollectingPoint(t.x, t.y, () => {});
    const total = duracaoTotalDoPonto(getCollectionMsForPoint(t.x, t.y));
    // +200 ms de folga para o último frame fechar o ponto.
    for (let ms = 0; ms <= total + 200; ms += 40) {
      relogio += 40;
      feedRawData(vetor(t.x, t.y, rnd), vetor(t.x, t.y, rnd, 0.2), qualidade());
    }
  }
  let outcome: { ok: boolean } | null = null;
  completeCalibration((o) => { outcome = o as { ok: boolean }; });
  return outcome;
}

describe('teste de precisão — fluxo completo', () => {
  beforeEach(() => {
    relogio = 0;
    rafQueue = [];
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => relogio);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    document.body.innerHTML = '';
    clearCalibration();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a calibração treina com os 9 alvos', () => {
    const outcome = calibrar();
    expect(outcome).toEqual({ ok: true });
  });

  it('o overlay aparece e o teste percorre os 13 pontos até o painel final', () => {
    expect(calibrar()).toEqual({ ok: true });

    let resultado: AccuracyResult | null = null;
    startAccuracyTest((r) => { resultado = r; });

    // O overlay tem de existir IMEDIATAMENTE: é ele que cobre a tela de
    // "Iniciando teste de precisão". Sem isso o usuário fica olhando o spinner.
    expect(document.getElementById('accuracy-overlay')).not.toBeNull();

    let semente = 99;
    const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };

    // 1,5 s de preparo + 13 pontos × (2000 ms de coleta + 300 ms entre pontos).
    const erros: string[] = [];
    for (let i = 0; i < 2400; i++) {
      relogio += 16;
      try { vi.advanceTimersByTime(16); } catch (e) { erros.push(`timer: ${String(e)}`); }
      const fila = rafQueue;
      rafQueue = [];
      for (const cb of fila) { try { cb(relogio); } catch (e) { erros.push(`raf: ${(e as Error).stack ?? String(e)}`); } }
      feedAccuracyRaw(vetor(0.5, 0.5, rnd), vetor(0.5, 0.5, rnd, 0.2), undefined,
        { yaw: 0.1, pitch: -0.05, roll: 0.01 });
    }

    expect(erros, erros.slice(0, 2).join('\n---\n')).toHaveLength(0);
    // O ponto sumiu e o painel de diagnóstico tomou a tela.
    expect(document.getElementById('accuracy-overlay')).toBeNull();
    expect(document.querySelector('.diagnostic-overlay')).not.toBeNull();
    expect(resultado).toBeNull(); // só sai quando o operador decide

    const continuar = document.querySelector<HTMLButtonElement>('.diagnostic-btn');
    expect(continuar).not.toBeNull();
    continuar!.click();
    // O painel some com 300 ms de transição antes de devolver o resultado.
    vi.advanceTimersByTime(400);
    expect(resultado).not.toBeNull();
  });

  it('se a cadeia de quadros morrer, o teste encerra com o motivo em vez de congelar', () => {
    expect(calibrar()).toEqual({ ok: true });

    let resultado: AccuracyResult | null = null;
    startAccuracyTest((r) => { resultado = r; });
    expect(document.getElementById('accuracy-overlay')).not.toBeNull();

    // Nenhum rAF é servido: é o que acontece quando uma exceção mata a cadeia
    // ou o compositor para de entregar quadros. Só os timers continuam.
    rafQueue = [];
    for (let i = 0; i < 40; i++) {
      relogio += 1000;
      vi.advanceTimersByTime(1000);
      rafQueue = [];
    }

    expect(document.getElementById('accuracy-overlay')).toBeNull();
    const painel = document.querySelector('.diagnostic-overlay');
    expect(painel).not.toBeNull();
    expect(painel!.textContent).toContain('interrompido');

    document.querySelector<HTMLButtonElement>('.diagnostic-btn')!.click();
    vi.advanceTimersByTime(400);
    expect(resultado).not.toBeNull();
    expect(resultado!.pontosMedidos).toBe(0);
  });
});

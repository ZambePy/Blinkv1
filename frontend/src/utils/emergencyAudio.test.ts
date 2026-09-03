import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSharedAudioContext,
  playTickSound,
  playCancelSound,
  disposeSharedAudioContext,
} from './emergencyAudio';

// -----------------------------------------------------------------------------
// B2.13 — `AudioContext` vazando na emergência: o alarme sonoro morre no meio
//         da sessão.
//
// `EmergencyContext` fazia `new AudioCtx()` a cada tick da contagem regressiva
// (5 por acionamento) mais um por cancelamento, e **nunca** chamava
// `ctx.close()`.
//
// O Chromium limita ~50 AudioContexts por documento. Após ~8 acionamentos numa
// sessão, `new AudioCtx()` passa a LANÇAR — dentro de um `try {} catch {}`
// silencioso. **O feedback sonoro da emergência some pelo resto da sessão sem
// nenhum sinal**, justamente o canal que avisa o cuidador.
//
// O agravante é o timing: a falha aparece depois de VÁRIOS acionamentos, ou
// seja, num dia em que o paciente já está precisando de ajuda com frequência.
// -----------------------------------------------------------------------------

/** Conta quantos AudioContexts foram construídos, como o Chromium faria. */
let construidos = 0;
let fechados = 0;
const LIMITE_CHROMIUM = 50;

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {} as AudioDestinationNode;

  constructor() {
    construidos++;
    if (construidos - fechados > LIMITE_CHROMIUM) {
      // Reproduz fielmente o comportamento do Chromium ao estourar o limite.
      throw new DOMException('Failed to construct AudioContext', 'NotSupportedError');
    }
  }

  createOscillator() {
    return {
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { fechados++; this.state = 'closed'; return Promise.resolve(); }
}

beforeEach(() => {
  construidos = 0;
  fechados = 0;
  disposeSharedAudioContext();
  construidos = 0;
  fechados = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  disposeSharedAudioContext();
  vi.unstubAllGlobals();
});

describe('B2.13 — um único AudioContext para a sessão inteira', () => {
  it('a primeira chamada cria o contexto', () => {
    expect(getSharedAudioContext()).not.toBeNull();
    expect(construidos).toBe(1);
  });

  it('chamadas seguintes reutilizam o mesmo contexto', () => {
    const a = getSharedAudioContext();
    const b = getSharedAudioContext();
    expect(b).toBe(a);
    expect(construidos).toBe(1);
  });

  it('100 bipes consomem UM contexto, não 100', () => {
    // Antes: cada bipe era um `new AudioCtx()`. 100 bipes = 100 contextos, e o
    // Chromium já teria lançado no 51º.
    for (let i = 0; i < 100; i++) playTickSound();
    expect(construidos).toBe(1);
  });

  it('20 acionamentos completos não estouram o limite do Chromium', () => {
    // Cada acionamento = 5 ticks da contagem + 1 cancelamento = 6 contextos no
    // código antigo. 20 acionamentos = 120 contextos; o som morria por volta do
    // 8º acionamento e não voltava mais.
    for (let acionamento = 0; acionamento < 20; acionamento++) {
      for (let tick = 0; tick < 5; tick++) playTickSound();
      playCancelSound();
    }
    expect(construidos).toBe(1);
    expect(construidos).toBeLessThan(LIMITE_CHROMIUM);
  });

  it('o som continua funcionando depois de muitos acionamentos', () => {
    // A asserção que descreve o sintoma pelo nome: o feedback sonoro NÃO pode
    // sumir no meio da sessão.
    for (let i = 0; i < 200; i++) playTickSound();
    expect(getSharedAudioContext()).not.toBeNull();
    expect(getSharedAudioContext()!.state).not.toBe('closed');
  });
});

describe('B2.13 — degradação graciosa', () => {
  it('sem WebAudio, tocar som é no-op e não lança', () => {
    vi.stubGlobal('AudioContext', undefined);
    disposeSharedAudioContext();
    expect(getSharedAudioContext()).toBeNull();
    expect(() => playTickSound()).not.toThrow();
    expect(() => playCancelSound()).not.toThrow();
  });

  it('construtor que lança não derruba o chamador', () => {
    // Autoplay policy pode bloquear a criação antes do primeiro gesto. O
    // acionamento da emergência não pode falhar por causa do bipe.
    class Explode {
      constructor() { throw new Error('autoplay bloqueado'); }
    }
    vi.stubGlobal('AudioContext', Explode);
    disposeSharedAudioContext();
    expect(() => playTickSound()).not.toThrow();
    expect(getSharedAudioContext()).toBeNull();
  });

  it('um contexto fechado é recriado na próxima chamada', () => {
    const a = getSharedAudioContext()!;
    void a.close();
    const b = getSharedAudioContext();
    expect(b).not.toBe(a);
    expect(b).not.toBeNull();
  });

  it('contexto suspenso é retomado ao tocar', () => {
    const ctx = getSharedAudioContext() as unknown as FakeAudioContext;
    ctx.state = 'suspended';
    playTickSound();
    expect(ctx.state).toBe('running');
  });
});

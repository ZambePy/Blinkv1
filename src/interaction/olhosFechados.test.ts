import { describe, expect, it } from 'vitest';
import { BLINK_HOLD_MAX_MS } from '../filters/blinkHold';
import {
  ABERTO_PARA_LIMPAR_MS,
  DetectorDeOlhosFechados,
  FECHADO_ATE_AVISAR_MS,
} from './olhosFechados';

const fechado = (tMs: number) => ({ estado: 'closed' as const, temRosto: true, tMs });
const aberto = (tMs: number) => ({ estado: 'open' as const, temRosto: true, tMs });

describe('detector de olhos fechados', () => {
  it('o limiar fica acima do teto do blinkHold — antes disso o hold ainda projeta', () => {
    expect(FECHADO_ATE_AVISAR_MS).toBeGreaterThan(BLINK_HOLD_MAX_MS);
  });

  it('piscada normal não vira aviso', () => {
    const d = new DetectorDeOlhosFechados();
    d.avaliar(fechado(0));
    // 100–400 ms é a faixa de uma piscada.
    expect(d.avaliar(fechado(350)).avisar).toBe(false);
    expect(d.avaliar(aberto(400)).avisar).toBe(false);
  });

  it('olho fechado além do limiar avisa, e a mensagem diz o que fazer', () => {
    const d = new DetectorDeOlhosFechados();
    d.avaliar(fechado(0));
    const v = d.avaliar(fechado(FECHADO_ATE_AVISAR_MS));
    expect(v.avisar).toBe(true);
    expect(v.mensagem).toContain('levante um pouco o olhar');
    expect(v.duracaoMs).toBe(FECHADO_ATE_AVISAR_MS);
  });

  it('some quando os olhos reabrem, com um respiro para não piscar', () => {
    const d = new DetectorDeOlhosFechados();
    d.avaliar(fechado(0));
    expect(d.avaliar(fechado(FECHADO_ATE_AVISAR_MS)).avisar).toBe(true);
    // Um quadro aberto ainda não desfaz o aviso…
    expect(d.avaliar(aberto(FECHADO_ATE_AVISAR_MS + 30)).avisar).toBe(true);
    // …mas um quarto de segundo aberto, sim.
    expect(d.avaliar(aberto(FECHADO_ATE_AVISAR_MS + 30 + ABERTO_PARA_LIMPAR_MS)).avisar).toBe(false);
  });

  it('sem rosto o assunto é outro', () => {
    const d = new DetectorDeOlhosFechados();
    d.avaliar(fechado(0));
    d.avaliar(fechado(FECHADO_ATE_AVISAR_MS));
    expect(d.avaliar({ estado: 'closed', temRosto: false, tMs: FECHADO_ATE_AVISAR_MS + 10 }).avisar).toBe(false);
  });

  it('estado desconhecido não gera palpite', () => {
    const d = new DetectorDeOlhosFechados();
    for (let t = 0; t <= FECHADO_ATE_AVISAR_MS * 2; t += 100) {
      expect(d.avaliar({ estado: 'unknown', temRosto: true, tMs: t }).avisar).toBe(false);
    }
  });

  it('sequência de piscadas curtas não soma até o aviso', () => {
    const d = new DetectorDeOlhosFechados();
    let t = 0;
    for (let i = 0; i < 12; i++) {
      d.avaliar(fechado(t));
      t += 300;
      d.avaliar(fechado(t));
      t += 50;
      d.avaliar(aberto(t));
      t += ABERTO_PARA_LIMPAR_MS + 50;
      expect(d.avaliar(aberto(t)).avisar).toBe(false);
      t += 100;
    }
  });
});

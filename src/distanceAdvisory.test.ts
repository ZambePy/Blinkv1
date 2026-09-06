import { describe, it, expect } from 'vitest';
import {
  AvisoDeDistancia,
  mensagemPara,
  FAIXA_PROVISORIA_PCT,
  HISTERESE_PCT,
} from './distanceAdvisory';

// -----------------------------------------------------------------------------
// Aviso de distância fora de faixa: os três estados (dentro / fora para perto /
// fora para longe), a histerese, e o texto do banner dizendo a DIREÇÃO CORRETA.
//
// A direção é onde é fácil errar: quem está PERTO demais precisa se AFASTAR.
// Um banner que diz o contrário piora a situação com confiança.
// -----------------------------------------------------------------------------

const CALIB = 60; // cm

describe('a faixa é provisória e está declarada', () => {
  it('±15%, com histerese menor que ela', () => {
    expect(FAIXA_PROVISORIA_PCT).toBe(0.15);
    expect(HISTERESE_PCT).toBeGreaterThan(0);
    expect(HISTERESE_PCT).toBeLessThan(FAIXA_PROVISORIA_PCT);
  });
});

describe('os três estados', () => {
  it('dentro da faixa: nenhum aviso', () => {
    const a = new AvisoDeDistancia();
    for (const d of [60, 55, 65, 52, 68]) {
      const r = a.avaliar(d, CALIB);
      expect(r.estado).toBe('dentro');
      expect(r.mensagem).toBeNull();
    }
  });

  it('perto demais: avisa para AFASTAR', () => {
    const a = new AvisoDeDistancia();
    const r = a.avaliar(45, CALIB);   // −25%
    expect(r.estado).toBe('perto');
    expect(r.desvioRelativo).toBeCloseTo(-0.25, 6);
    expect(r.mensagem).toMatch(/afaste/i);
    // E NÃO pode dizer para aproximar.
    expect(r.mensagem).not.toMatch(/aproxime/i);
  });

  it('longe demais: avisa para APROXIMAR', () => {
    const a = new AvisoDeDistancia();
    const r = a.avaliar(80, CALIB);   // +33%
    expect(r.estado).toBe('longe');
    expect(r.desvioRelativo).toBeCloseTo(0.3333, 3);
    expect(r.mensagem).toMatch(/aproxime/i);
    expect(r.mensagem).not.toMatch(/afaste/i);
  });

  it('a direção da AÇÃO é o oposto do desvio — o erro fácil de cometer', () => {
    expect(mensagemPara('perto')).toMatch(/afaste/i);
    expect(mensagemPara('longe')).toMatch(/aproxime/i);
  });

  it('o texto não traz o percentual — ele é provisório', () => {
    // Comunicar "16% fora" transmitiria uma precisão que o número não tem: a
    // faixa é provisória e ainda não foi medida.
    for (const e of ['perto', 'longe'] as const) {
      expect(mensagemPara(e)).not.toMatch(/\d+\s*%/);
    }
  });

  it('o texto diz o que FAZER, não o que está errado', () => {
    for (const e of ['perto', 'longe'] as const) {
      expect(mensagemPara(e)).toMatch(/precisão|precisao/i);
    }
  });
});

describe('histerese — o banner não pisca', () => {
  it('sair exige cruzar 15%; voltar exige retornar a 12%', () => {
    const a = new AvisoDeDistancia();
    // 14% longe: ainda dentro.
    expect(a.avaliar(CALIB * 1.14, CALIB).estado).toBe('dentro');
    // 16%: sai.
    expect(a.avaliar(CALIB * 1.16, CALIB).estado).toBe('longe');
    // 13,5%: ainda avisando — não voltou o suficiente.
    expect(a.avaliar(CALIB * 1.135, CALIB).estado).toBe('longe');
    // 11%: volta.
    expect(a.avaliar(CALIB * 1.11, CALIB).estado).toBe('dentro');
  });

  it('oscilação em torno do limiar NÃO alterna o estado', () => {
    // É o caso que a histerese existe para resolver: alguém parado exatamente
    // no limiar, com a distância variando por respiração e postura.
    const a = new AvisoDeDistancia();
    a.avaliar(CALIB * 1.16, CALIB);   // entra em 'longe'
    const estados: string[] = [];
    for (let i = 0; i < 20; i++) {
      const d = CALIB * (i % 2 === 0 ? 1.145 : 1.155);
      estados.push(a.avaliar(d, CALIB).estado);
    }
    expect(new Set(estados).size).toBe(1);
    expect(estados[0]).toBe('longe');
  });

  it('`mudou` só é true na TRANSIÇÃO', () => {
    const a = new AvisoDeDistancia();
    expect(a.avaliar(60, CALIB).mudou).toBe(true);       // desconhecido → dentro
    expect(a.avaliar(60, CALIB).mudou).toBe(false);
    expect(a.avaliar(40, CALIB).mudou).toBe(true);       // dentro → perto
    expect(a.avaliar(41, CALIB).mudou).toBe(false);
  });

  it('vale nos dois sentidos', () => {
    const a = new AvisoDeDistancia();
    expect(a.avaliar(CALIB * 0.84, CALIB).estado).toBe('perto');
    expect(a.avaliar(CALIB * 0.865, CALIB).estado).toBe('perto');  // 13,5%
    expect(a.avaliar(CALIB * 0.89, CALIB).estado).toBe('dentro');  // 11%
  });
});

describe('sem medição, não se afirma nada', () => {
  it('distância ausente devolve desconhecido, sem mensagem', () => {
    const a = new AvisoDeDistancia();
    for (const [agora, calib] of [[null, 60], [60, null], [null, null]] as const) {
      const r = a.avaliar(agora, calib);
      expect(r.estado).toBe('desconhecido');
      expect(r.mensagem).toBeNull();
      expect(r.desvioRelativo).toBeNull();
    }
  });

  it('valores degenerados também', () => {
    const a = new AvisoDeDistancia();
    expect(a.avaliar(0, 60).estado).toBe('desconhecido');
    expect(a.avaliar(60, 0).estado).toBe('desconhecido');
    expect(a.avaliar(NaN, 60).estado).toBe('desconhecido');
    expect(a.avaliar(60, Infinity).estado).toBe('desconhecido');
  });

  it('perder a medição no meio NÃO deixa o aviso preso', () => {
    // Um banner que fica na tela porque a medição sumiu é pior que nenhum: o
    // cuidador se afasta, o aviso não some, e ele conclui que o app travou.
    const a = new AvisoDeDistancia();
    a.avaliar(40, CALIB);
    expect(a.estado).toBe('perto');
    const r = a.avaliar(null, CALIB);
    expect(r.estado).toBe('desconhecido');
    expect(r.mudou).toBe(true);
  });
});

describe('configuração e ciclo de vida', () => {
  it('a faixa é configurável', () => {
    const estrito = new AvisoDeDistancia({ faixaPct: 0.05 });
    expect(estrito.avaliar(CALIB * 1.08, CALIB).estado).toBe('longe');
    const frouxo = new AvisoDeDistancia({ faixaPct: 0.4 });
    expect(frouxo.avaliar(CALIB * 1.08, CALIB).estado).toBe('dentro');
  });

  it('histerese maior que a faixa é limitada — senão o aviso nunca sairia', () => {
    const a = new AvisoDeDistancia({ faixaPct: 0.1, histerresePct: 0.5 });
    a.avaliar(CALIB * 1.2, CALIB);
    expect(a.estado).toBe('longe');
    // Com histerese clampada à faixa, o limiar de retorno é 0 — voltar exige
    // a distância exata da calibração, mas ainda é ALCANÇÁVEL.
    expect(a.avaliar(CALIB, CALIB).estado).toBe('dentro');
  });

  it('reset volta a desconhecido', () => {
    const a = new AvisoDeDistancia();
    a.avaliar(40, CALIB);
    a.reset();
    expect(a.estado).toBe('desconhecido');
  });

  it('é determinístico', () => {
    const rodar = () => {
      const a = new AvisoDeDistancia();
      return [70, 75, 68, 45, 50, 60].map((d) => a.avaliar(d, CALIB).estado);
    };
    expect(rodar()).toEqual(rodar());
  });
});

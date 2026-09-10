import { describe, expect, it } from 'vitest';
import { avaliarSaturacao } from '../calibration';
import {
  DetectorDeOlharForaDaTela,
  ENTRAR_MS,
  SAIR_MS,
  type AmostraDeSaturacao,
  type DirecaoDeFuga,
} from './olharForaDaTela';

const fora = (direcao: DirecaoDeFuga, tMs: number): AmostraDeSaturacao => ({
  fora: true,
  direcao,
  temRosto: true,
  tMs,
});
const dentro = (tMs: number): AmostraDeSaturacao => ({ fora: false, direcao: null, temRosto: true, tMs });

describe('classificação da saturação', () => {
  it('dentro da tela não satura', () => {
    expect(avaliarSaturacao(0.5, 0.5)).toEqual({ fora: false, direcao: null, excesso: 0 });
    expect(avaliarSaturacao(0, 1)).toEqual({ fora: false, direcao: null, excesso: 0 });
  });

  it('olhar abaixo da borda vira direção "baixo"', () => {
    const s = avaliarSaturacao(0.5, 1.3);
    expect(s.direcao).toBe('baixo');
    expect(s.excesso).toBeCloseTo(0.3);
  });

  it('cada borda tem a sua direção', () => {
    expect(avaliarSaturacao(0.5, -0.2).direcao).toBe('cima');
    expect(avaliarSaturacao(-0.4, 0.5).direcao).toBe('esquerda');
    expect(avaliarSaturacao(1.4, 0.5).direcao).toBe('direita');
  });

  it('escapando nos dois eixos, o maior excesso decide', () => {
    expect(avaliarSaturacao(1.5, 1.1).direcao).toBe('direita');
    expect(avaliarSaturacao(1.1, 1.5).direcao).toBe('baixo');
  });

  it('empate vai para o eixo vertical, que é o caso comum', () => {
    expect(avaliarSaturacao(1.2, 1.2).direcao).toBe('baixo');
  });
});

describe('detector de olhar fora da tela', () => {
  it('não avisa por uma passagem rápida pela borda', () => {
    const d = new DetectorDeOlharForaDaTela();
    expect(d.avaliar(fora('baixo', 0)).avisar).toBe(false);
    expect(d.avaliar(fora('baixo', ENTRAR_MS - 100)).avisar).toBe(false);
    expect(d.avaliar(dentro(ENTRAR_MS)).avisar).toBe(false);
  });

  it('avisa depois de insistir na mesma borda, com texto acionável', () => {
    const d = new DetectorDeOlharForaDaTela();
    d.avaliar(fora('baixo', 0));
    const v = d.avaliar(fora('baixo', ENTRAR_MS));
    expect(v.avisar).toBe(true);
    expect(v.direcao).toBe('baixo');
    expect(v.mensagem).toContain('abaixo da tela');
    expect(v.mensagem).toContain('Levante o olhar');
  });

  it('some depressa quando o olhar volta para a tela', () => {
    const d = new DetectorDeOlharForaDaTela();
    d.avaliar(fora('baixo', 0));
    expect(d.avaliar(fora('baixo', ENTRAR_MS)).avisar).toBe(true);
    // Ainda avisando enquanto o retorno não se confirma…
    expect(d.avaliar(dentro(ENTRAR_MS + 50)).avisar).toBe(true);
    // …e some assim que confirma.
    expect(d.avaliar(dentro(ENTRAR_MS + 50 + SAIR_MS)).avisar).toBe(false);
  });

  it('fuga na diagonal avisa: a direção alterna, o relógio não zera', () => {
    // No canto inferior direito os dois excessos ficam próximos e o desempate
    // alterna com o ruído. Se a contagem reiniciasse a cada alternância, o
    // aviso nunca sairia — que era o defeito da primeira versão.
    const d = new DetectorDeOlharForaDaTela();
    let t = 0;
    let ultimo = d.avaliar(fora('baixo', t));
    for (let i = 0; i < 20; i++) {
      t += 33;
      ultimo = d.avaliar(fora(i % 2 === 0 ? 'direita' : 'baixo', t));
    }
    expect(t).toBeGreaterThan(ENTRAR_MS);
    expect(ultimo.avisar).toBe(true);
    expect(['baixo', 'direita']).toContain(ultimo.direcao);
  });

  it('a direção do aviso congela depois que ele aparece', () => {
    const d = new DetectorDeOlharForaDaTela();
    d.avaliar(fora('baixo', 0));
    expect(d.avaliar(fora('baixo', ENTRAR_MS)).direcao).toBe('baixo');
    // Um quadro de ruído dizendo "direita" não pode trocar o texto na cara do
    // paciente enquanto ele lê.
    expect(d.avaliar(fora('direita', ENTRAR_MS + 33)).direcao).toBe('baixo');
  });

  it('voltar para dentro e sair de novo permite uma direção nova', () => {
    const d = new DetectorDeOlharForaDaTela();
    d.avaliar(fora('baixo', 0));
    expect(d.avaliar(fora('baixo', ENTRAR_MS)).avisar).toBe(true);
    d.avaliar(dentro(ENTRAR_MS + 10));
    expect(d.avaliar(dentro(ENTRAR_MS + 10 + SAIR_MS)).avisar).toBe(false);
    const t = ENTRAR_MS + 10 + SAIR_MS;
    d.avaliar(fora('direita', t));
    expect(d.avaliar(fora('direita', t + ENTRAR_MS)).direcao).toBe('direita');
  });

  it('sem rosto o assunto é outro: nada de aviso de borda', () => {
    const d = new DetectorDeOlharForaDaTela();
    d.avaliar(fora('baixo', 0));
    d.avaliar(fora('baixo', ENTRAR_MS));
    const v = d.avaliar({ fora: true, direcao: 'baixo', temRosto: false, tMs: ENTRAR_MS + 10 });
    expect(v.avisar).toBe(false);
  });

  it('zerar apaga o aviso em curso', () => {
    const d = new DetectorDeOlharForaDaTela();
    d.avaliar(fora('baixo', 0));
    expect(d.avaliar(fora('baixo', ENTRAR_MS)).avisar).toBe(true);
    d.zerar();
    expect(d.avaliar(fora('baixo', ENTRAR_MS + 1)).avisar).toBe(false);
  });
});

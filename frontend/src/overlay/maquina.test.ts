import { describe, it, expect } from 'vitest';
import { ESTADO_INICIAL, reduzir, descricaoDoEstado, type EstadoDaMaquina, type Efeito } from './maquina';

const acoes = (efeitos: Efeito[]) => efeitos.map((e) => (e.tipo === 'acao' ? e.acao : { tipo: e.tipo }));
const P = { x: 400, y: 300 };

function armar(tarefa: 'clique' | 'duplo' | 'direito' | 'arrastar' | 'rolar', base: EstadoDaMaquina = ESTADO_INICIAL) {
  return reduzir(base, { tipo: 'botao', id: tarefa }).estado;
}

describe('armar e executar', () => {
  it('sem tarefa armada, olhar a área não faz nada', () => {
    const r = reduzir(ESTADO_INICIAL, { tipo: 'area', ponto: P });
    expect(r.efeitos).toEqual([]);
  });

  it('clique sem lupa: executa e desarma', () => {
    const e = armar('clique', { ...ESTADO_INICIAL, lupa: false });
    const r = reduzir(e, { tipo: 'area', ponto: P });
    expect(acoes(r.efeitos)).toEqual([{ tipo: 'clique', botao: 'esquerdo', vezes: 1, ponto: P }]);
    expect(r.estado.tarefa).toBeNull();
  });

  it('com "fixar", a tarefa continua armada depois de executar', () => {
    let e = reduzir({ ...ESTADO_INICIAL, lupa: false }, { tipo: 'botao', id: 'fixar' }).estado;
    e = armar('direito', e);
    const r = reduzir(e, { tipo: 'area', ponto: P });
    expect(acoes(r.efeitos)[0]).toMatchObject({ tipo: 'clique', botao: 'direito' });
    expect(r.estado.tarefa).toBe('direito');
  });

  it('armar a mesma tarefa de novo desarma', () => {
    const e = armar('clique');
    expect(reduzir(e, { tipo: 'botao', id: 'clique' }).estado.tarefa).toBeNull();
  });

  it('pausado: a área não responde, a barra sim', () => {
    let e = armar('clique', { ...ESTADO_INICIAL, lupa: false });
    e = reduzir(e, { tipo: 'botao', id: 'pausar' }).estado;
    expect(reduzir(e, { tipo: 'area', ponto: P }).efeitos).toEqual([]);
    expect(reduzir(e, { tipo: 'botao', id: 'pausar' }).estado.pausado).toBe(false);
  });
});

describe('lupa em duas etapas', () => {
  it('primeiro dwell pede a captura; o segundo executa no ponto mapeado', () => {
    const e = armar('clique');
    const r1 = reduzir(e, { tipo: 'area', ponto: P });
    expect(r1.efeitos).toEqual([{ tipo: 'pedirLupa', ponto: P }]);
    expect(r1.estado.fase.tipo).toBe('lupa');

    const regiao = { x: 290, y: 190, width: 220, height: 220 };
    const r2 = reduzir(r1.estado, { tipo: 'lupaPronta', regiao, imagem: 'data:image/png;base64,x' });
    const r3 = reduzir(r2.estado, { tipo: 'lupaAlvo', pontoNoPainel: { x: 275, y: 275 }, painel: { width: 550, height: 550 } });
    expect(acoes(r3.efeitos)).toEqual([{ tipo: 'clique', botao: 'esquerdo', vezes: 1, ponto: { x: 400, y: 300 } }]);
    expect(r3.estado.fase.tipo).toBe('ocioso');
    expect(r3.estado.tarefa).toBeNull();
  });

  it('olhar para fora cancela a lupa e mantém a tarefa armada', () => {
    const e = armar('clique');
    const r1 = reduzir(e, { tipo: 'area', ponto: P });
    const r2 = reduzir(r1.estado, { tipo: 'lupaCancelada' });
    expect(r2.estado.fase.tipo).toBe('ocioso');
    expect(r2.estado.tarefa).toBe('clique');
  });

  it('captura falhou: clica direto no centro pedido', () => {
    const e = armar('duplo');
    const r1 = reduzir(e, { tipo: 'area', ponto: P });
    const r2 = reduzir(r1.estado, { tipo: 'lupaFalhou' });
    expect(acoes(r2.efeitos)).toEqual([{ tipo: 'clique', botao: 'esquerdo', vezes: 2, ponto: P }]);
  });

  it('a lupa não se aplica a arrastar nem rolar', () => {
    const r = reduzir(armar('rolar'), { tipo: 'area', ponto: P });
    expect(r.estado.fase.tipo).toBe('rolando');
  });
});

describe('arrastar', () => {
  it('dois pontos: pressiona no primeiro, move e solta no segundo', () => {
    const e = armar('arrastar');
    const r1 = reduzir(e, { tipo: 'area', ponto: P });
    expect(acoes(r1.efeitos)).toEqual([{ tipo: 'pressionar', botao: 'esquerdo', ponto: P }]);
    expect(r1.estado.tarefa).toBe('arrastar');
    const Q = { x: 700, y: 500 };
    const r2 = reduzir(r1.estado, { tipo: 'area', ponto: Q });
    expect(acoes(r2.efeitos)).toEqual([{ tipo: 'mover', ponto: Q }, { tipo: 'soltar', botao: 'esquerdo', ponto: Q }]);
    expect(r2.estado.tarefa).toBeNull();
  });

  it('mudar de ação no meio do arrasto solta o botão', () => {
    const r1 = reduzir(armar('arrastar'), { tipo: 'area', ponto: P });
    const r2 = reduzir(r1.estado, { tipo: 'botao', id: 'clique' });
    expect(acoes(r2.efeitos)).toEqual([{ tipo: 'soltar', botao: 'esquerdo', ponto: P }]);
    expect(r2.estado.tarefa).toBe('clique');
  });
});

describe('rolar', () => {
  it('olhar abaixo da âncora rola para baixo, com intervalo mínimo', () => {
    const r1 = reduzir(armar('rolar'), { tipo: 'area', ponto: P });
    const r2 = reduzir(r1.estado, { tipo: 'olhar', ponto: { x: 400, y: 300 + 70 }, t: 1000 });
    expect(acoes(r2.efeitos)).toEqual([{ tipo: 'rolar', ponto: P, passos: -1 }]);
    // Antes do intervalo, nada.
    const r3 = reduzir(r2.estado, { tipo: 'olhar', ponto: { x: 400, y: 600 }, t: 1050 });
    expect(r3.efeitos).toEqual([]);
    // Depois dele, mais rápido quando mais longe (até 3 passos).
    const r4 = reduzir(r2.estado, { tipo: 'olhar', ponto: { x: 400, y: 900 }, t: 1400 });
    expect(acoes(r4.efeitos)).toEqual([{ tipo: 'rolar', ponto: P, passos: -3 }]);
  });

  it('na zona morta não rola; fixar de novo encerra', () => {
    const r1 = reduzir(armar('rolar'), { tipo: 'area', ponto: P });
    expect(reduzir(r1.estado, { tipo: 'olhar', ponto: { x: 410, y: 320 }, t: 1000 }).efeitos).toEqual([]);
    const fim = reduzir(r1.estado, { tipo: 'area', ponto: P });
    expect(fim.estado.fase.tipo).toBe('ocioso');
    expect(fim.estado.tarefa).toBeNull();
  });
});

describe('teclado', () => {
  it('abre com o botão, digita letras e fecha', () => {
    const e = reduzir(ESTADO_INICIAL, { tipo: 'botao', id: 'teclado' }).estado;
    expect(e.teclado).toBe(true);
    expect(acoes(reduzir(e, { tipo: 'tecla', id: 'c:a' }).efeitos)).toEqual([{ tipo: 'digitar', texto: 'a' }]);
    expect(acoes(reduzir(e, { tipo: 'tecla', id: 'enter' }).efeitos)).toEqual([{ tipo: 'tecla', nome: 'enter' }]);
    expect(reduzir(e, { tipo: 'tecla', id: 'fechar' }).estado.teclado).toBe(false);
  });

  it('maiúscula vale para uma letra só', () => {
    const e = reduzir(reduzir(ESTADO_INICIAL, { tipo: 'botao', id: 'teclado' }).estado, { tipo: 'tecla', id: 'maiuscula' }).estado;
    const r = reduzir(e, { tipo: 'tecla', id: 'c:ç' });
    expect(acoes(r.efeitos)).toEqual([{ tipo: 'digitar', texto: 'Ç' }]);
    expect(r.estado.maiuscula).toBe(false);
  });

  it('id desconhecido não vira digitação', () => {
    const e = reduzir(ESTADO_INICIAL, { tipo: 'botao', id: 'teclado' }).estado;
    expect(reduzir(e, { tipo: 'tecla', id: 'ctrl+alt+del' }).efeitos).toEqual([]);
  });
});

describe('sair', () => {
  it('emergência e voltar viram pedido de saída com o motivo', () => {
    expect(acoes(reduzir(ESTADO_INICIAL, { tipo: 'botao', id: 'emergencia' }).efeitos)).toEqual([{ tipo: 'sair', motivo: 'emergencia' }]);
    expect(acoes(reduzir(ESTADO_INICIAL, { tipo: 'botao', id: 'voltar' }).efeitos)).toEqual([{ tipo: 'sair', motivo: 'voltar' }]);
  });
  it('descrição acompanha o estado', () => {
    expect(descricaoDoEstado(ESTADO_INICIAL)).toMatch(/Escolha/);
    expect(descricaoDoEstado(armar('clique'))).toMatch(/Clique armado/);
  });
});

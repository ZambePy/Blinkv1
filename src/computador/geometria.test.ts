import { describe, it, expect } from 'vitest';
import {
  janelaParaTela,
  janelaParaSobreposicao,
  sobreposicaoParaTela,
  telaParaFisicoAproximado,
  tamanhoDoCursorNoSistema,
  regiaoDaLupa,
  lupaParaTela,
  prenderNoRetangulo,
  type QuadroDeTela,
} from './geometria';

const monitorPrimario: QuadroDeTela = {
  janela: { x: 0, y: 0, width: 1536, height: 864 },
  monitor: { x: 0, y: 0, width: 1536, height: 864 },
  escala: 1.25, // 1920×1080 a 125 %
};

const janelaMenor: QuadroDeTela = {
  janela: { x: 100, y: 60, width: 1280, height: 800 },
  monitor: { x: 0, y: 0, width: 1920, height: 1080 },
  escala: 1,
};

const monitorSecundario: QuadroDeTela = {
  janela: { x: 1920, y: 0, width: 1280, height: 720 },
  monitor: { x: 1920, y: 0, width: 1280, height: 720 },
  escala: 1,
};

describe('janela → tela → sobreposição', () => {
  it('janela em tela cheia: a conversão é identidade', () => {
    expect(janelaParaSobreposicao({ x: 300, y: 200 }, monitorPrimario)).toEqual({ x: 300, y: 200 });
  });

  it('janela deslocada soma a origem do conteúdo', () => {
    expect(janelaParaTela({ x: 10, y: 20 }, janelaMenor)).toEqual({ x: 110, y: 80 });
    expect(janelaParaSobreposicao({ x: 10, y: 20 }, janelaMenor)).toEqual({ x: 110, y: 80 });
  });

  it('monitor secundário: a sobreposição vê coordenadas locais', () => {
    expect(janelaParaSobreposicao({ x: 5, y: 5 }, monitorSecundario)).toEqual({ x: 5, y: 5 });
    expect(sobreposicaoParaTela({ x: 5, y: 5 }, monitorSecundario)).toEqual({ x: 1925, y: 5 });
  });

  it('nunca sai do monitor', () => {
    expect(janelaParaSobreposicao({ x: -50, y: 5000 }, monitorPrimario)).toEqual({ x: 0, y: 863 });
    expect(sobreposicaoParaTela({ x: 99999, y: -1 }, monitorSecundario)).toEqual({ x: 3199, y: 0 });
  });

  it('prende inclusive um retângulo degenerado sem NaN', () => {
    expect(prenderNoRetangulo({ x: 5, y: 5 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('tela → físico (reserva)', () => {
  it('multiplica pela escala do monitor', () => {
    expect(telaParaFisicoAproximado({ x: 100, y: 40 }, monitorPrimario)).toEqual({ x: 125, y: 50 });
  });
  it('escala 1 é identidade mesmo em monitor deslocado', () => {
    expect(telaParaFisicoAproximado({ x: 1925, y: 5 }, monitorSecundario)).toEqual({ x: 1925, y: 5 });
  });
});

describe('cursor sobre o sistema', () => {
  it('encolhe para 60 % do cursor do app', () => {
    expect(tamanhoDoCursorNoSistema(48)).toBe(29);
  });
  it('respeita piso e teto', () => {
    expect(tamanhoDoCursorNoSistema(24)).toBe(24);
    expect(tamanhoDoCursorNoSistema(128)).toBe(40);
    expect(tamanhoDoCursorNoSistema(Number.NaN)).toBe(29);
  });
});

describe('lupa', () => {
  const monitor = { x: 0, y: 0, width: 1920, height: 1080 };

  it('recorta um quadrado centrado no ponto', () => {
    expect(regiaoDaLupa({ x: 960, y: 540 }, 150, monitor)).toEqual({ x: 810, y: 390, width: 300, height: 300 });
  });

  it('desloca para dentro quando encosta na borda', () => {
    const r = regiaoDaLupa({ x: 10, y: 1075, raio: 0 } as never, 150, monitor);
    expect(r).toEqual({ x: 0, y: 780, width: 300, height: 300 });
  });

  it('mapeia o ponto do painel de volta para a tela', () => {
    const regiao = { x: 810, y: 390, width: 300, height: 300 };
    expect(lupaParaTela({ x: 0, y: 0 }, { width: 600, height: 600 }, regiao)).toEqual({ x: 810, y: 390 });
    expect(lupaParaTela({ x: 300, y: 300 }, { width: 600, height: 600 }, regiao)).toEqual({ x: 960, y: 540 });
    // Fora do painel é preso à região, nunca além dela.
    expect(lupaParaTela({ x: 900, y: 900 }, { width: 600, height: 600 }, regiao)).toEqual({ x: 1109, y: 689 });
  });
});

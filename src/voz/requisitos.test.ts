import { describe, expect, it } from 'vitest';
import {
  avaliarMaquina,
  cabeNaMemoriaLivre,
  classificarMaquina,
  recadoSobreOHardware,
  TABELA_DE_HARDWARE,
} from './requisitos';

describe('classificação do computador', () => {
  it('sem medida não classifica', () => {
    expect(classificarMaquina(null)).toBeNull();
    expect(classificarMaquina({ memoriaTotalGb: 0, memoriaLivreGb: 0, nucleos: 8 })).toBeNull();
  });

  it('menos de 8 GB é insuficiente, doa a contagem de núcleos', () => {
    expect(classificarMaquina({ memoriaTotalGb: 4, memoriaLivreGb: 3, nucleos: 16 })).toBe('insuficiente');
  });

  it('o computador de referência do projeto é adequado', () => {
    // 16 GB, 12 núcleos: memória diz "adequado", núcleos dizem "confortável".
    // Vale a pior das duas.
    expect(classificarMaquina({ memoriaTotalGb: 16, memoriaLivreGb: 9, nucleos: 12 })).toBe('adequado');
  });

  it('vale sempre a pior das duas dimensões', () => {
    expect(classificarMaquina({ memoriaTotalGb: 64, memoriaLivreGb: 40, nucleos: 2 })).toBe('insuficiente');
    expect(classificarMaquina({ memoriaTotalGb: 8, memoriaLivreGb: 6, nucleos: 32 })).toBe('apertado');
    expect(classificarMaquina({ memoriaTotalGb: 32, memoriaLivreGb: 20, nucleos: 16 })).toBe('confortavel');
  });
});

describe('memória livre', () => {
  it('4,5 GB é o piso do motor', () => {
    expect(cabeNaMemoriaLivre({ memoriaTotalGb: 16, memoriaLivreGb: 4.5, nucleos: 8 })).toBe(true);
    expect(cabeNaMemoriaLivre({ memoriaTotalGb: 16, memoriaLivreGb: 3.9, nucleos: 8 })).toBe(false);
  });

  it('sem medida não bloqueia — não é motivo para negar o recurso', () => {
    expect(cabeNaMemoriaLivre(null)).toBe(true);
  });
});

describe('recado ao cuidador', () => {
  it('memória livre curta ganha de tudo', () => {
    const r = recadoSobreOHardware({ memoriaTotalGb: 32, memoriaLivreGb: 2, nucleos: 16 });
    expect(r).toContain('Feche outros programas');
  });

  it('máquina adequada não recebe recado', () => {
    expect(recadoSobreOHardware({ memoriaTotalGb: 16, memoriaLivreGb: 9, nucleos: 12 })).toBeNull();
  });

  it('máquina apertada avisa sobre a demora', () => {
    expect(recadoSobreOHardware({ memoriaTotalGb: 8, memoriaLivreGb: 6, nucleos: 4 })).toContain('demora');
  });

  it('nomeia a dimensão que reprovou — e não manda comprar memória para quem tem 64 GB', () => {
    const poucosNucleos = { memoriaTotalGb: 64, memoriaLivreGb: 40, nucleos: 2 };
    expect(avaliarMaquina(poucosNucleos)).toEqual({ nivel: 'insuficiente', limitante: 'nucleos' });
    const recado = recadoSobreOHardware(poucosNucleos)!;
    expect(recado).toContain('núcleos');
    expect(recado).not.toContain('8 GB');
    expect(recado).toContain('memória de sobra');
  });

  it('pouca memória continua sendo relatada como pouca memória', () => {
    // Memória livre acima do piso do motor, para o recado ser sobre o TOTAL e
    // não sobre o que está ocupado agora — são conselhos diferentes.
    const poucaMemoria = { memoriaTotalGb: 6, memoriaLivreGb: 5, nucleos: 16 };
    expect(avaliarMaquina(poucaMemoria)?.limitante).toBe('memoria');
    expect(recadoSobreOHardware(poucaMemoria)).toContain('6 GB de memória');
  });

  it('quando as duas dimensões dão a mesma faixa, não há uma culpada', () => {
    expect(avaliarMaquina({ memoriaTotalGb: 8, memoriaLivreGb: 6, nucleos: 4 })?.limitante).toBeNull();
  });
});

describe('tabela publicada', () => {
  it('cobre os quatro níveis, em ordem crescente', () => {
    expect(TABELA_DE_HARDWARE.map((f) => f.nivel)).toEqual([
      'insuficiente',
      'apertado',
      'adequado',
      'confortavel',
    ]);
  });

  it('toda faixa diz ao cuidador o que esperar', () => {
    for (const faixa of TABELA_DE_HARDWARE) {
      expect(faixa.expectativa.length).toBeGreaterThan(20);
    }
  });
});

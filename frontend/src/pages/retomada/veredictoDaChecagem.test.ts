import { describe, it, expect } from 'vitest';
import {
  veredictoDaChecagem,
  FATOR_DE_ALERTA,
  type EntradaDaChecagem,
} from './veredictoDaChecagem';

// -----------------------------------------------------------------------------
// A checagem de retomada NÃO mede precisão. Com três alvos o ruído é grande
// demais para separar 2,5° de 3,2°. O que ela detecta é mudança grosseira:
// pessoa diferente, monitor movido, paciente 20 cm mais longe, perfil trocado.
//
// O veredito é RELATIVO à primeira checagem feita contra a mesma calibração.
// Um limiar absoluto não seria honesto com os dados que existem: seis sessões
// de um setup só, com erro entre 1,86° e 3,74°. "Reprovar acima de 3°"
// reprovaria metade delas; "acima de 4°" nunca dispararia.
// -----------------------------------------------------------------------------

const bom: EntradaDaChecagem = {
  erroDeg: 2.0,
  referenciaDeg: 2.0,
  rostoEnquadrado: true,
  distanciaNaFaixa: true,
};

const v = (over: Partial<EntradaDaChecagem> = {}) => veredictoDaChecagem({ ...bom, ...over });

describe('a posição vem antes da medida', () => {
  it('rosto fora do enquadramento manda recalibrar', () => {
    // Não adianta medir o olhar de quem não está no lugar: o erro mediria a
    // posição, não a calibração.
    expect(v({ rostoEnquadrado: false }).veredicto).toBe('recalibrar');
  });

  it('distância fora da faixa manda recalibrar', () => {
    expect(v({ distanciaNaFaixa: false }).veredicto).toBe('recalibrar');
  });

  it('posição ruim vence erro bom', () => {
    // Mesmo com erro idêntico à referência: o número está certo por acaso.
    expect(v({ erroDeg: 1.0, rostoEnquadrado: false }).veredicto).toBe('recalibrar');
  });

  it('o motivo aponta a posição, não o olhar', () => {
    expect(v({ rostoEnquadrado: false }).motivo).toMatch(/posic|posiç|enquadr/i);
  });
});

describe('sem medição', () => {
  it('não vira aprovação', () => {
    // "Não deu para medir" com veredito de seguir seria aprovar no escuro.
    expect(v({ erroDeg: null }).veredicto).toBe('recalibrar');
  });

  it('o motivo diz que não deu para medir', () => {
    expect(v({ erroDeg: null }).motivo).toMatch(/medir|medi[çc]/i);
  });
});

describe('a primeira checagem', () => {
  it('nunca reprova — ela ESTABELECE a referência', () => {
    // Não há com o que comparar. Reprovar aqui reprovaria uma calibração
    // recém-feita, e o cuidador entraria num laço de recalibrar sem fim.
    expect(v({ referenciaDeg: null, erroDeg: 3.7 }).veredicto).toBe('seguir');
  });

  it('nem com erro alto, desde que a posição esteja boa', () => {
    expect(v({ referenciaDeg: null, erroDeg: 10 }).veredicto).toBe('seguir');
  });

  it('mas ainda reprova por posição', () => {
    expect(v({ referenciaDeg: null, rostoEnquadrado: false }).veredicto).toBe('recalibrar');
  });
});

describe('comparação com a referência', () => {
  it('igual à referência segue', () => {
    expect(v({ erroDeg: 2.0, referenciaDeg: 2.0 }).veredicto).toBe('seguir');
  });

  it('melhor que a referência segue', () => {
    expect(v({ erroDeg: 1.2, referenciaDeg: 2.0 }).veredicto).toBe('seguir');
  });

  it('um pouco pior ainda segue — o ruído de 3 alvos é grande', () => {
    expect(v({ erroDeg: 2.0 * 1.3, referenciaDeg: 2.0 }).veredicto).toBe('seguir');
  });

  it('exatamente no fator ainda segue', () => {
    expect(v({ erroDeg: 2.0 * FATOR_DE_ALERTA, referenciaDeg: 2.0 }).veredicto).toBe('seguir');
  });

  it('acima do fator vira atenção', () => {
    expect(v({ erroDeg: 2.0 * FATOR_DE_ALERTA + 0.01, referenciaDeg: 2.0 }).veredicto).toBe(
      'atencao'
    );
  });

  it('muito pior continua sendo atenção, não reprovação automática', () => {
    // Reprovar sozinho tiraria a decisão do cuidador — e ele sabe coisas que o
    // software não sabe. O que muda com "muito pior" é a ênfase, não o poder.
    expect(v({ erroDeg: 20, referenciaDeg: 2.0 }).veredicto).toBe('atencao');
  });
});

describe('referência degenerada', () => {
  it('referência zero não vira divisão por zero nem aprovação eterna', () => {
    // Um erro medido de 0° é implausível; se aparecer, comparar contra ele
    // reprovaria tudo para sempre.
    expect(['seguir', 'atencao']).toContain(v({ referenciaDeg: 0, erroDeg: 2 }).veredicto);
  });

  it('referência negativa é tratada como ausente', () => {
    expect(v({ referenciaDeg: -1, erroDeg: 9 }).veredicto).toBe('seguir');
  });
});

describe('o caminho feliz não inventa motivo', () => {
  it('seguir com tudo bem não tem o que explicar', () => {
    expect(v().motivo).toBeNull();
  });
});

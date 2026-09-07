import { describe, it, expect } from 'vitest';
import { PASSOS, indiceDoPasso, proximoPasso, passoAnterior, type PassoId } from './passos';

// -----------------------------------------------------------------------------
// A ordem dos passos não é arbitrária: cada um depende do anterior.
//
// Sem permissão não há stream; sem stream não há como escolher câmera; sem
// câmera escolhida a distância medida seria de outro dispositivo; e a
// iluminação só faz sentido com o rosto já enquadrado, porque o brilho é
// medido no recorte do olho.
//
// A verificação do monitor vem por último de propósito: é a única que não
// precisa de câmera, e deixá-la no fim evita segurar o cuidador numa digitação
// antes de ele saber se o resto sequer funciona.
// -----------------------------------------------------------------------------

describe('a ordem dos passos', () => {
  it('tem os cinco, na ordem em que dependem uns dos outros', () => {
    expect(PASSOS).toEqual([
      'permissao',
      'camera',
      'posicionamento',
      'iluminacao',
      'monitor',
    ]);
  });
});

describe('avançar', () => {
  it('vai do primeiro ao segundo', () => {
    expect(proximoPasso('permissao')).toBe('camera');
  });

  it('percorre a sequência inteira', () => {
    let atual: PassoId | null = 'permissao';
    const visitados: PassoId[] = [];
    while (atual) {
      visitados.push(atual);
      atual = proximoPasso(atual);
    }
    expect(visitados).toEqual([...PASSOS]);
  });

  it('depois do último não há próximo — quem decide o destino é o wizard', () => {
    expect(proximoPasso('monitor')).toBeNull();
  });
});

describe('voltar', () => {
  it('volta um passo', () => {
    expect(passoAnterior('iluminacao')).toBe('posicionamento');
  });

  it('do primeiro não volta', () => {
    expect(passoAnterior('permissao')).toBeNull();
  });

  it('voltar é sempre livre, de qualquer passo', () => {
    // Nenhuma condição trava o retorno. Prender o cuidador num passo que ele
    // não consegue satisfazer — webcam ruim, sala escura — é o beco que a
    // premissa do bloco proíbe.
    for (const p of PASSOS.slice(1)) {
      expect(passoAnterior(p)).not.toBeNull();
    }
  });
});

describe('indiceDoPasso', () => {
  it('dá a posição para o indicador de progresso', () => {
    expect(indiceDoPasso('permissao')).toBe(0);
    expect(indiceDoPasso('monitor')).toBe(PASSOS.length - 1);
  });
});

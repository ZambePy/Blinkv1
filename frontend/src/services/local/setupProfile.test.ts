import { describe, it, expect } from 'vitest';
import {
  PREPARO_VERSION,
  chaveDoPreparo,
  lerPreparo,
  gravarPreparo,
  preparoConcluido,
  limparPreparo,
} from './setupProfile';

// -----------------------------------------------------------------------------
// O preparo é POR PERFIL, não global. Dois pacientes na mesma casa podem usar o
// mesmo computador em salas diferentes, com luz e distância diferentes — herdar
// o preparo de um para o outro entregaria calibração ruim com cara de aprovada.
// -----------------------------------------------------------------------------

const preparoCompleto = {
  cameraDeviceId: 'cam1',
  fpsMedido: 30,
  luxAmbiente: null,
  monitorDiagonalIn: 23.6,
  monitorOrigem: 'edid' as const,
};

describe('preparoConcluido', () => {
  it('é falso antes de qualquer preparo', () => {
    expect(preparoConcluido('p1')).toBe(false);
  });

  it('é verdadeiro depois de gravar', () => {
    gravarPreparo('p1', preparoCompleto);
    expect(preparoConcluido('p1')).toBe(true);
  });

  it('não vaza de um perfil para outro', () => {
    gravarPreparo('p1', preparoCompleto);
    expect(preparoConcluido('p2')).toBe(false);
  });

  it('volta a ser falso quando a versão dos passos muda', () => {
    // Um passo novo (ou um limiar diferente) torna o preparo antigo uma
    // afirmação sobre outra coisa. Melhor refazer que confiar.
    localStorage.setItem(
      chaveDoPreparo('p1'),
      JSON.stringify({
        ...preparoCompleto,
        version: PREPARO_VERSION - 1,
        completedAt: new Date().toISOString(),
      })
    );
    expect(preparoConcluido('p1')).toBe(false);
  });

  it('é falso quando o registro está corrompido, sem lançar', () => {
    localStorage.setItem(chaveDoPreparo('p1'), '{"version":');
    expect(() => preparoConcluido('p1')).not.toThrow();
    expect(preparoConcluido('p1')).toBe(false);
  });
});

describe('gravarPreparo', () => {
  it('carimba versão e data ISO', () => {
    gravarPreparo('p1', preparoCompleto);
    const p = lerPreparo('p1');

    expect(p?.version).toBe(PREPARO_VERSION);
    expect(new Date(p!.completedAt).toISOString()).toBe(p!.completedAt);
  });

  it('guarda a câmera escolhida, para não perguntar de novo', () => {
    gravarPreparo('p1', preparoCompleto);
    expect(lerPreparo('p1')?.cameraDeviceId).toBe('cam1');
  });

  it('guarda o lux quando informado', () => {
    gravarPreparo('p1', { ...preparoCompleto, luxAmbiente: 320 });
    expect(lerPreparo('p1')?.luxAmbiente).toBe(320);
  });

  it('aceita lux nulo — o campo é opcional', () => {
    gravarPreparo('p1', { ...preparoCompleto, luxAmbiente: null });
    expect(preparoConcluido('p1')).toBe(true);
    expect(lerPreparo('p1')?.luxAmbiente).toBeNull();
  });

  it('registra se a diagonal veio do EDID ou da mão do cuidador', () => {
    // O relatório precisa saber: um número digitado e um número lido do
    // monitor não têm a mesma confiança.
    gravarPreparo('p1', { ...preparoCompleto, monitorOrigem: 'manual' });
    expect(lerPreparo('p1')?.monitorOrigem).toBe('manual');
  });
});

describe('limparPreparo', () => {
  it('faz o perfil voltar a precisar de preparo', () => {
    gravarPreparo('p1', preparoCompleto);
    limparPreparo('p1');
    expect(preparoConcluido('p1')).toBe(false);
  });

  it('não mexe nos outros perfis', () => {
    gravarPreparo('p1', preparoCompleto);
    gravarPreparo('p2', preparoCompleto);

    limparPreparo('p1');

    expect(preparoConcluido('p2')).toBe(true);
  });
});

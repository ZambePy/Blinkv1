import { describe, it, expect, beforeEach } from 'vitest';
import { haCalibracaoNoDisco, PROFILES_STORAGE_KEY } from './calibration';

// -----------------------------------------------------------------------------
// "Existe calibração salva?" precisava de uma resposta que NÃO dependa do
// engine já ter subido.
//
// `isCalibrated()` responde sobre os regressores em memória, que só existem
// depois do `loadProfile()` do engine. A tela de abertura decide para onde ir
// antes disso — e usando `isCalibrated()` ela mandaria para o menu um usuário
// que tem calibração, pulando a conferência justamente na abertura em que ela
// serve.
//
// Esta função lê o disco e não carrega nada: nenhum efeito colateral no
// caminho de uma decisão de rota.
// -----------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

const gravar = (v: unknown) => localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(v));

describe('há calibração no disco?', () => {
  it('não, quando nunca houve calibração', () => {
    expect(haCalibracaoNoDisco()).toBe(false);
  });

  it('sim, quando há um perfil gravado', () => {
    gravar([{ meta: { id: 'p1' } }]);
    expect(haCalibracaoNoDisco()).toBe(true);
  });

  it('não, com a lista vazia', () => {
    gravar([]);
    expect(haCalibracaoNoDisco()).toBe(false);
  });
});

describe('armazenamento corrompido não vira "sim"', () => {
  it('JSON quebrado', () => {
    // Responder "sim" mandaria o usuário conferir uma calibração que não
    // existe, e a conferência mediria o modelo genérico.
    localStorage.setItem(PROFILES_STORAGE_KEY, '{isso não é json');
    expect(haCalibracaoNoDisco()).toBe(false);
  });

  it('JSON válido que não é uma lista', () => {
    gravar({ meta: { id: 'p1' } });
    expect(haCalibracaoNoDisco()).toBe(false);
  });

  it('lista de entradas sem `meta`', () => {
    gravar([null, 42, {}, { meta: null }]);
    expect(haCalibracaoNoDisco()).toBe(false);
  });
});

describe('não carrega nada', () => {
  it('perguntar não ativa o perfil', () => {
    // Uma consulta que ativasse o modelo mudaria o estado do rastreador a
    // partir de uma decisão de rota — e o efeito apareceria longe da causa.
    gravar([{ meta: { id: 'p1' } }]);

    // `haCalibracaoNoDisco` não é `loadProfile`: os regressores continuam como
    // estavam, e quem carrega continua sendo o `init()` do engine.
    expect(haCalibracaoNoDisco()).toBe(true);
    expect(haCalibracaoNoDisco()).toBe(true);
  });
});

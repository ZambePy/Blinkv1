import { describe, it, expect, vi } from 'vitest';
import { loadEnvOverrides, sanitizeExperiment, EXPERIMENT } from './experiment';

// A config de experimento em Node aceita override via env-var
// `IRISFLOW_EXP_<key>=<value>`. Estes testes garantem que:
//   (i)  env-var em booleano é interpretada corretamente ("true"/"1" → true);
//   (ii) env-var em número é convertida (não fica string, o que quebraria
//        cálculos de vetor);
//   (iii) chave desconhecida é ignorada (não trava rodada com typo);
//   (iv) sem env-var, o default é preservado (garantia de retrocompat).
//
// Testamos a função pura `loadEnvOverrides(env)` passando um objeto env
// sintético — evita `vi.resetModules()`, que estressa o pool do vitest.

describe('loadEnvOverrides', () => {
  it('sem env-var, retorna objeto vazio', () => {
    expect(loadEnvOverrides({})).toEqual({});
  });

  it('env sem prefixo IRISFLOW_EXP_ é ignorada', () => {
    expect(loadEnvOverrides({ NODE_ENV: 'production', PATH: '/usr/bin' })).toEqual({});
  });

  it('IRISFLOW_EXP_polynomialFeatures=true liga a flag', () => {
    expect(loadEnvOverrides({ IRISFLOW_EXP_polynomialFeatures: 'true' })).toEqual({ polynomialFeatures: true });
  });

  it('IRISFLOW_EXP_polynomialFeatures=1 também liga (equivalência "1"/"true")', () => {
    expect(loadEnvOverrides({ IRISFLOW_EXP_polynomialFeatures: '1' })).toEqual({ polynomialFeatures: true });
  });

  it('IRISFLOW_EXP_polynomialFeatures=false devolve override false explícito', () => {
    // Falso EXPLÍCITO tem que sobrepor localStorage (ou default), então o
    // override é passado adiante, não omitido.
    expect(loadEnvOverrides({ IRISFLOW_EXP_polynomialFeatures: 'false' })).toEqual({ polynomialFeatures: false });
  });

  it('override numérico converte string para Number', () => {
    const r = loadEnvOverrides({ IRISFLOW_EXP_expandFactor: '1.6' });
    expect(r.expandFactor).toBe(1.6);
    expect(typeof r.expandFactor).toBe('number');
  });

  it('chave desconhecida é ignorada (typo não trava)', () => {
    expect(loadEnvOverrides({ IRISFLOW_EXP_flagInexistente: 'true' })).toEqual({});
  });

  // ── Os overrides eram silenciosamente ignorados no Windows ────────────────
  //
  // No Windows os nomes de variável de ambiente são case-insensitive, e o Node
  // devolve a forma canônica EM MAIÚSCULAS ao enumerar `process.env`. Medido na
  // máquina do projeto:
  //
  //   process.env.IRISFLOW_EXP_dwellRingOnCursor  →  "true"   (acesso direto: ok)
  //   Object.keys(process.env)               →  ["IRISFLOW_EXP_DWELLRINGONCURSOR"]
  //
  // A comparação `key in DEFAULTS` recebia `DWELLRINGONCURSOR` contra a chave real
  // `dwellRingOnCursor`, falhava, e caía no `continue` — que era silencioso por
  // decisão de projeto ("typo em CLI não trava a rodada").
  //
  // O resultado: NENHUMA flag de chave camelCase — ou seja, todas — podia ser
  // ligada por env-var nesta máquina, sem nada indicando o problema. Numa
  // ablação, cada condição rodaria com os defaults e produziria medições
  // idênticas, que seriam lidas como "a flag não teve efeito". Dado de
  // aparência boa e conclusão invertida.
  it('aceita a chave em MAIÚSCULAS, como o Windows enumera', () => {
    expect(loadEnvOverrides({ IRISFLOW_EXP_DWELLRINGONCURSOR: 'true' }))
      .toEqual({ dwellRingOnCursor: true });
    expect(loadEnvOverrides({ IRISFLOW_EXP_POLYNOMIALFEATURES: 'true' }))
      .toEqual({ polynomialFeatures: true });
    expect(loadEnvOverrides({ IRISFLOW_EXP_EXPANDFACTOR: '1.6' }))
      .toEqual({ expandFactor: 1.6 });
  });

  it('aceita qualquer capitalização — é o que "case-insensitive" significa', () => {
    for (const chave of [
      'IRISFLOW_EXP_blinkClick',
      'IRISFLOW_EXP_BLINKCLICK',
      'IRISFLOW_EXP_blinkclick',
      'IRISFLOW_EXP_BlinkClick',
    ]) {
      expect(loadEnvOverrides({ [chave]: 'true' })).toEqual({ blinkClick: true });
    }
  });

  it('TODA flag do config é alcançável em maiúsculas', () => {
    // A garantia que importa não é sobre uma chave: é sobre o conjunto. Se
    // alguém adicionar uma flag nova amanhã, este teste cobre ela sozinho.
    for (const [chave, valorPadrao] of Object.entries(EXPERIMENT)) {
      // Um valor SINTATICAMENTE válido por tipo. A validação semântica (faixa
      // numérica, lista fechada de strings) é de `sanitizeExperiment`; aqui o
      // que se testa é se a chave chega, e ela não chegava para nenhuma delas
      // no Windows.
      const bruto = typeof valorPadrao === 'boolean' ? 'true'
                  : typeof valorPadrao === 'number' ? '1.5'
                  : String(valorPadrao);
      const r = loadEnvOverrides({ [`IRISFLOW_EXP_${chave.toUpperCase()}`]: bruto });
      expect(Object.keys(r)).toEqual([chave]);
    }
  });

  it('flag de STRING chega pelo env e é validada contra a lista fechada', () => {
    expect(loadEnvOverrides({ IRISFLOW_EXP_L2CS: 'wasm' })).toEqual({ l2cs: 'wasm' });
    // Valor inválido chega em `loadEnvOverrides` (que só coleta) e é barrado
    // em `sanitizeExperiment`, com aviso — nunca escolhe um provider em
    // silêncio.
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(sanitizeExperiment({ l2cs: 'inventado' }).l2cs).toBe('auto');
    expect(avisos).toHaveBeenCalled();
    avisos.mockRestore();
  });

  it('chave com o prefixo mas sem correspondente AVISA em vez de sumir', () => {
    // O silêncio era a metade do bug: quem escreveu `IRISFLOW_EXP_` na frente
    // de alguma coisa quase sempre queria ligar uma flag, e um typo aí custava
    // uma rodada de medição inteira sem sintoma.
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadEnvOverrides({ IRISFLOW_EXP_flagInexistente: 'true' })).toEqual({});
    expect(avisos).toHaveBeenCalledWith(expect.stringContaining('flagInexistente'));
    avisos.mockRestore();
  });

  it('variável sem o prefixo continua ignorada em silêncio', () => {
    // Aqui o silêncio é certo: `PATH` não é typo de flag nenhuma.
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadEnvOverrides({ PATH: '/usr/bin', HOME: '/root' })).toEqual({});
    expect(avisos).not.toHaveBeenCalled();
    avisos.mockRestore();
  });

  it('duas capitalizações da mesma flag não se multiplicam', () => {
    const r = loadEnvOverrides({
      IRISFLOW_EXP_dwellRingOnCursor: 'false',
      IRISFLOW_EXP_DWELLRINGONCURSOR: 'true',
    });
    expect(Object.keys(r)).toEqual(['dwellRingOnCursor']);
  });

  it('override numérico com valor não-parseável é ignorado', () => {
    // Preserva o default — não polui o override com NaN.
    expect(loadEnvOverrides({ IRISFLOW_EXP_expandFactor: 'abc' })).toEqual({});
  });

  it('múltiplas env-vars simultâneas — cada uma resolve independentemente', () => {
    const r = loadEnvOverrides({
      IRISFLOW_EXP_polynomialFeatures: 'true',
      IRISFLOW_EXP_expandFactor: '1.8',
    });
    expect(r).toEqual({ polynomialFeatures: true, expandFactor: 1.8 });
  });
});

// Smoke test do snapshot exportado — só garante que a montagem no boot não
// crashou e que o objeto tem shape esperado (defaults ainda são o default
// quando não há env-var IRISFLOW_EXP_* no ambiente atual do teste).
describe('EXPERIMENT (snapshot)', () => {
  it('carrega com shape completo (todas as chaves de ExperimentConfig existem)', () => {
    expect(EXPERIMENT).toHaveProperty('expandFactor');
    expect(EXPERIMENT).toHaveProperty('l2csCadenceMs');
    expect(EXPERIMENT).toHaveProperty('polynomialFeatures');
    expect(EXPERIMENT).toHaveProperty('gazeLostFallback');
  });
});

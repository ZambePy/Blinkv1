import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS } from './experiment';

// -----------------------------------------------------------------------------
// Auditoria de fiação — toda flag tem que ser LIDA por código de produção.
//
// ── Por que este teste existe ───────────────────────────────────────────────
//
// Este repositório produziu o mesmo defeito várias vezes: um módulo existia,
// testado e correto, e a flag que deveria selecioná-lo ou não existia, ou era
// lida só pelo harness de medição, ou era lida pelo harness e não pelo engine.
// Em todos os casos os testes unitários passavam. O que faltava era o fio.
//
// Uma flag que ninguém lê é pior que uma flag ausente: ela aparece na
// configuração, o operador a liga, o relatório registra a condição, e nada
// muda. O resultado sai plausível e errado — e descobrir isso numa sessão de
// medição com um humano na cadeira custa a sessão.
//
// Não há lista de exceções aqui de propósito: uma flag que não é lida sai de
// `DEFAULTS`, não entra numa lista de "ainda não ligadas".
// -----------------------------------------------------------------------------

function arquivosDeProducao(raiz: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(raiz)) {
    const p = join(raiz, nome);
    if (statSync(p).isDirectory()) {
      if (nome === 'node_modules' || nome === 'dist') continue;
      out.push(...arquivosDeProducao(p));
    } else if (
      (nome.endsWith('.ts') || nome.endsWith('.tsx'))
      && !nome.endsWith('.test.ts')
      && !nome.endsWith('.test.tsx')
      && !nome.endsWith('.d.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Onde uma flag pode ser lida.
 *
 * `testUtils/` está FORA de propósito: o harness é instrumento de medição, não
 * produto. Já aconteceu de `filterMode` ser lido lá e em nenhum outro lugar —
 * o harness media três cadeias enquanto o app só sabia rodar uma.
 */
function fontesDeProducao(): string[] {
  const raiz = process.cwd();
  return [
    ...arquivosDeProducao(join(raiz, 'src')),
    ...arquivosDeProducao(join(raiz, 'frontend', 'src')),
  ].filter((p) => !p.includes('testUtils') && !p.endsWith(join('config', 'experiment.ts')));
}

describe('toda flag de experimento é lida por código de produção', () => {
  const fontes = fontesDeProducao();
  const conteudos = fontes.map((f) => ({ f, txt: readFileSync(f, 'utf-8') }));

  for (const chave of Object.keys(DEFAULTS)) {
    it(`\`${chave}\` chega ao produto`, () => {
      const padrao = new RegExp(`EXPERIMENT\\.${chave}\\b`);
      const leitores = conteudos
        .filter(({ txt }) => padrao.test(txt))
        .map(({ f }) => f.replace(process.cwd(), '').replace(/\\/g, '/'));

      expect(
        leitores,
        `A flag \`${chave}\` não é lida por nenhum arquivo de produção. `
        + 'Ou o módulo dela nunca foi ligado, ou a flag ficou órfã depois de uma '
        + 'refatoração. Nos dois casos, ligá-la numa sessão de medição não muda '
        + 'nada — e o relatório registra a condição como se tivesse mudado. '
        + 'Ligue a flag ou remova-a de DEFAULTS.',
      ).not.toEqual([]);
    });
  }
});

describe('a cadeia de filtragem chega ao engine, não só ao harness', () => {
  it('`engine.ts` importa e usa `FilterChain`', () => {
    // Estabilidade do dwell (taxa de conclusão, abortos, cliques no alvo
    // errado) e atraso end-to-end captura → render só existem com o app
    // rodando. Enquanto o engine instanciava `OneEuroFilter2D` direto, essas
    // métricas não podiam ser medidas para `kalman` nem para `kalmanEma`.
    const engine = readFileSync(join(process.cwd(), 'src', 'tracker', 'engine.ts'), 'utf-8');
    expect(engine).toContain('FilterChain');
    expect(engine).toContain('EXPERIMENT.filterMode');
  });

  it('o diagnóstico expõe o modo EFETIVO, não só o pedido', () => {
    // `kalmanEma` sem geometria de tela degrada para `kalman`. Uma sessão
    // rodando degradada, com o relatório dizendo "kalmanEma", viraria uma
    // conclusão sobre uma cadeia que nunca rodou.
    const engine = readFileSync(join(process.cwd(), 'src', 'tracker', 'engine.ts'), 'utf-8');
    expect(engine).toMatch(/efetivo:/);
    expect(engine).toMatch(/degradado:/);
  });
});

describe('o recorder grava o que a reprodução offline precisa', () => {
  it('`preFilter` existe no schema', () => {
    // O método é gravar as amostras pré-filtro uma única vez e reproduzir o
    // mesmo JSONL pelos três filtros offline. Só `predicted` era gravado, e
    // ele é PÓS-filtro.
    const tipos = readFileSync(join(process.cwd(), 'src', 'telemetry', 'types.ts'), 'utf-8');
    expect(tipos).toContain('preFilter?:');
  });

  it('o engine preenche `preFilter`', () => {
    const engine = readFileSync(join(process.cwd(), 'src', 'tracker', 'engine.ts'), 'utf-8');
    expect(engine).toContain('preFilter: recordedPreFilter');
  });
});

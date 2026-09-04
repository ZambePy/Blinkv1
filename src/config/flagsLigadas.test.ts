import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS, FLAGS_NAO_LIGADAS } from './experiment';

// -----------------------------------------------------------------------------
// Auditoria de fiação — toda flag tem que ser LIDA por código de produção.
//
// ── Por que este teste existe ───────────────────────────────────────────────
//
// Este repositório produziu quatro vezes o mesmo defeito, em quatro sprints
// diferentes:
//
//   `spec11`      (P6.5)  — existia como tipo e projeção; `ACTIVE_FEATURE_SET`
//                           era constante de módulo, nada podia selecioná-lo.
//   `filterMode`  (S6)    — os filtros existiam, testados; a flag não existia.
//   harness       (P7.6)  — a flag existia; `runHarness` instanciava
//                           `OneEuroFilter2D` direto.
//   engine        (P7.6)  — o harness selecionava; o ENGINE não.
//
// Em todos, os testes unitários passavam e o módulo estava correto. O que
// faltava era o fio. E o custo não é estético: cada um deles bloqueava uma
// condição de medição do Sprint 8 — o dia que exige um humano na cadeira.
// Descobrir no Dia 7 que uma condição não pode ser ligada custa a sessão.
//
// Uma flag que ninguém lê é pior que uma flag ausente: ela aparece na
// configuração, o operador a liga, o relatório registra a condição, e nada
// muda. O resultado sai plausível e errado.
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
 * produto. Foi exatamente essa a lacuna do `P7.6` — o `filterMode` era lido lá
 * e em nenhum outro lugar, então o harness media três cadeias enquanto o app
 * só sabia rodar uma.
 */
function fontesDeProducao(): string[] {
  const raiz = process.cwd();
  return [
    ...arquivosDeProducao(join(raiz, 'src')),
    ...arquivosDeProducao(join(raiz, 'frontend', 'src')),
  ].filter((p) => !p.includes(`${'testUtils'}`) && !p.endsWith(join('config', 'experiment.ts')));
}

describe('toda flag de experimento é lida por código de produção', () => {
  const fontes = fontesDeProducao();
  const conteudos = fontes.map((f) => ({ f, txt: readFileSync(f, 'utf-8') }));

  for (const chave of Object.keys(DEFAULTS)) {
    it(`\`${chave}\` chega ao produto`, () => {
      const leitores = conteudos
        .filter(({ txt }) => txt.includes(`EXPERIMENT.${chave}`))
        .map(({ f }) => f.replace(process.cwd(), '').replace(/\\/g, '/'));

      // Órfã DECLARADA: o status é um fato registrado com motivo, não uma
      // omissão descoberta lendo o código — ou, pior, no meio de uma sessão de
      // medição. A lista é dívida, não permissão: quem tira dali tem que ligar.
      if (chave in FLAGS_NAO_LIGADAS) {
        expect(
          leitores,
          `\`${chave}\` está em FLAGS_NAO_LIGADAS mas JÁ é lida em produção. `
          + 'Remova a entrada da lista — uma dívida quitada que continua listada '
          + 'esconde as que ainda não foram.',
        ).toEqual([]);
        expect(FLAGS_NAO_LIGADAS[chave].length).toBeGreaterThan(80);
        return;
      }

      expect(
        leitores,
        `A flag \`${chave}\` não é lida por nenhum arquivo de produção. `
        + 'Ou o módulo dela nunca foi ligado, ou a flag ficou órfã depois de uma '
        + 'refatoração. Nos dois casos, ligá-la numa sessão de medição não muda '
        + 'nada — e o relatório registra a condição como se tivesse mudado.',
      ).not.toEqual([]);
    });
  }
});

describe('a cadeia de filtragem chega ao engine, não só ao harness', () => {
  it('`engine.ts` importa e usa `FilterChain`', () => {
    // O `F8.5` mede sete métricas. A 7 (estabilidade do dwell: taxa de
    // conclusão, abortos, cliques no alvo errado) e metade da 2 (atraso
    // end-to-end captura → render) só existem com o app rodando. Enquanto o
    // engine instanciava `OneEuroFilter2D` direto, essas métricas não podiam
    // ser medidas para `kalman` nem para `kalmanEma`.
    const engine = readFileSync(join(process.cwd(), 'src', 'tracker', 'engine.ts'), 'utf-8');
    expect(engine).toContain('FilterChain');
    expect(engine).toContain('EXPERIMENT.filterMode');
  });

  it('o diagnóstico expõe o modo EFETIVO, não só o pedido', () => {
    // `kalmanEma` sem geometria de tela degrada para `kalman`. Uma sessão do
    // Dia 7 rodando degradada, com o relatório dizendo "kalmanEma", viraria
    // uma conclusão sobre uma cadeia que nunca rodou.
    const engine = readFileSync(join(process.cwd(), 'src', 'tracker', 'engine.ts'), 'utf-8');
    expect(engine).toMatch(/efetivo:/);
    expect(engine).toMatch(/degradado:/);
  });
});

describe('o recorder grava o que o F8.5 precisa reproduzir', () => {
  it('`preFilter` existe no schema', () => {
    // O método declarado do `F8.5` é: "gravar as amostras pré-filtro uma única
    // vez e reproduzir o mesmo JSONL pelos três filtros offline". Só
    // `predicted` era gravado, e ele é PÓS-filtro.
    const tipos = readFileSync(join(process.cwd(), 'src', 'telemetry', 'types.ts'), 'utf-8');
    expect(tipos).toContain('preFilter?:');
  });

  it('o engine preenche `preFilter`', () => {
    const engine = readFileSync(join(process.cwd(), 'src', 'tracker', 'engine.ts'), 'utf-8');
    expect(engine).toContain('preFilter: recordedPreFilter');
  });
});

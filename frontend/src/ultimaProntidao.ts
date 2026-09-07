// Última avaliação de prontidão do posto de uso, para o relatório poder dizer
// o que foi MEDIDO em vez do que foi assumido.
//
// `readinessMetaFrom` traduz um `ReadinessReport` nos campos `iluminacao`,
// `movimentoCabeca` e `oculos` do relatório. Ela existia, era testada e não
// tinha chamador nenhum: o teste automático gravava `iluminacao: 'boa'` e
// `movimentoCabeca: 'parada'` hardcoded em toda sessão, inclusive nas ruins.
//
// O relatório é montado num módulo fora do React (`accuracy.ts`), e quem
// avalia a prontidão são dois componentes (`ReadinessPanel` e
// `PreflightPanel`). Este módulo é a caixa entre os dois — deliberadamente
// burra: guarda o último relatório e quando ele foi feito, e nada mais.

import type { ReadinessReport } from '@tracker/setupReadiness';

let ultimo: { relatorio: ReadinessReport; emMs: number } | null = null;

/** Chamado por quem avalia a prontidão, a cada avaliação. */
export function guardarProntidao(relatorio: ReadinessReport): void {
  ultimo = { relatorio, emMs: Date.now() };
}

/**
 * A última prontidão avaliada, se for recente o bastante para descrever a
 * sessão em curso.
 *
 * O prazo existe porque prontidão é perecível: a lâmpada muda, a pessoa se
 * reclina, o sol entra. Um relatório de meia hora atrás descreve outra
 * sessão, e usá-lo seria trocar um hardcode honesto por um dado velho
 * disfarçado de medição.
 */
export function ultimaProntidao(validadeMs = 10 * 60_000): ReadinessReport | null {
  if (!ultimo) return null;
  return Date.now() - ultimo.emMs <= validadeMs ? ultimo.relatorio : null;
}

/** Idade da última avaliação em minutos, para o relatório poder registrá-la. */
export function idadeDaProntidaoMin(): number | null {
  return ultimo === null ? null : (Date.now() - ultimo.emMs) / 60_000;
}

/** Só para os testes: descarta o que estiver guardado. */
export function limparProntidao(): void {
  ultimo = null;
}

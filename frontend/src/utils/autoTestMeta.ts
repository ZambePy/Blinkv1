// D2 (ROADMAP.md) — construção do `RunMeta` para o teste de precisão automático
// pós-calibração. Existe como função pura, isolada da árvore React, por dois
// motivos:
//
//   1. **Testabilidade.** O critério de aceite do D2 exige um teste unitário
//      garantindo que `minutosDeSessao` não é mais o hardcode `0` que estava
//      em `CalibrationCheck.tsx:73` — testar isso a partir do componente
//      React exigiria montar todo o `GazeProvider` só para observar o objeto
//      que a UI passa ao `startAccuracyTest`. Extraído aqui, o teste é uma
//      linha.
//
//   2. **Regra 3 do projeto** ("o que a UI afirma tem que ser verdade").
//      Antes deste util, todo relatório automático saía com
//      `iluminacao: 'boa', oculos: false, movimentoCabeca: 'parada',
//      minutosDeSessao: 0` — independente da realidade. O gráfico de deriva
//      erro×tempo (D7 do `ROADMAP.md`) fica impossível de construir se
//      `minutosDeSessao` for sempre 0; a filtragem por condição óptica (D6)
//      fica impossível se `oculos` for sempre `false`.
//
// O que este arquivo NÃO faz:
//   - Não pergunta ao usuário nada de novo (D2 corta escopo de UI nova; isso
//     é D6). Só usa o que já existe: uptime do engine e perfil ativo.
//   - Não muda `iluminacao` (segue `'boa'` hardcoded, pendente D7 — quando
//     a decisão de acoplar ao sensor de luz for tomada). O comentário
//     "auto" no `observacoes` avisa que o valor é default, não medido.
//   - Não mede distância (pendente S1-2 / D5) — a distância digitada segue
//     como parâmetro do caller (`SettingsScreen` já persiste o valor).

import type { RunMeta } from '@tracker/accuracy';
import type { OpticalCondition } from '@tracker/calibrationProfiles';

export interface AutoTestMetaInput {
  /** Tempo em ms desde o `engine.start()` bem-sucedido. Origem:
   *  `GazeContext.getSessionUptimeMs()`, que delega a `engine.getSessionUptimeMs()`. */
  sessionUptimeMs: number;
  /** Condição óptica do perfil de calibração ativo. Origem:
   *  `calibration.getActiveOpticalCondition()`. Até D6 expor a seleção
   *  ao cuidador, o valor observado é sempre `'desconhecido'` — o wiring
   *  fica pronto aqui e o comportamento observado não muda até lá. */
  opticalCondition: OpticalCondition;
  /** Distância olho→tela em cm, definida pelo cuidador nas configurações.
   *  60 é o meio da faixa recomendada (50–60 cm) exibida em `CalibrationCheck`. */
  distanciaCm: number;
  /** Diagonal física do monitor em polegadas. Definida pelo cuidador. */
  telaPolegadas: number;
  /** ISO date do dia (yyyy-mm-dd). Injetável para o teste ser determinístico. */
  dateISO?: string;
}

// Mapeia a condição óptica para o booleano `oculos` que o `RunMeta` exige.
// `lentes_contato` NÃO tem o problema estrutural das lentes (refração
// dependente do ângulo de olhar — ver `docs/BUG-OCULOS-EVIDENCIA.md`), então
// não conta como "óculos" para efeito de análise dos relatórios. `desconhecido`
// preserva o comportamento default anterior (`false`) para não introduzir
// mudança silenciosa de baseline enquanto D6 não expõe a seleção real.
export function opticalConditionToOculos(cond: OpticalCondition): boolean {
  return cond === 'oculos_simples' || cond === 'oculos_progressivo';
}

export function buildAutoTestMeta(input: AutoTestMetaInput): RunMeta {
  const minutosDeSessao = Math.max(0, Math.round(input.sessionUptimeMs / 60_000));
  const data = input.dateISO ?? new Date().toISOString().slice(0, 10);
  return {
    data,
    // Iluminação segue como default até D7 ligar ao sensor de luz ambiente
    // (ou o cuidador ter uma UI dedicada). O `observacoes` abaixo deixa isso
    // explícito no relatório para o leitor não confundir default com medida.
    iluminacao: 'boa',
    oculos: opticalConditionToOculos(input.opticalCondition),
    // Instrução da UI é "cabeça parada"; o cuidador não abriu movimento
    // controlado (isso é D5-3 no `ROADMAP.md`).
    movimentoCabeca: 'parada',
    minutosDeSessao,
    observacoes:
      `auto (imediatamente após calibração; iluminação=default; ` +
      `condição óptica=${input.opticalCondition})`,
    distanciaCm: input.distanciaCm,
    telaPolegadas: input.telaPolegadas,
  };
}

// D7.2 (ROADMAP §5) — no fluxo de accuracy test MANUAL (SettingsScreen),
// o `RunMeta` que a UI monta vinha com `minutosDeSessao: 0` hardcoded. O
// cuidador tinha que editar o select "Sessão (min)" toda vez para o
// relatório refletir a realidade. Isso viola a mesma regra 3 que D2 já
// resolveu no auto-test: se ninguém mexer, o número mente.
//
// Contrato desta função:
//   - Se `meta.minutosDeSessao` for `0` (o default do state), substitui
//     pelo uptime real do engine. Anota o `observacoes` para o leitor do
//     relatório saber a origem.
//   - Se o cuidador escolheu manualmente 20 ou 40 no select (para simular
//     deriva ou testar curva de fadiga), a escolha manual é preservada —
//     override manual do cuidador SEMPRE vence auto (regra: nunca sobrescrever
//     dado que o humano digitou).
//   - Não toca em outros campos do meta (iluminação, óculos, distância, tela).
export function applyUptimeToRunMetaIfDefault(
  meta: RunMeta,
  sessionUptimeMs: number,
): RunMeta {
  if (meta.minutosDeSessao !== 0) return meta;
  const autoMinutos = Math.max(0, Math.round(sessionUptimeMs / 60_000));
  if (autoMinutos === 0) return meta; // uptime também é 0 — nada a preencher
  const suffix = ` (auto: uptime ${autoMinutos} min)`;
  return {
    ...meta,
    minutosDeSessao: autoMinutos,
    observacoes: (meta.observacoes ?? '') + suffix,
  };
}

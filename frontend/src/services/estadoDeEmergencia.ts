/**
 * Um sinal global, minúsculo: há uma emergência em curso?
 *
 * Existe porque o dispatcher de dwell (`GazeContext`) precisa saber disso e não
 * pode consumir o `EmergencyContext` — o provedor de olhar está ACIMA do de
 * emergência na árvore, e inverter a ordem criaria a dependência circular que a
 * arquitetura evita de propósito.
 *
 * O único consumidor hoje é a correção por dwell (sprint S3), que não pode
 * aprender durante um alarme: é o momento em que o paciente olha para
 * qualquer coisa menos para o botão que acabou de acionar, e é o momento em que
 * um erro custa mais caro.
 *
 * Um booleano de módulo, e não um `Context`, porque o consumidor está dentro de
 * um callback de 30 Hz que não deve re-renderizar nada para ler um bit.
 */

let ativa = false;

export function definirEmergenciaAtiva(v: boolean): void {
  ativa = v;
}

export function emergenciaAtiva(): boolean {
  return ativa;
}

/** Só para teste: devolve o módulo ao estado inicial. */
export function _reiniciarParaTeste(): void {
  ativa = false;
}

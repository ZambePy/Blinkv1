import { isAccuracyTesting } from '@tracker/accuracy';

// Há uma medição em curso — calibração ou teste de precisão.
//
// Os dois desenham alvos nas BORDAS da tela (5% e 95%), e qualquer painel fixo
// nos cantos fica por cima deles. Não é só incômodo visual: o paciente não
// consegue fixar um alvo atrás de um painel e a calibração termina "com
// sucesso" com aquele ponto corrompido.
export function medicaoEmAndamento(estadoEngine: string): boolean {
  return estadoEngine === 'calibrating' || isAccuracyTesting;
}

/**
 * Ordem dos passos do preparo de ambiente.
 *
 * A sequência não é arbitrária — cada passo depende do anterior:
 *
 *  1. Sem permissão não há stream.
 *  2. Sem stream não há como escolher câmera nem medir o que ela entrega.
 *  3. Sem câmera escolhida, a distância medida seria de outro dispositivo.
 *  4. A iluminação só faz sentido com o rosto já enquadrado: o brilho é medido
 *     no recorte do olho, e sem rosto não há recorte.
 *  5. O monitor vem por último porque é o único que não precisa de câmera.
 *     Deixá-lo no fim evita segurar o cuidador numa digitação antes de ele
 *     saber se o resto sequer funciona.
 *
 * Separado do wizard para ser testável sem renderizar nada.
 */

export const PASSOS = ['permissao', 'camera', 'posicionamento', 'iluminacao', 'monitor'] as const;

export type PassoId = (typeof PASSOS)[number];

export function indiceDoPasso(passo: PassoId): number {
  return PASSOS.indexOf(passo);
}

/** `null` no último: quem decide o destino depois do preparo é o wizard. */
export function proximoPasso(passo: PassoId): PassoId | null {
  const i = indiceDoPasso(passo);
  return i >= 0 && i < PASSOS.length - 1 ? PASSOS[i + 1] : null;
}

/**
 * `null` no primeiro. Voltar não tem condição nenhuma: prender o cuidador num
 * passo que ele não consegue satisfazer — webcam ruim, sala escura — é o beco
 * sem saída que a premissa do bloco proíbe.
 */
export function passoAnterior(passo: PassoId): PassoId | null {
  const i = indiceDoPasso(passo);
  return i > 0 ? PASSOS[i - 1] : null;
}

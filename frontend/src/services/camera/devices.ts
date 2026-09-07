/**
 * Enumeração de câmeras e medição do que elas realmente entregam.
 *
 * O pipeline assume 30 fps em vários pontos — as janelas de baseline da
 * calibração ("~1 s a 30 fps") e o detector de flicker, que separa 50 de 60 Hz
 * a partir dessa taxa. A 15 fps toda janela temporal vale metade dos quadros, e
 * o relatório de precisão sai pior sem que ninguém saiba por quê.
 *
 * Por isso a taxa é **medida**, não lida de `getSettings().frameRate`: aquele
 * número é o que a webcam declara. Este é o que ela entrega.
 */

export interface CameraDevice {
  deviceId: string;
  /** Nunca vazio: o navegador esconde o label antes da permissão. */
  label: string;
}

export interface CameraCapacidade {
  larguraPx: number;
  alturaPx: number;
  fpsMedido: number;
  /** O que a webcam alega. `null` quando não informa. */
  fpsDeclarado: number | null;
}

export type QualidadeDeFps = 'boa' | 'baixa' | 'ruim';

/** A partir daqui o pipeline roda como foi projetado. */
export const FPS_BOM = 24;
/** Abaixo daqui as janelas temporais ficam curtas demais para o flicker. */
export const FPS_BAIXO = 15;

/** Quanto tempo contar frames. Curto o bastante para não cansar, longo o
 *  bastante para a média não depender de um engasgo isolado. */
export const JANELA_DE_MEDICAO_MS = 3000;

export async function listarCameras(): Promise<CameraDevice[]> {
  try {
    const md = navigator?.mediaDevices;
    if (!md?.enumerateDevices) return [];

    const todos = await md.enumerateDevices();
    return todos
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        // Antes da permissão o navegador devolve label vazio. "Câmera 1" é pior
        // que o nome real e muito melhor que uma linha em branco na lista.
        label: d.label?.trim() ? d.label : `Câmera ${i + 1}`,
      }));
  } catch {
    // Sem câmera enumerável o passo seguinte fica sem opção — mas um throw aqui
    // derrubaria a tela de preparo inteira, e com ela o caminho à calibração.
    return [];
  }
}

/**
 * Taxa a partir de uma contagem. Separado da coleta para ser testável sem
 * câmera, relógio ou `requestVideoFrameCallback`.
 */
export function contarFps(frames: number, duracaoMs: number): number {
  if (duracaoMs <= 0) return 0;
  return (frames * 1000) / duracaoMs;
}

export function classificarFps(fps: number): QualidadeDeFps {
  if (fps >= FPS_BOM) return 'boa';
  if (fps >= FPS_BAIXO) return 'baixa';
  return 'ruim';
}

/**
 * Conta frames de um `<video>` já tocando.
 *
 * Usa `requestVideoFrameCallback`, que dispara uma vez por frame **de vídeo**.
 * O fallback é comparar `currentTime` dentro de um `requestAnimationFrame`:
 * contar `rAF` direto mediria o refresh do monitor, e uma webcam de 15 fps
 * apareceria como 60.
 */
export function medirFps(
  video: HTMLVideoElement,
  janelaMs: number = JANELA_DE_MEDICAO_MS
): Promise<number> {
  return new Promise((resolve) => {
    const inicio = performance.now();
    let frames = 0;

    type ComRVFC = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const v = video as ComRVFC;

    if (typeof v.requestVideoFrameCallback === 'function') {
      const passo = () => {
        if (performance.now() - inicio >= janelaMs) {
          resolve(contarFps(frames, performance.now() - inicio));
          return;
        }
        frames++;
        v.requestVideoFrameCallback!(passo);
      };
      v.requestVideoFrameCallback(passo);
      return;
    }

    let ultimoTempo = -1;
    const passo = () => {
      const agora = performance.now();
      if (agora - inicio >= janelaMs) {
        resolve(contarFps(frames, agora - inicio));
        return;
      }
      // Só conta quando o vídeo avançou: `rAF` roda no refresh da tela, não no
      // da câmera.
      if (video.currentTime !== ultimoTempo) {
        ultimoTempo = video.currentTime;
        frames++;
      }
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
}

/** Resolução e taxa do stream que já está tocando neste `<video>`. */
export function lerCapacidade(video: HTMLVideoElement, fpsMedido: number): CameraCapacidade {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks?.()[0] ?? null;
  const settings = track?.getSettings?.() ?? {};

  return {
    larguraPx: video.videoWidth || settings.width || 0,
    alturaPx: video.videoHeight || settings.height || 0,
    fpsMedido,
    fpsDeclarado: typeof settings.frameRate === 'number' ? settings.frameRate : null,
  };
}

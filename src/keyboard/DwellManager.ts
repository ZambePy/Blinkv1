import { KeyboardState } from './KeyboardState';
import { speakText } from './Engine';

export class DwellManager {
  private currentTarget: HTMLElement | null = null;
  private dwellStartTime: number = 0;
  private readonly DWELL_TIME = 500; // ms exigido no requisito
  
  // Como o app usa requestAnimationFrame, essa função será chamada continuamente
  public update(cursorX: number, cursorY: number) {
    // Oculta o cursor temporariamente para o elementFromPoint não pegar o próprio laser
    const laser = document.getElementById('laser');
    let displayOrigin = '';
    if (laser) {
      displayOrigin = laser.style.display;
      laser.style.display = 'none';
    }

    // Procura o elemento abaixo do olhar
    const elem = document.elementFromPoint(cursorX, cursorY) as HTMLElement;
    
    if (laser) {
      laser.style.display = displayOrigin;
    }

    if (!elem) {
      this.clearTarget();
      return;
    }

    // Se o elemento for filho de uma tecla, pega a tecla
    const target = elem.closest('.dwell-target') as HTMLElement;

    if (target) {
      if (this.currentTarget !== target) {
        // Mudou de alvo
        this.clearTarget();
        this.currentTarget = target;
        this.dwellStartTime = performance.now();
        // Inicia animação visual
        this.currentTarget.classList.add('dwelling');
      } else {
        // Continua no mesmo alvo, checa o tempo
        const elapsed = performance.now() - this.dwellStartTime;
        const requiredDwellTime = this.currentTarget.dataset.key === 'power' ? 2000 : this.DWELL_TIME;
        if (elapsed >= requiredDwellTime) {
          // Dispara o clique
          this.triggerClick(this.currentTarget);
          this.clearTarget();
          // Previne múltiplos cliques imediatos exigindo sair e entrar de novo
          // Ao limpar o alvo, o próximo frame o detectará como novo alvo
        }
      }
    } else {
      this.clearTarget();
    }
  }

  private clearTarget() {
    if (this.currentTarget) {
      this.currentTarget.classList.remove('dwelling');
      this.currentTarget = null;
    }
  }

  private triggerClick(target: HTMLElement) {
    // Efeito visual de clique
    target.classList.add('clicked');
    setTimeout(() => target.classList.remove('clicked'), 200);

    const key = target.dataset.key;
    if (!key) return;

    if (key === 'open_keyboard') {
      KeyboardState.setVisible(true);
      return;
    } else if (key === 'close_keyboard') {
      KeyboardState.setVisible(false);
      return;
    } else if (key.startsWith('sug_')) {
      const word = key.replace('sug_', '');
      KeyboardState.setWord(word);
    } else if (key === 'backspace') {
      KeyboardState.backspace();
    } else if (key === 'space') {
      KeyboardState.appendText(' ');
    } else if (key === 'caps') {
      KeyboardState.toggleCaps();
    } else if (key === 'clear') {
      KeyboardState.clear();
    } else if (key === 'speak') {
      speakText(KeyboardState.getState().text);
    } else if (key === 'power') {
      KeyboardState.setVisible(false);
    } else if (key === 'zzz') {
      console.log('Pause tracking (Zzz)');
      // Future: add tracking pause logic here
    } else if (key === 'copy') {
      navigator.clipboard.writeText(KeyboardState.getState().text).catch(e => console.error(e));
    } else {
      if (key.length === 1) {
        const state = KeyboardState.getState();
        const char = state.isCaps ? key.toUpperCase() : key.toLowerCase();
        KeyboardState.appendText(char);
      }
    }
  }
}

export const dwellManager = new DwellManager();

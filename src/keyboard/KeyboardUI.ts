import './keyboard.css';
import { Component } from './Component';
import { KeyboardState } from './KeyboardState';
import type { KeyboardStateData } from './KeyboardState';
import { speakText } from './Engine';

const LAYOUT = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['caps', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace'],
  ['clear', 'space', 'speak']
];

export class KeyboardUI extends Component<{}, KeyboardStateData> {
  constructor() {
    super();
    this.state = KeyboardState.getState();
    KeyboardState.subscribe((state) => {
      // Small optimization to only re-render parts or just full re-render for simplicity here
      this.state = state;
      this.update();
    });
  }

  private handleKeyPress(key: string) {
    if (key === 'backspace') {
      KeyboardState.backspace();
    } else if (key === 'space') {
      KeyboardState.appendText(' ');
    } else if (key === 'caps') {
      KeyboardState.toggleCaps();
    } else if (key === 'clear') {
      KeyboardState.clear();
    } else if (key === 'speak') {
      speakText(this.state.text);
    } else {
      const char = this.state.isCaps ? key.toUpperCase() : key.toLowerCase();
      KeyboardState.appendText(char);
    }
  }

  render(): HTMLElement | null {
    if (!this.state.isVisible && this.element) {
      // Just hide it if already rendered
      this.element.classList.remove('active');
      return this.element;
    } else if (this.element && this.state.isVisible) {
      this.element.classList.add('active');
      // If we don't need a full re-render for just visibility, we could optimize here,
      // but let's re-render to keep it simple.
    }

    const container = document.createElement('div');
    container.className = `keyboard-container ${this.state.isVisible ? 'active' : ''}`;
    container.id = 'virtual-keyboard';

    // Display Bar
    const displayBar = document.createElement('div');
    displayBar.className = 'kb-display-bar';

    const textDisplay = document.createElement('div');
    textDisplay.className = 'kb-text-display';
    textDisplay.innerText = this.state.text || ' ';
    // Pinking a blinking cursor effect
    if (this.state.text.length > 0) {
      textDisplay.innerText += '|';
    } else {
      textDisplay.innerHTML = '<span style="opacity: 0.3;">Comece a digitar...</span>|';
    }

    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'kb-suggestions';
    this.state.suggestions.forEach(suggestion => {
      const btn = document.createElement('div');
      btn.className = 'kb-suggestion-btn dwell-target';
      btn.dataset.key = `sug_${suggestion}`;
      btn.innerText = suggestion;
      suggestionsDiv.appendChild(btn);
    });

    const closeBtn = document.createElement('div');
    closeBtn.className = 'kb-suggestion-btn dwell-target close-btn';
    closeBtn.dataset.key = 'close_keyboard';
    closeBtn.innerText = '✕ FECHAR';
    suggestionsDiv.appendChild(closeBtn);

    displayBar.appendChild(textDisplay);
    displayBar.appendChild(suggestionsDiv);
    container.appendChild(displayBar);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'kb-grid';

    LAYOUT.forEach(rowKeys => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'kb-row';
      
      rowKeys.forEach(key => {
        const keyDiv = document.createElement('div');
        keyDiv.className = 'kb-key dwell-target';
        keyDiv.dataset.key = key;

        if (['backspace', 'space', 'caps', 'clear'].includes(key)) {
          keyDiv.classList.add('action-key');
        }
        if (key === 'space') keyDiv.classList.add('space-key');
        if (key === 'speak') keyDiv.classList.add('action-key', 'action-speak');

        const label = document.createElement('span');
        label.className = 'key-content';
        
        switch (key) {
          case 'backspace': label.innerText = '⌫'; break;
          case 'space': label.innerText = 'ESPAÇO'; break;
          case 'caps': label.innerText = '⇧'; break;
          case 'clear': label.innerText = 'LIMPAR'; break;
          case 'speak': label.innerText = 'FALAR 🔊'; break;
          default: label.innerText = this.state.isCaps ? key.toUpperCase() : key.toLowerCase();
        }

        const fill = document.createElement('div');
        fill.className = 'dwell-fill';

        keyDiv.appendChild(fill);
        keyDiv.appendChild(label);
        rowDiv.appendChild(keyDiv);
      });
      grid.appendChild(rowDiv);
    });

    container.appendChild(grid);

    return container;
  }
}

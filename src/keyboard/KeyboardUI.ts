import './keyboard.css';
import { Component } from './Component';
import { KeyboardState } from './KeyboardState';
import type { KeyboardStateData } from './KeyboardState';

const LAYOUT = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['caps', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace', 'clear'],
  ['+', 'num_toggle', '-', 'space', 'power']
];

export class KeyboardUI extends Component<{}, KeyboardStateData> {
  constructor() {
    super();
    this.state = KeyboardState.getState();
    KeyboardState.subscribe((state) => {
      this.state = state;
      this.update();
    });
  }

  // @ts-ignore
  private handleKeyPress(key: string) {
    // Legacy internal handler, actual clicks handled by DwellManager
  }

  render(): HTMLElement | null {
    if (!this.state.isVisible && this.element) {
      this.element.classList.remove('active');
      return this.element;
    } else if (this.element && this.state.isVisible) {
      this.element.classList.add('active');
    }

    const container = document.createElement('div');
    container.className = `keyboard-container ${this.state.isVisible ? 'active' : ''}`;
    container.id = 'virtual-keyboard';

    // 1. Suggestions Bar (Top)
    const suggestionsBar = document.createElement('div');
    suggestionsBar.className = 'kb-suggestions-bar';

    const leftArrow = this.createButton('arrow_left', 'kb-arrow-btn', '◀');
    suggestionsBar.appendChild(leftArrow);

    const suggestionsList = document.createElement('div');
    suggestionsList.className = 'kb-suggestions-list';
    const currentSuggestions = this.state.suggestions && this.state.suggestions.length > 0 
      ? this.state.suggestions 
      : ['jum', 'jump', 'jumbo', 'jumps']; // fallback for UI mockup

    currentSuggestions.forEach(suggestion => {
      const btn = this.createButton(`sug_${suggestion}`, 'kb-suggestion-btn', suggestion);
      suggestionsList.appendChild(btn);
    });
    suggestionsBar.appendChild(suggestionsList);

    const rightArrow = this.createButton('arrow_right', 'kb-arrow-btn', '▶');
    suggestionsBar.appendChild(rightArrow);

    container.appendChild(suggestionsBar);

    // 2. Display Bar (Second Row)
    const displayBar = document.createElement('div');
    displayBar.className = 'kb-display-bar';

    const copyBtn = this.createButton('copy', 'kb-icon-btn', '📄');
    const speakBtn = this.createButton('speak', 'kb-icon-btn', '📢');
    displayBar.appendChild(copyBtn);
    displayBar.appendChild(speakBtn);

    const textDisplay = document.createElement('div');
    textDisplay.className = 'kb-text-display';
    textDisplay.innerText = this.state.text || ' ';
    if (this.state.text.length > 0) {
      textDisplay.innerText += '|';
    } else {
      textDisplay.innerHTML = '<span class="placeholder-text">The quick brown fox jumps over the lazy dog</span>';
    }
    displayBar.appendChild(textDisplay);

    const rightArrowDisp = this.createButton('arrow_right_disp', 'kb-icon-btn', '❯');
    const zzzBtn = this.createButton('zzz', 'kb-icon-btn', 'Zzz ☁');
    displayBar.appendChild(rightArrowDisp);
    displayBar.appendChild(zzzBtn);

    container.appendChild(displayBar);

    // 3. Grid
    const grid = document.createElement('div');
    grid.className = 'kb-grid';

    LAYOUT.forEach((rowKeys, rowIndex) => {
      const rowDiv = document.createElement('div');
      rowDiv.className = `kb-row row-${rowIndex}`;
      
      rowKeys.forEach(key => {
        const keyDiv = document.createElement('div');
        keyDiv.className = 'kb-key dwell-target';
        keyDiv.dataset.key = key;

        const label = document.createElement('span');
        label.className = 'key-content';
        
        switch (key) {
          case 'backspace': label.innerHTML = '⌫'; break;
          case 'space': label.innerHTML = '␣'; keyDiv.classList.add('space-key'); break;
          case 'caps': label.innerHTML = '⇧'; break;
          case 'clear': label.innerHTML = '⌧'; break;
          case 'speak': label.innerHTML = '📢'; break;
          case '+': label.innerHTML = '+'; break;
          case '-': label.innerHTML = '-'; break;
          case 'num_toggle': label.innerHTML = '1250'; break;
          case 'power': label.innerHTML = '⏻'; keyDiv.classList.add('power-key'); break;
          default: label.innerHTML = this.state.isCaps ? key.toUpperCase() : key.toLowerCase();
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

  private createButton(key: string, className: string, text: string): HTMLElement {
    const btn = document.createElement('div');
    btn.className = `${className} dwell-target`;
    btn.dataset.key = key;

    const fill = document.createElement('div');
    fill.className = 'dwell-fill';
    
    const content = document.createElement('span');
    content.className = 'key-content';
    content.innerText = text;

    btn.appendChild(fill);
    btn.appendChild(content);
    return btn;
  }
}

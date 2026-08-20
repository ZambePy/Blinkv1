import { describe, it, expect, beforeEach } from 'vitest';
import { getPredictions, learnSentence, learnWord, learnBigram } from './wordPredictor';

describe('WordPredictor Engine', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('deve retornar predições iniciais padrão para entrada vazia', () => {
    const predictions = getPredictions('');
    expect(predictions.length).toBe(4);
    expect(predictions).toContain('quero');
    expect(predictions).toContain('preciso');
  });

  it('deve completar prefixos de palavras estáticas', () => {
    const predictions = getPredictions('qu');
    expect(predictions).toContain('quero');
    expect(predictions).toContain('quente');
  });

  it('deve prever a próxima palavra com base em bigrama estático', () => {
    const predictions = getPredictions('quero ');
    // 'quero' -> ['comer', 'beber', 'ir', 'descansar', 'água', 'conversar', 'deitar', 'sair', 'dormir']
    expect(predictions).toContain('comer');
    expect(predictions).toContain('beber');
    expect(predictions).not.toContain('quero'); // Não deve auto-sugerir a mesma palavra redundante
  });

  it('deve aprender palavras novas do usuário e priorizá-las nas predições', () => {
    // Aprende uma palavra incomum
    learnWord('paralelepípedo');

    // Ao digitar o prefixo 'para', a palavra aprendida do usuário deve estar nas predições
    const predictions = getPredictions('para');
    expect(predictions).toContain('paralelepípedo');
  });

  it('deve aprender bigramas novos do usuário e sugerir no espaço subsequente', () => {
    // Aprende que depois de 'chamar' o usuário escreve muito 'gabriel'
    learnBigram('chamar', 'gabriel');

    const predictions = getPredictions('chamar ');
    expect(predictions).toContain('gabriel');
  });

  it('deve processar uma frase inteira e aprender palavras e bigramas sequencialmente', () => {
    learnSentence('estou com dor de cabeça');

    const predictions = getPredictions('estou com ');
    expect(predictions).toContain('dor');

    const predictionsNext = getPredictions('dor ');
    expect(predictionsNext).toContain('de');
  });
});

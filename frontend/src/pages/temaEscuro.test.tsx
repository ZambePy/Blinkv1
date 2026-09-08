import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// O tema PADRAO deste app e o escuro (`SettingsContext`: `theme: 'dark'`).
//
// As seis telas do Bloco 1 nasceram assumindo tema claro: fundo
// `linear-gradient(160deg, #f0f4ff ...)` cravado, cartao `rgba(255,255,255,.94)`
// cravado sobrescrevendo o proprio `.glass-card` — e texto em
// `var(--color-text-base)`, que no escuro vira #f8fafc.
//
// Resultado: titulo branco sobre cartao branco. Texto invisivel, nao "meio
// apagado" — o cuidador nao conseguia ler "Entrar na sua conta" nem os rotulos
// dos campos de login.
//
// Este teste varre o CODIGO-FONTE, e nao a arvore renderizada, de proposito.
// Renderizar so alcanca o ramo que a tela mostra no estado padrao: a tela de
// ativacao redireciona sem licenca, a de perfis nao abre o formulario, o aviso
// de tolerancia devolve `null`. Metade das cores cravadas escaparia. O arquivo
// inteiro nao escapa.
// -----------------------------------------------------------------------------

const AQUI = dirname(fileURLToPath(import.meta.url));

const ARQUIVOS = [
  'onboarding/InitialSplash.tsx',
  'onboarding/IntroScreen.tsx',
  'onboarding/ConsentScreen.tsx',
  'auth/LoginScreen.tsx',
  'auth/ActivatedScreen.tsx',
  'auth/ProfileSelect.tsx',
  '../components/ui/GraceBanner.tsx',
  // Bloco 2 — entram na mesma lista, pelo mesmo motivo.
  'setup/SetupWizard.tsx',
  'setup/steps/PermissaoCamera.tsx',
  'setup/steps/EscolhaDaCamera.tsx',
  'setup/steps/Posicionamento.tsx',
  'setup/steps/Iluminacao.tsx',
  'setup/steps/VerificacaoDoMonitor.tsx',
  'setup/AtalhoDePreparo.tsx',
  // Bloco 3 — tutorial.
  'tutorial/TutorialWizard.tsx',
  'tutorial/AtalhoDeTutorial.tsx',
  'tutorial/steps/OQueEDwell.tsx',
  'tutorial/steps/PraticaGuiada.tsx',
  'tutorial/steps/AjusteDoTempo.tsx',
  'tutorial/steps/BotaoDeEmergencia.tsx',
  'tutorial/steps/Concluido.tsx',
  '../components/ui/AnelDeDwell.tsx',
  '../components/ui/ControleDeDwell.tsx',
  // Bloco 4 — moldura da calibracao.
  'calibration/PreparoDaCalibracao.tsx',
  'calibration/ResultadoDaCalibracao.tsx',
  'relatorio/RelatorioDaSessao.tsx',
  // Bloco 5A.
  'conta/ContaEAssinatura.tsx',
  'conta/AtalhoDePerfilEConta.tsx',
  '../components/ui/EstadoDaSessao.tsx',
  '../components/ui/Semaforo.tsx',
];

/**
 * Tintas que so funcionam no tema claro.
 *
 * Branco e as familias pastel (slate-50, red-50/200, green-50/200, blue-50/200,
 * amber-50/200) viram fundo branco atras de texto branco quando o app esta no
 * tema escuro. Cada uma tem um token equivalente em `index.css`.
 */
const COR_SO_CLARA =
  /(rgba?\(\s*255\s*,\s*255\s*,\s*255)|#ffffff\b|#fff\b|#f0f4ff|#e8f0fb|#f1f5f9|#f8fafc|#fef2f2|#fecaca|#f0fdf4|#bbf7d0|#eff6ff|#bfdbfe|#fffbeb|#fde68a|#e2e8f0/gi;

/** Linhas de comentario nao pintam nada — e explicam justamente estas cores. */
const ehComentario = (linha: string) => {
  const t = linha.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

describe('nenhuma tela do Bloco 1 crava cor de tema claro', () => {
  for (const rel of ARQUIVOS) {
    it(`${rel.split('/').pop()} usa tokens do tema`, () => {
      const fonte = readFileSync(resolve(AQUI, rel), 'utf8');

      const achados = fonte
        .split('\n')
        .map((linha, i) => ({ linha, n: i + 1 }))
        .filter(({ linha }) => !ehComentario(linha))
        .flatMap(({ linha, n }) =>
          (linha.match(COR_SO_CLARA) ?? []).map((cor) => `linha ${n}: ${cor} — ${linha.trim()}`)
        );

      expect(achados, `cores de tema claro cravadas:\n${achados.join('\n')}`).toEqual([]);
    });
  }
});

describe('o fundo da pagina acompanha o tema', () => {
  const COM_CARTAO = [
    'onboarding/IntroScreen.tsx',
    'onboarding/ConsentScreen.tsx',
    'auth/LoginScreen.tsx',
    'auth/ActivatedScreen.tsx',
    'auth/ProfileSelect.tsx',
    'setup/SetupWizard.tsx',
    'tutorial/TutorialWizard.tsx',
  ];

  for (const rel of COM_CARTAO) {
    it(`${rel.split('/').pop()} pinta o fundo com --settings-bg`, () => {
      // O token que o resto do app ja usava e que estas telas ignoravam.
      const fonte = readFileSync(resolve(AQUI, rel), 'utf8');
      expect(fonte).toContain('var(--settings-bg)');
    });
  }
});

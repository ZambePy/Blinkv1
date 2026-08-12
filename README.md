# IrisFlow

IrisFlow é uma aplicação de Tecnologia Assistiva baseada em Rastreamento Ocular (Eye Tracking) desenvolvida para pessoas com Esclerose Lateral Amiotrófica (ELA) e outras condições severas de restrição motora. O sistema permite navegação, comunicação e lazer utilizando apenas o movimento dos olhos através de uma webcam comum, sem necessidade de hardware especializado.

Todo o processamento de visão computacional e machine learning ocorre **100% localmente** no dispositivo, garantindo privacidade absoluta e baixíssima latência.

## 🌟 Funcionalidades Principais (Frontend)

O projeto passou recentemente por uma reestruturação completa de interface, focada em usabilidade, acessibilidade e estética moderna (Glassmorphism):

- **Calibração Integrada:** Fluxo de 13 pontos (grade 4-5-3 + 1 diagonal — grade simétrica será entregue na Sprint 1) com tolerância a movimentos, limites de tentativas e feedback visual inteligente em tempo real.
- **Sistema de "Dwell Click":** Seleção de elementos na interface simplesmente mantendo o olhar fixo por uma fração de segundo (Dwell Time customizável).
- **Interface Otimizada para Olhar:** Botões grandes, alto contraste, transições fluidas e feedback sonoro/visual para evitar fadiga ocular.
- **Módulos do Sistema:**
  - 🗣️ **Comunicação:** Frases rápidas, teclado virtual preditivo e pictogramas.
  - 🖥️ **Computador:** Controle de mouse virtual para o sistema operacional.
  - 🎮 **Lazer:** Jogos adaptados (Estoura Bolhas, Jogo da Memória, Desenho) e ferramentas de relaxamento.
  - ⚙️ **Configurações:** Ajuste fino de sensibilidade, velocidade do Dwell e configurações globais.

## 🧠 Arquitetura do Rastreamento Ocular

O pipeline de *Gaze Tracking* combina detecção facial do MediaPipe com modelos de regressão treinados em tempo real:

```text
Webcam (1280×720)
    │
    ├── MediaPipe FaceLandmarker (WASM) → 478 landmarks 3D
    │
    ├── Extrator Geométrico compacto → ~31 features por olho
    │   (offsets de íris, cantos, EAR, ângulos de pose, interações pose×offset)
    │
    ├── Calibração (StandardScaler + Ridge com λ por CV leave-one-target-out)
    │   → Mapeamento tela (X, Y), 2 regressores (L/R) → média binocular
    │
    ├── OneEuroFilter2D → Suavização profunda de ruído e tremores
    │
    └── Motor React (GazeContext) → Injeção de Cursor Dwell e Navegação no DOM
```

*Nota Técnica:* Atualmente o sistema roda no modo geométrico compacto
(`USE_COMPACT_FEATURES = true` em `src/featurePipeline.ts`), com ~31 dimensões
por olho e regressão Ridge selecionando λ por validação cruzada leave-one-target-out.
O encoder CNN pesado (`onnxruntime-node`) treinado no MPIIFaceGaze está implementado
em repositório anexado para cenários de fallback, porém a inferência geométrica
combinada ao Filtro OneEuro demonstrou estabilidade superior e menor custo de CPU
para uso contínuo (30fps fixos). Documentação técnica da antiga pipeline híbrida
pode ser encontrada em [IRISFLOW_PIPELINE_TECNICO.md](./IRISFLOW_PIPELINE_TECNICO.md).

## 🛠️ Tecnologias Utilizadas

- **Frontend:** React 18, TypeScript, Vite, React Router, CSS nativo (Design System Customizado).
- **Processamento:** `@mediapipe/tasks-vision` (WASM offline), TypeScript math algorithms (OneEuro, Scalers).
- **Desktop:** Electron, Node.js (compilação via `electron-builder`).
- **Machine Learning (Pesquisa):** Python, TensorFlow, scikit-learn (veja `python_ml/`).

## 🚀 Como Rodar o Projeto

### Modo Web (Desenvolvimento Frontend)

Ideal para testes de interface e ajustes de UI (funciona independente dos binários do Electron):

```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`. O motor de rastreamento ocular e toda a navegação web funcionarão normalmente utilizando a webcam através do navegador.

### Modo Electron App (Produção Desktop)

```bash
npm install
npm run electron:dev
```

Este comando levanta o servidor Vite e abre o container nativo do Electron com acesso profundo ao sistema operacional (necessário para o "Virtual Mouse" manipular o cursor do Windows/Mac).

### Gerar Instalador (.exe, .dmg, .AppImage)

```bash
npm run electron:build
```

O executável/instalador final otimizado será gerado na pasta `release/`.

## 📂 Estrutura do Projeto

- `frontend/src/`: Código fonte da interface React.
  - `pages/`: Telas principais do sistema (Menu, Onboarding, Calibração, Teclado, Jogos).
  - `components/ui/`: Componentes reutilizáveis projetados para Interação Ocular.
  - `context/`: Estados globais, destacando-se o `GazeContext.tsx` que orquestra o cursor vermelho de dwell.
- `src/tracker/` e `src/`: Lógica core matemática de calibração, machine learning regressivo e filtros de ruído.
- `electron/`: Código main do Electron e scripts de preload.
- `python_ml/`: Scripts de treinamento offline de redes neurais.

## 🤝 Licença e Privacidade

Privacidade é essencial na tecnologia assistiva. O IrisFlow não envia nenhuma imagem, telemetria facial ou dado de calibração para a nuvem. Toda a inferência neural acontece localmente. Para detalhes sobre o uso restrito de datasets não-comerciais (como o MPIIFaceGaze na pesquisa base), consulte a documentação técnica complementar.

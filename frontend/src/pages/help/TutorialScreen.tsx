import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  MousePointer2,
  CheckCircle,
  Home,
  Gamepad2,
  Settings,
  MessageCircle,
  Activity,
} from 'lucide-react';

const TUTORIAL_STEPS = [
  {
    icon: <Eye size={80} color="#1B54A8" aria-hidden="true" />,
    title: 'Bem-vindo ao IrisFlow!',
    description:
      'O IrisFlow é uma plataforma de comunicação e assistência para pessoas com mobilidade reduzida. Com ela, você pode se expressar, se divertir e monitorar sua saúde — tudo com poucos cliques ou, no futuro, apenas com o olhar.',
    badge: 'Introdução',
  },
  {
    icon: <MousePointer2 size={80} color="#16a34a" aria-hidden="true" />,
    title: 'Como Navegar',
    description:
      'Clique em qualquer botão grande para realizar uma ação. No futuro, o sistema usará o rastreamento do seu olhar para fazer a seleção automaticamente — sem precisar tocar em nada.',
    badge: 'Interação',
  },
  {
    icon: <Home size={80} color="#f59e0b" aria-hidden="true" />,
    title: 'Menu Principal (Home)',
    description:
      'A tela principal está dividida em 4 abas: Comunicação, Cuidados, Lazer e Sistema. Cada aba reúne funções relacionadas para facilitar a navegação.',
    badge: 'Menu',
  },
  {
    icon: <MessageCircle size={80} color="#0d9488" aria-hidden="true" />,
    title: 'Aba: Comunicação',
    description:
      'Aqui ficam as ferramentas de voz e texto: Teclado Virtual, Frases Rápidas, Pictogramas (CAA), o Assistente de IA e o botão de Urgência Médica.',
    badge: 'Comunicação',
  },
  {
    icon: <Activity size={80} color="#e11d48" aria-hidden="true" />,
    title: 'Aba: Cuidados',
    description:
      'Monitore sua saúde diária: registre o nível de dor, complete a rotina com o Cuidador, pratique respiração guiada com a Meditação Visual e envie o sinal "Estou Bem" para a família.',
    badge: 'Cuidados',
  },
  {
    icon: <Gamepad2 size={80} color="#8b5cf6" aria-hidden="true" />,
    title: 'Aba: Lazer',
    description:
      'Explore os Mini-Jogos de exercício ocular, o Desenho Livre no Canvas, a Galeria de Fotos da família e o Jornal do Dia lido em voz alta pela IA.',
    badge: 'Lazer',
  },
  {
    icon: <Settings size={80} color="#334155" aria-hidden="true" />,
    title: 'Aba: Sistema',
    description:
      'Configure o aplicativo, realize backup das suas preferências e ative o Painel do Mouse Virtual — que permite controlar o cursor do Windows com os olhos.',
    badge: 'Sistema',
  },
  {
    icon: <CheckCircle size={80} color="#9333ea" aria-hidden="true" />,
    title: 'Tudo Pronto!',
    description:
      'Você está preparado para usar o IrisFlow. Selecione o perfil do paciente e comece a explorar todas as funcionalidades da plataforma.',
    badge: 'Concluído',
  },
];

export const TutorialScreen: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < TUTORIAL_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      navigate('/profiles');
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const step = TUTORIAL_STEPS[currentStep];

  return (
    <main
      role="main"
      aria-labelledby="tutorial-title"
      style={{
        minHeight: '100vh',
        backgroundColor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        role="region"
        aria-live="polite"
        aria-label={`Tutorial passo ${currentStep + 1} de ${TUTORIAL_STEPS.length}`}
        style={{
          maxWidth: 700,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '2rem',
        }}
      >
        <div
          style={{
            background: '#f1f5f9',
            padding: '0.5rem 1.5rem',
            borderRadius: '2rem',
            fontSize: '1.1rem',
            fontWeight: 700,
            color: '#334155',
            letterSpacing: '0.05em',
          }}
        >
          {step.badge}
        </div>

        <div
          aria-hidden="true"
          style={{
            background: '#f1f5f9',
            padding: '3rem',
            borderRadius: '50%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
          }}
        >
          {step.icon}
        </div>

        <h1
          id="tutorial-title"
          style={{ fontSize: '2.5rem', color: '#1e293b', margin: 0, fontWeight: 800 }}
        >
          {step.title}
        </h1>
        <p style={{ fontSize: '1.5rem', color: '#475569', lineHeight: 1.5, margin: 0 }}>
          {step.description}
        </p>

        <ol
          aria-label="Progresso do tutorial"
          style={{
            display: 'flex',
            gap: '1rem',
            margin: '2rem 0',
            listStyle: 'none',
            padding: 0,
          }}
        >
          {TUTORIAL_STEPS.map((_, idx) => (
            <li
              key={idx}
              aria-current={idx === currentStep ? 'step' : undefined}
              style={{
                width: idx === currentStep ? '30px' : '15px',
                height: '15px',
                borderRadius: '10px',
                background: idx === currentStep ? '#1B54A8' : '#cbd5e1',
                transition: 'all 0.3s',
              }}
            />
          ))}
        </ol>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentStep === 0}
            aria-label="Passo anterior"
            style={{
              background: 'white',
              color: '#475569',
              border: '2px solid #e2e8f0',
              padding: '1.25rem 2rem',
              borderRadius: '1.5rem',
              fontSize: '1.25rem',
              fontWeight: 700,
              cursor: currentStep === 0 ? 'not-allowed' : 'pointer',
              opacity: currentStep === 0 ? 0.4 : 1,
            }}
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label={
              currentStep === TUTORIAL_STEPS.length - 1 ? 'Concluir tutorial' : 'Próximo passo'
            }
            style={{
              background: '#1B54A8',
              color: 'white',
              border: 'none',
              padding: '1.25rem 3rem',
              borderRadius: '1.5rem',
              fontSize: '1.5rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              boxShadow: '0 8px 20px rgba(27,84,168,0.3)',
            }}
          >
            {currentStep === TUTORIAL_STEPS.length - 1 ? 'Começar' : 'Próximo'}
            <ArrowRight size={28} aria-hidden="true" />
          </button>
        </div>
      </div>
    </main>
  );
};

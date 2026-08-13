import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  Keyboard,
  Monitor,
  Settings,
  Play
} from 'lucide-react';

const TUTORIAL_STEPS = [
  {
    id: 'intro',
    icon: <Eye size={100} color="#1B54A8" />,
    title: 'Comunicação',
    description: 'Comunique-se de forma rápida e eficiente utilizando apenas o movimento dos seus olhos.',
  },
  {
    id: 'keyboard',
    icon: <Keyboard size={100} color="#16a34a" />,
    title: 'Teclado Virtual',
    description: 'Digite textos, navegue na internet e expresse suas ideias através do nosso teclado adaptado para o olhar.',
  },
  {
    id: 'computer',
    icon: <Monitor size={100} color="#8b5cf6" />,
    title: 'Controle do Computador',
    description: 'Use o IrisFlow como um mouse virtual para controlar totalmente o sistema operacional do seu computador.',
  },
  {
    id: 'settings',
    icon: <Settings size={100} color="#f59e0b" />,
    title: 'Personalização',
    description: 'Ajuste a velocidade de seleção, sensibilidade do olhar e o layout da tela para o seu maior conforto.',
  },
  {
    id: 'ready',
    icon: <Play size={100} color="#ec4899" />,
    title: 'Tudo Pronto!',
    description: 'Vamos realizar uma rápida calibração do seu olhar para garantir a máxima precisão antes de começar.',
  },
];

export const TutorialScreen: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleNext = () => {
    if (isAnimating) return;
    if (currentStep < TUTORIAL_STEPS.length - 1) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep((s) => s + 1);
        setIsAnimating(false);
      }, 300);
    } else {
      navigate('/calibration-check');
    }
  };

  const handlePrev = () => {
    if (isAnimating) return;
    if (currentStep > 0) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep((s) => s - 1);
        setIsAnimating(false);
      }, 300);
    }
  };

  const skipTutorial = () => navigate('/calibration-check');

  const step = TUTORIAL_STEPS[currentStep];
  const isLast = currentStep === TUTORIAL_STEPS.length - 1;

  return (
    <main
      role="main"
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-bg-base)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 800,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '2.5rem',
          opacity: isAnimating ? 0 : 1,
          transform: isAnimating ? 'scale(0.98) translateY(10px)' : 'scale(1) translateY(0)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div
          key={`icon-${step.id}`}
          className="animate-fade-in-up"
          style={{
            padding: '2rem',
            animationDuration: '0.6s'
          }}
        >
          {step.icon}
        </div>

        <div key={`text-${step.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0 2rem' }}>
          <h1
            className="animate-fade-in-up"
            style={{ fontSize: '2.8rem', color: 'var(--color-text-base)', margin: 0, fontWeight: 800, animationDelay: '0.1s', animationFillMode: 'both' }}
          >
            {step.title}
          </h1>
          <p 
            className="animate-fade-in-up"
            style={{ fontSize: '1.4rem', color: 'var(--color-text-base)', opacity: 0.8, lineHeight: 1.6, margin: 0, animationDelay: '0.2s', animationFillMode: 'both', maxWidth: 600 }}
          >
            {step.description}
          </p>
        </div>

        <ol
          style={{
            display: 'flex',
            gap: '1rem',
            margin: '1.5rem 0',
            listStyle: 'none',
            padding: 0,
          }}
        >
          {TUTORIAL_STEPS.map((_, idx) => (
            <li
              key={idx}
              style={{
                width: idx === currentStep ? '32px' : '12px',
                height: '12px',
                borderRadius: '6px',
                background: idx === currentStep ? '#1B54A8' : '#cbd5e1',
                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          ))}
        </ol>

        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={isLast ? handlePrev : skipTutorial}
            style={{
              background: 'transparent',
              color: 'var(--color-text-base)', opacity: 0.8,
              border: 'none',
              padding: '1.25rem 2rem',
              borderRadius: '1.5rem',
              fontSize: '1.25rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'color 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.color = '#334155'}
            onMouseOut={(e) => e.currentTarget.style.color = '#64748b'}
          >
            {isLast ? 'Voltar' : 'Pular tutorial'}
          </button>
          
          <button
            type="button"
            onClick={handleNext}
            style={{
              background: '#1B54A8',
              color: 'white',
              border: 'none',
              padding: '1.25rem 3.5rem',
              borderRadius: '2rem',
              fontSize: '1.4rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              boxShadow: '0 12px 24px rgba(27,84,168,0.25)',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 16px 32px rgba(27,84,168,0.3)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(27,84,168,0.25)';
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = 'translateY(2px)'}
          >
            {isLast ? 'Começar Calibração' : 'Próximo'}
            <ArrowRight size={26} />
          </button>
        </div>
      </div>
    </main>
  );
};

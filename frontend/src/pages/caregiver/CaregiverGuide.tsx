import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Crosshair,
  Eye,
  Glasses,
  LifeBuoy,
  Ruler,
  Siren,
  Sun,
  Target,
  Video,
} from 'lucide-react';
import { CaregiverPageLayout } from '../../components/ui/CaregiverPageLayout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, Note } from './CaregiverControls';
import './caregiver.css';

const TOPICS = [
  { id: 'guia-camera', label: 'Câmera' },
  { id: 'guia-luz', label: 'Iluminação' },
  { id: 'guia-oculos', label: 'Óculos' },
  { id: 'guia-distancia', label: 'Distância e postura' },
  { id: 'guia-calibrar', label: 'Como calibrar' },
  { id: 'guia-precisao', label: 'Teste de precisão' },
  { id: 'guia-piorou', label: 'Quando piora' },
  { id: 'guia-emergencia', label: 'Emergência' },
];

/** Guia de instalação e suporte do cuidador. Texto sem jargão interno. */
export const CaregiverGuide: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromRoute = searchParams.get('from') || '/settings';
  const backLabel = fromRoute.startsWith('/caregiver')
    ? 'Voltar ao painel'
    : fromRoute.startsWith('/calibration-check')
      ? 'Voltar à calibração'
      : 'Voltar às configurações';

  return (
    <CaregiverPageLayout title="Guia de Instalação e Suporte">
      <div className="cg-stack" style={{ maxWidth: 880, margin: '0 auto' }}>
        <PageHeader
          title="Guia do cuidador"
          subtitle="Como montar o posto de uso, calibrar e manter o rastreamento funcionando bem."
          icon={<BookOpen size={28} aria-hidden="true" />}
          showBack={false}
          actions={
            <button type="button" className="btn btn--secondary" onClick={() => navigate(fromRoute)} data-no-dwell="true">
              <ArrowLeft size={18} aria-hidden="true" /> {backLabel}
            </button>
          }
        />

        <nav className="cg-subnav" aria-label="Tópicos do guia">
          {/* Botões, não `<a href="#id">`: sob HashRouter o hash É a rota. */}
          {TOPICS.map((tp) => (
            <button
              key={tp.id}
              type="button"
              className="btn btn--ghost"
              data-no-dwell="true"
              onClick={() => document.getElementById(tp.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {tp.label}
            </button>
          ))}
        </nav>

        <Note tone="info" title="A regra que resolve a maioria dos problemas">
          Rosto bem iluminado pela frente, câmera na altura dos olhos, paciente a 50–70 cm da tela e sempre na
          mesma posição. Quase todo erro de rastreamento vem de um desses quatro itens.
        </Note>

        <Card id="guia-camera" title="1. Posicionamento da Câmera" icon={<Video size={24} />}>
          <div className="cg-prose">
            <ul>
              <li>
                <strong>Onde:</strong> centralizada logo abaixo da tela (preferência) ou logo acima, apontada para
                os olhos. Câmera de lado força o modelo de olhar a adivinhar.
              </li>
              <li>
                <strong>Altura:</strong> a lente deve ficar próxima da altura dos olhos. Quanto mais de cima ou de
                baixo ela olhar, menor a parte visível da íris.
              </li>
              <li>
                <strong>Enquadramento:</strong> rosto inteiro visível, centralizado e nivelado. A tela de preparação
                mostra a imagem e avisa quando o enquadramento está ruim.
              </li>
              <li>
                <strong>Fixação:</strong> a câmera não pode balançar. Se ela se mover depois da calibração, os pontos
                deixam de bater e é preciso recalibrar.
              </li>
              <li>
                <strong>Resolução:</strong> prefira webcams Full HD (1920×1080). Feche outros programas que usem a
                câmera (videochamadas, OBS), senão ela pode abrir em resolução menor ou nem abrir.
              </li>
            </ul>
          </div>
        </Card>

        <Card id="guia-luz" title="2. Iluminação do Ambiente" icon={<Sun size={24} />}>
          <div className="cg-prose">
            <ul>
              <li>
                <strong>Luz pela frente:</strong> a fonte de luz deve iluminar o rosto, vindo de trás da tela ou dos
                lados. Uma luminária atrás do monitor, apontada para o paciente, resolve a maior parte dos casos.
              </li>
              <li>
                <strong>Evite contraluz:</strong> nunca com uma janela ou lâmpada forte atrás do paciente. O rosto
                fica escuro e a câmera não enxerga os olhos.
              </li>
              <li>
                <strong>Luz uniforme e indireta:</strong> sem sombras fortes de um lado só e sem reflexos duros nas
                córneas ou nas lentes.
              </li>
              <li>
                <strong>Constante:</strong> a luz da calibração deve ser a luz do uso. Se anoitecer e a luz mudar
                muito, recalibre.
              </li>
            </ul>
          </div>
        </Card>

        <Card id="guia-oculos" title="3. Uso de Óculos e Lentes" icon={<Glasses size={24} />}>
          <div className="cg-prose">
            <ul>
              <li>
                <strong>Reflexos nas lentes:</strong> um brilho branco sobre o olho impede a leitura da íris. Incline
                levemente a câmera ou a tela até o reflexo sair de cima dos olhos na imagem.
              </li>
              <li>
                <strong>Lentes limpas:</strong> poeira e marcas de dedo espalham a luz e aumentam o erro.
              </li>
              <li>
                <strong>Multifocais:</strong> podem reduzir a precisão. Alinhe o olhar pelo centro das lentes e, se
                possível, use um óculos de grau simples durante o uso.
              </li>
              <li>
                <strong>Calibre com o que vai usar:</strong> com óculos e sem óculos são condições diferentes. Informe
                a condição na calibração; o app guarda um perfil para cada uma.
              </li>
            </ul>
          </div>
        </Card>

        <Card id="guia-distancia" title="4. Distância e postura" icon={<Ruler size={24} />}>
          <div className="cg-prose">
            <ul>
              <li>
                <strong>Distância:</strong> entre 50 e 70 cm dos olhos à tela. Mais perto, os cantos da tela exigem
                movimentos de olho grandes; mais longe, a íris fica pequena na imagem.
              </li>
              <li>
                <strong>Sempre a mesma:</strong> a calibração aprende a distância daquele momento. Marque a posição
                da cadeira ou da cama e confira antes de cada sessão. Há uma compensação de cabeça, mas ela cobre
                pequenos ajustes, não uma mudança de poltrona.
              </li>
              <li>
                <strong>Cabeça apoiada:</strong> encosto ou apoio de cabeça reduz o tremor e a fadiga. A cabeça não
                precisa ficar imóvel, mas quanto mais estável, melhor.
              </li>
              <li>
                <strong>Informe a geometria:</strong> em Configurações → Tela, digite a diagonal da tela e a
                distância medida com fita. É o que faz o erro em graus do teste de precisão ser verdadeiro.
              </li>
            </ul>
          </div>
        </Card>

        <Card id="guia-calibrar" title="5. Como calibrar" icon={<Crosshair size={24} />}>
          <ol className="cg-steps">
            <li>
              <span>
                <strong>Prepare o posto.</strong> Ajuste câmera, luz e distância como acima. A tela de preparação mostra
                as checagens em verde, amarelo ou vermelho; corrija os vermelhos antes de continuar.
              </span>
            </li>
            <li>
              <span>
                <strong>Explique ao paciente:</strong> vão aparecer pontos, um de cada vez. Ele deve olhar para o
                centro de cada ponto e mover <strong>só os olhos</strong>, sem virar a cabeça. Piscar é normal.
              </span>
            </li>
            <li>
              <span>
                <strong>Inicie a calibração</strong> pelo botão Recalibrar (no painel ou em Configurações →
                Calibração). A calibração completa tem 9 pontos; a rápida, 4, serve para pequenos ajustes no mesmo
                dia.
              </span>
            </li>
            <li>
              <span>
                <strong>Não interfira durante a coleta.</strong> Falar com o paciente, apontar para a tela ou se
                mover na frente da câmera contamina as amostras. Se a janela perder o foco, a calibração recomeça.
              </span>
            </li>
            <li>
              <span>
                <strong>Faça o teste de precisão</strong> ao final. Ele diz se dá para usar ou se é melhor repetir.
                Se o app avisar que a cabeça se moveu, repita: a calibração ficou contaminada.
              </span>
            </li>
          </ol>
          <p className="cg-card__foot">
            A calibração anterior continua valendo até a nova terminar. Cancelar no meio não apaga nada.
          </p>
        </Card>

        <Card id="guia-precisao" title="6. Como ler o teste de precisão" icon={<Target size={24} />}>
          <div className="cg-prose">
            <p>
              O teste mostra 13 pontos e mede a distância entre onde o paciente olhou e onde o app achou que ele
              olhou. Dois números importam:
            </p>
            <ul style={{ marginTop: '0.75rem' }}>
              <li>
                <strong>Erro médio</strong> (em graus e em pixels): o quanto o cursor cai fora do alvo, em média. É
                a exatidão. Em graus ele não depende do tamanho da tela; em pixels, sim.
              </li>
              <li>
                <strong>Tremor</strong> (precisão, em pixels): o quanto o cursor vibra em volta de um ponto parado.
                Erro médio baixo com tremor alto significa que o cursor está no lugar certo, mas trêmulo; a suavização
                Estável ajuda.
              </li>
            </ul>
            <div className="cg-table-wrap" style={{ marginTop: '1rem' }}>
              <table className="cg-table">
                <thead>
                  <tr>
                    <th>Erro médio</th>
                    <th>O que significa</th>
                    <th>O que fazer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>até 1,0°</td>
                    <td>Excelente. Teclado e menus funcionam bem.</td>
                    <td>Nada. Anote a condição (luz, óculos) que deu certo.</td>
                  </tr>
                  <tr>
                    <td>1,0° a 1,5°</td>
                    <td>Bom. Botões grandes funcionam; letras pequenas podem falhar.</td>
                    <td>Use tempo de fixação Normal ou Devagar. Confira luz e distância.</td>
                  </tr>
                  <tr>
                    <td>1,5° a 2,5°</td>
                    <td>Regular. Cliques por engano ficam frequentes.</td>
                    <td>Recalibre depois de corrigir o posto. Prefira varredura ou frases prontas.</td>
                  </tr>
                  <tr>
                    <td>acima de 2,5°</td>
                    <td>Ruim. Não dá para usar com conforto.</td>
                    <td>Revise câmera, luz, óculos e distância; recalibre com calibração completa.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: '1rem' }}>
              Para ter noção: a 60 cm da tela, 1° corresponde a cerca de 1 cm. Pontos individuais em vermelho no
              resumo indicam cantos da tela onde o erro é maior; se for sempre o mesmo canto, a câmera provavelmente
              está torta ou a luz é desigual.
            </p>
          </div>
        </Card>

        <Card id="guia-piorou" title="O que fazer se a calibração falhar constantemente ou piorar" icon={<LifeBuoy size={24} />} iconTone="warn">
          <div className="cg-prose">
            <ul>
              <li>
                <strong>Primeiro o posto, depois a calibração.</strong> Recalibrar sem corrigir luz, distância ou
                reflexo produz outra calibração ruim. Volte à tela de preparação e deixe as checagens verdes.
              </li>
              <li>
                <strong>Piorou ao longo da sessão?</strong> O paciente provavelmente escorregou na cadeira ou a luz
                mudou. Reposicione e use a recalibração rápida.
              </li>
              <li>
                <strong>Cliques por engano:</strong> aumente o tempo de fixação (Devagar) e mude a suavização para
                Estável, em Configurações → Rastreamento.
              </li>
              <li>
                <strong>Cursor demora a responder:</strong> mude a suavização para Responsivo. Se os quadros por
                segundo em Diagnóstico estiverem abaixo de 20, feche outros programas.
              </li>
              <li>
                <strong>Fadiga:</strong> pessoas com ELA cansam rápido. Sessões curtas, pausas na tela de descanso e
                tema escuro reduzem piscadas e erros. Um erro médio que sobe semana após semana merece conversa com a
                equipe de saúde.
              </li>
              <li>
                <strong>Rastreamento degradado ou "sem rosto":</strong> o app mostra um aviso no topo. Confira se a
                câmera não foi tomada por outro programa e se o rosto está iluminado; depois recalibre.
              </li>
            </ul>
          </div>
        </Card>

        <Card id="guia-emergencia" title="Emergência" icon={<Siren size={24} />} iconTone="danger">
          <div className="cg-prose">
            <p>
              O botão vermelho fica sempre visível para o paciente. Ao acioná-lo, há uma contagem de 5 segundos para
              cancelar; depois o app toca um alarme neste computador, fala em voz alta o pedido de ajuda e, se houver
              um servidor configurado, envia um aviso.
            </p>
            <Note tone="danger" className="mt-4">
              O alerta é local: ele não liga para serviços de emergência nem para familiares. Mantenha sempre um
              cuidador ao alcance do som e combine com o paciente o que cada tipo de alerta significa.
            </Note>
            <p style={{ marginTop: '1rem' }}>
              O botão continua funcionando mesmo durante a calibração e quando o rastreamento está degradado; nesses
              casos ele exige uma fixação mais longa, para evitar disparos por engano.
            </p>
          </div>
        </Card>

        <Card id="guia-icones" title="Ícones e avisos que o paciente vê" icon={<Eye size={24} />} variant="soft">
          <div className="cg-prose">
            <ul>
              <li>
                <strong>Faixa amarela no topo:</strong> aviso de distância ou de olhar perdido. Some sozinha quando a
                condição volta ao normal.
              </li>
              <li>
                <strong>Faixa vermelha:</strong> câmera indisponível ou calibração inválida. Precisa de ação do
                cuidador.
              </li>
              <li>
                <strong>Botão "Recalibre aqui":</strong> aparece quando o rastreamento se degrada; o paciente pode
                acioná-lo sozinho com uma fixação longa.
              </li>
              <li>
                <strong>Sugestão de pausa:</strong> após muitos minutos de uso ou muitas piscadas, o app sugere a tela
                de descanso. É sugestão, não bloqueio.
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </CaregiverPageLayout>
  );
};

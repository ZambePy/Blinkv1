import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import i18n from '../../../i18n';
import { EscolhaDaCamera } from './EscolhaDaCamera';
import type { CameraCapacidade, CameraDevice } from '../../../services/camera/devices';

// -----------------------------------------------------------------------------
// A informação que esta tela existe para entregar: quantos quadros por segundo
// a webcam REALMENTE dá. O pipeline assume 30 — a 15, as janelas de baseline da
// calibração e o detector de flicker trabalham com metade dos quadros, e isso
// aparece no relatório sem explicação.
//
// Mas a tela avisa; nunca impede. Negar comunicação a alguém com ELA porque a
// webcam é barata é pior do que precisão ruim.
// -----------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const duasCameras: CameraDevice[] = [
  { deviceId: 'cam1', label: 'Webcam integrada' },
  { deviceId: 'cam2', label: 'Logitech C920' },
];

const cap = (fps: number): CameraCapacidade => ({
  larguraPx: 1280,
  alturaPx: 720,
  fpsMedido: fps,
  fpsDeclarado: 30,
});

const montar = (props: Partial<React.ComponentProps<typeof EscolhaDaCamera>> = {}) =>
  render(
    <EscolhaDaCamera
      cameras={duasCameras}
      selecionada="cam1"
      capacidade={cap(30)}
      medindo={false}
      aoSelecionar={vi.fn()}
      aoRecarregar={vi.fn()}
      videoRef={React.createRef<HTMLVideoElement>()}
      {...props}
    />
  );

describe('a lista de câmeras', () => {
  it('mostra todas as encontradas', () => {
    montar();
    expect(screen.getByText('Webcam integrada')).toBeInTheDocument();
    expect(screen.getByText('Logitech C920')).toBeInTheDocument();
  });

  it('avisa e oferece recarregar quando não há nenhuma', () => {
    const aoRecarregar = vi.fn();
    montar({ cameras: [], selecionada: null, capacidade: null, aoRecarregar });

    expect(screen.getByText(/nenhuma câmera encontrada/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /procurar de novo/i }));
    expect(aoRecarregar).toHaveBeenCalled();
  });

  it('trocar de câmera avisa quem monta', () => {
    const aoSelecionar = vi.fn();
    montar({ aoSelecionar });

    fireEvent.click(screen.getByText('Logitech C920'));
    expect(aoSelecionar).toHaveBeenCalledWith('cam2');
  });
});

describe('o que a câmera entrega', () => {
  it('mostra a resolução medida', () => {
    montar();
    expect(screen.getByText(/1280/)).toBeInTheDocument();
  });

  it('mostra o FPS medido, arredondado para leitura', () => {
    montar({ capacidade: cap(29.7) });
    expect(screen.getByText(/^30$/)).toBeInTheDocument();
  });

  it('mostra o que a câmera declara ao lado do medido', () => {
    // Os dois juntos é que contam a história: "ela diz 30 e entrega 15".
    montar({ capacidade: { ...cap(15), fpsDeclarado: 30 } });
    expect(screen.getByText(/declara/i)).toBeInTheDocument();
  });

  it('diz que está medindo em vez de mostrar zero', () => {
    montar({ medindo: true, capacidade: null });
    expect(screen.getByText(/medindo/i)).toBeInTheDocument();
  });
});

describe('o veredito de FPS', () => {
  it('30 fps: taxa boa', () => {
    montar({ capacidade: cap(30) });
    expect(screen.getByText(/taxa boa/i)).toBeInTheDocument();
  });

  it('15 fps: avisa que a precisão piora — o caso do pedido', () => {
    montar({ capacidade: cap(15) });
    expect(screen.getByText(/taxa baixa/i)).toBeInTheDocument();
  });

  it('8 fps: avisa que vai responder devagar', () => {
    montar({ capacidade: cap(8) });
    expect(screen.getByText(/taxa muito baixa/i)).toBeInTheDocument();
  });
});

describe('nunca bloqueia', () => {
  it('deixa explícito na tela que dá para continuar com qualquer câmera', () => {
    montar({ capacidade: cap(8) });
    expect(screen.getByText(/não um impedimento/i)).toBeInTheDocument();
  });

  it('não renderiza nenhum controle desabilitado, nem com a pior taxa', () => {
    // A tela não é dona do botão "Continuar" — quem é, é o wizard. O que ela
    // não pode fazer é oferecer algo travado por causa da taxa.
    const { container } = montar({ capacidade: cap(2) });
    expect(container.querySelectorAll('[disabled]')).toHaveLength(0);
  });
});

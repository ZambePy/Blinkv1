export abstract class Component<Props = {}, State = {}> {
  protected props: Props;
  protected state: State;
  protected element: HTMLElement | null = null;

  constructor(props: Props = {} as Props) {
    this.props = props;
    this.state = {} as State;
  }

  public setState(newState: Partial<State>): void {
    this.state = { ...this.state, ...newState };
    this.update();
  }

  protected update(): void {
    if (this.element) {
      const newElement = this.render();
      if (newElement && this.element.parentElement) {
        this.element.parentElement.replaceChild(newElement, this.element);
        this.element = newElement;
      }
    }
  }

  public mount(container: HTMLElement): void {
    const el = this.render();
    if (el) {
      this.element = el;
      container.appendChild(this.element);
    }
  }

  public unmount(): void {
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
      this.element = null;
    }
  }

  abstract render(): HTMLElement | null;
}

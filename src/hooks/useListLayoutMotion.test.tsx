import { act, render } from '@testing-library/react';

import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';

function KeyedList({ items }: { items: string[] }) {
  const ref = useListLayoutMotion<HTMLUListElement>(items);
  return (
    <ul ref={ref} data-testid='list'>
      {items.map((item) => (
        <li key={item} data-list-motion-key={item}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function OrderedList({ items }: { items: string[] }) {
  const ref = useListLayoutMotion<HTMLDivElement>(items, {
    matchChildOrder: true,
  });
  return (
    <div ref={ref} data-testid='list'>
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

type FakeAnimation = EventTarget & { finish: () => void; cancel: () => void };

describe('useListLayoutMotion', () => {
  let animations: FakeAnimation[];

  beforeEach(() => {
    animations = [];
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    Element.prototype.animate = jest.fn(function animate() {
      const animation = Object.assign(new EventTarget(), {
        finish() {
          animation.dispatchEvent(new Event('finish'));
        },
        cancel() {
          animation.dispatchEvent(new Event('cancel'));
        },
      });
      animations.push(animation);
      return animation as unknown as Animation;
    });
    Element.prototype.getAnimations = jest.fn(() => []);
  });

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
    delete (Element.prototype as Partial<Element>).getAnimations;
  });

  it.each([
    ['keyed items', KeyedList],
    ['child order', OrderedList],
  ])('keeps a removed item as a fading ghost (%s)', (_, List) => {
    const { getByTestId, rerender } = render(<List items={['a', 'b', 'c']} />);
    rerender(<List items={['a', 'c']} />);

    const list = getByTestId('list');
    const ghost = list.querySelector('[data-list-motion-ghost]');
    expect(ghost).toHaveTextContent('b');
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(ghost).toHaveStyle({ position: 'absolute' });

    act(() => animations.forEach((animation) => animation.finish()));
    expect(list.querySelector('[data-list-motion-ghost]')).toBeNull();
    expect(list).toHaveTextContent('ac');
  });

  it('finishes replayed finite animations and leaves infinite ones running', () => {
    const replayed = (endTime: number) => ({
      effect: { getComputedTiming: () => ({ endTime }) },
      finish: jest.fn(),
    });
    const finite = replayed(320);
    const infinite = replayed(Infinity);
    Element.prototype.getAnimations = jest.fn(
      () => [finite, infinite] as unknown as Animation[],
    );

    const { getByTestId, rerender } = render(
      <KeyedList items={['a', 'b', 'c']} />,
    );
    expect(() => rerender(<KeyedList items={['a', 'c']} />)).not.toThrow();

    expect(finite.finish).toHaveBeenCalledTimes(1);
    expect(infinite.finish).not.toHaveBeenCalled();
    expect(
      getByTestId('list').querySelector('[data-list-motion-ghost]'),
    ).toHaveTextContent('b');
  });

  it('skips append-only growth and large replacements', () => {
    const { getByTestId, rerender } = render(<KeyedList items={['a', 'b']} />);
    rerender(<KeyedList items={['a', 'b', 'c', 'd']} />);
    expect(Element.prototype.animate).not.toHaveBeenCalled();

    const replaced = Array.from({ length: 9 }, (_, index) => `n${index}`);
    rerender(<KeyedList items={replaced} />);
    expect(
      getByTestId('list').querySelector('[data-list-motion-ghost]'),
    ).toBeNull();
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });

  it('fades in items inserted before existing ones', () => {
    const { rerender } = render(<KeyedList items={['b', 'c']} />);
    rerender(<KeyedList items={['a', 'b', 'c']} />);
    expect(Element.prototype.animate).toHaveBeenCalledTimes(1);
  });
});

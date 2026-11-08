import { fireEvent, render, screen } from '@testing-library/react';

import {
  ratingFromPointerOffset,
  RatingInput,
} from '@/features/play/components/EpisodeSelector/RatingInput';

describe('RatingInput', () => {
  it('steps by 0.1 with arrow keys, by 1 with shift, and clears below the minimum', () => {
    const onChange = jest.fn();
    const { rerender } = render(<RatingInput value={8} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: '评分' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(8.1);
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(9);
    fireEvent.keyDown(slider, { key: 'Delete' });
    expect(onChange).toHaveBeenLastCalledWith(null);

    rerender(<RatingInput value={1} onChange={onChange} />);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(null);

    rerender(<RatingInput value={8.6} onChange={onChange} />);
    expect(slider).toHaveAttribute('aria-valuetext', '8.6 分');
    expect(screen.getByLabelText('分数（1.0–10.0）')).toHaveValue('8.6');
  });

  it('commits a typed score rounded to one decimal and clamped to range', () => {
    const onChange = jest.fn();
    render(<RatingInput value={null} onChange={onChange} />);
    const input = screen.getByLabelText('分数（1.0–10.0）');

    fireEvent.change(input, { target: { value: '8.65' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(8.7);

    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(10);

    onChange.mockClear();
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it('snaps pointer positions to half points', () => {
    expect(ratingFromPointerOffset(43, 100)).toBe(4.5);
    expect(ratingFromPointerOffset(86, 100)).toBe(9);
    expect(ratingFromPointerOffset(1, 100)).toBe(1);
    expect(ratingFromPointerOffset(140, 100)).toBe(10);
  });
});

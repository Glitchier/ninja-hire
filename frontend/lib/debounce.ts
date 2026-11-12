/**
 * Hand-written Debounce function holding timeout state in its closure.
 * Written by hand without lodash as required by Part 3.6.
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  delayMs: number
): { (...args: Parameters<T>): void; cancel: () => void } {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const debounced = function (...args: Parameters<T>) {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      func(...args);
      timerId = null;
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return debounced;
}

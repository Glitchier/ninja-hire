import { useEffect, useState } from "react";

function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): { (...args: Args): void; cancel: () => void } {
  let timeId: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Args) => {
    if (timeId !== null) {
      clearTimeout(timeId);
    }
    timeId = setTimeout(() => {
      fn(...args);
      timeId = null;
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timeId !== null) {
      clearTimeout(timeId);
      timeId = null;
    }
  };
  return debounced;
}

export default debounce;

// Debounce modern (using useEffect)

export function useDebounce<T>(value: T, delay = 300) {
  const [debounce, setDebounce] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounce(value), delay);
    return clearTimeout(id);
  }, [value, delay]);
  return debounce;
}

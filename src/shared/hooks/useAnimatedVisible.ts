import { useState, useEffect } from 'react';

interface UseAnimatedVisibleResult {
  shouldRender: boolean;
  animating: boolean;
}

/**
 * Delays unmounting so an exit CSS animation can play.
 * @param visible - the "logical" visibility prop
 * @param duration - exit animation duration in ms (default 200)
 * @returns { shouldRender, animating }
 *   - shouldRender: true while the component should stay in the DOM
 *   - animating: false = entering/visible, true = exit animation playing
 */
export function useAnimatedVisible(visible: boolean, duration: number = 200): UseAnimatedVisibleResult {
  const [shouldRender, setShouldRender] = useState(visible);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      setAnimating(false);
    } else if (shouldRender) {
      setAnimating(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setAnimating(false);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, duration]);

  return { shouldRender, animating };
}

import { forwardRef, useImperativeHandle, useRef, type ComponentPropsWithoutRef } from 'react';
import { usePressMotion } from '../hooks/usePressMotion';

/** Stable native hit target with independently animated artwork. */
const MotionButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(function MotionButton({ children, className = '', ...props }, forwardedRef) {
  const ref = useRef<HTMLButtonElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current!);
  usePressMotion(ref);
  return <button {...props} ref={ref} className={`motion-control ${className}`}><span className="motion-control-artwork">{children}</span></button>;
});
export default MotionButton;

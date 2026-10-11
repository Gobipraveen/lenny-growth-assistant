import React, { useCallback } from 'react';

/**
 * Accessible Draggable Divider for Resizable Desktop Panels.
 * Supports mouse/pointer dragging and keyboard navigation with Arrow keys.
 */
export function PanelDivider({
  id,
  orientation = 'vertical',
  onResize,
  onResizeEnd,
  min = 200,
  max = 700,
  currentValue = 280,
  ariaLabel = 'Resize panel',
  side = 'left', // 'left' (sidebar) or 'right' (artifact)
  disabled = false,
}) {
  const handlePointerDown = useCallback(
    (e) => {
      if (disabled) return;
      e.preventDefault();

      const startX = e.clientX;
      const initialValue = currentValue;

      // Add resizing class to body to prevent text selection and set col-resize cursor
      document.body.classList.add('resizing-active');

      let animationFrameId = null;

      const handlePointerMove = (moveEvent) => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }

        animationFrameId = requestAnimationFrame(() => {
          const deltaX = moveEvent.clientX - startX;
          const newValue = side === 'left' ? initialValue + deltaX : initialValue - deltaX;
          onResize(newValue);
        });
      };

      const handlePointerUp = () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
        document.body.classList.remove('resizing-active');
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);

        if (onResizeEnd) {
          onResizeEnd();
        }
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [currentValue, disabled, onResize, onResizeEnd, side]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (disabled) return;
      const step = e.shiftKey ? 32 : 16;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const delta = side === 'left' ? -step : step;
        onResize(currentValue + delta);
        if (onResizeEnd) onResizeEnd();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = side === 'left' ? step : -step;
        onResize(currentValue + delta);
        if (onResizeEnd) onResizeEnd();
      } else if (e.key === 'Home') {
        e.preventDefault();
        onResize(min);
        if (onResizeEnd) onResizeEnd();
      } else if (e.key === 'End') {
        e.preventDefault();
        onResize(max);
        if (onResizeEnd) onResizeEnd();
      }
    },
    [currentValue, disabled, min, max, onResize, onResizeEnd, side]
  );

  if (disabled) return null;

  return (
    <div
      id={id}
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuenow={Math.round(currentValue)}
      aria-valuemin={min}
      aria-valuemax={max}
      className={`panel-divider ${side}-divider`}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      title={`${ariaLabel} (Drag or use Left/Right arrows)`}
    >
      <div className="divider-handle" aria-hidden="true">
        <span className="divider-grip-dot" />
        <span className="divider-grip-dot" />
        <span className="divider-grip-dot" />
      </div>
    </div>
  );
}

export function shouldPreviewLink(
  event: {button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean},
  pointerType: string,
  coarsePointer: boolean,
) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
    (pointerType === 'touch' || pointerType === 'pen' || coarsePointer);
}

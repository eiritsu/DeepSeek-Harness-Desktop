import AppKit

let windowDragRegionAutoresizingMask: NSView.AutoresizingMask = [.maxXMargin, .height]

func windowDragRegionFrame(
  in bounds: NSRect,
  leadingInset: CGFloat = 90,
  maximumWidth: CGFloat = 220
) -> NSRect {
  let leading = max(0, leadingInset)
  let availableWidth = max(0, bounds.width - leading)
  let width = min(max(0, maximumWidth), availableWidth)
  return NSRect(
    x: bounds.minX + min(leading, bounds.width),
    y: bounds.minY,
    width: width,
    height: bounds.height
  )
}

@MainActor
final class WindowDragRegionView: NSView {
  override var mouseDownCanMoveWindow: Bool { true }

  override func mouseDown(with event: NSEvent) {
    window?.performDrag(with: event)
  }
}

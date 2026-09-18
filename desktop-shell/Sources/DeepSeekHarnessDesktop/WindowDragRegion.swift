import AppKit

let windowDragRegionAutoresizingMask: NSView.AutoresizingMask = [.width, .height]

/// Safe titlebar drag geometry. The rest of the titlebar is deliberately left
/// transparent to hit testing so WebKit controls remain clickable.
struct WindowDragLayout {
  var leadingInset: CGFloat = 90
  var maximumWidth: CGFloat = 220
}

/// Return the small safe drag frame, anchored to the native brand area.
func windowDragFrames(
  in bounds: NSRect,
  layout: WindowDragLayout = WindowDragLayout(),
) -> [NSRect] {
  let leading = max(0, layout.leadingInset)
  let availableWidth = max(0, bounds.width - leading)
  let width = min(max(0, layout.maximumWidth), availableWidth)
  guard width > 0, bounds.height > 0 else { return [] }
  return [NSRect(
    x: bounds.minX + min(leading, bounds.width),
    y: bounds.minY,
    width: width,
    height: bounds.height,
  )]
}

/// Return the non-draggable titlebar regions. These regions return `nil` from
/// `hitTest`, allowing the underlying WebKit toolbar to receive mouse events.
func windowDragExclusionFrames(
  in bounds: NSRect,
  layout: WindowDragLayout = WindowDragLayout(),
) -> [NSRect] {
  guard let drag = windowDragFrames(in: bounds, layout: layout).first else {
    return bounds.width > 0 && bounds.height > 0 ? [bounds] : []
  }
  var frames: [NSRect] = []
  if drag.minX > bounds.minX {
    frames.append(NSRect(x: bounds.minX, y: bounds.minY, width: drag.minX - bounds.minX, height: bounds.height))
  }
  if drag.maxX < bounds.maxX {
    frames.append(NSRect(x: drag.maxX, y: bounds.minY, width: bounds.maxX - drag.maxX, height: bounds.height))
  }
  return frames
}

@MainActor
final class WindowDragRegionView: NSView {
  var dragLayout = WindowDragLayout()

  override var mouseDownCanMoveWindow: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let local = convert(point, from: nil)
    return windowDragFrames(in: bounds, layout: dragLayout).contains { $0.contains(local) } ? self : nil
  }

  override func mouseDown(with event: NSEvent) {
    guard let window else { return }
    if event.clickCount == 2 {
      window.zoom(nil)
    } else {
      window.performDrag(with: event)
    }
  }
}

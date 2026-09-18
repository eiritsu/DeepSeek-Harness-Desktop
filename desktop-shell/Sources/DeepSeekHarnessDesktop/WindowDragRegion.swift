import AppKit

let windowDragRegionAutoresizingMask: NSView.AutoresizingMask = [.width, .height]

/// Geometry: the leading exclusion (session toolbar / subagent / create-mode / background-task area).
struct WindowDragLayout {
  var leadingExclusionWidth: CGFloat = 500
  var trailingExclusionWidth: CGFloat = 140
}

/// Return the draggable frames given a titlebar bounds and layout insets.
/// The result is every frame NOT covered by a leading or trailing exclusion
/// rect; `WindowDragRegionView.hitTest` returns `nil` inside exclusions so
/// the underlying WKWebView stays clickable there.
func windowDragFrames(
  in bounds: NSRect,
  layout: WindowDragLayout = WindowDragLayout(),
) -> [NSRect] {
  let leading = min(layout.leadingExclusionWidth, bounds.width)
  let trailing = min(layout.trailingExclusionWidth, max(0, bounds.width - leading))
  let gapStart = bounds.minX + leading
  let gapEnd = bounds.maxX - trailing
  guard gapEnd > gapStart else { return [] }
  return [NSRect(x: gapStart, y: bounds.minY, width: gapEnd - gapStart, height: bounds.height)]
}

/// Return the exclusion frames so tests can assert non-overlap with draggable frames.
func windowDragExclusionFrames(
  in bounds: NSRect,
  layout: WindowDragLayout = WindowDragLayout(),
) -> [NSRect] {
  let leading = min(layout.leadingExclusionWidth, bounds.width)
  let trailing = min(layout.trailingExclusionWidth, max(0, bounds.width - leading))
  var frames: [NSRect] = []
  if leading > 0 {
    frames.append(NSRect(x: bounds.minX, y: bounds.minY, width: leading, height: bounds.height))
  }
  let trailingStart = bounds.maxX - trailing
  if trailing > 0 && trailingStart > bounds.minX + leading {
    frames.append(NSRect(x: trailingStart, y: bounds.minY, width: trailing, height: bounds.height))
  }
  return frames
}

@MainActor
final class WindowDragRegionView: NSView {
  var dragLayout = WindowDragLayout()

  override var mouseDownCanMoveWindow: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let local = convert(point, from: nil)
    let exclusionFrames = windowDragExclusionFrames(in: bounds, layout: dragLayout)
    for exclusion in exclusionFrames {
      if exclusion.contains(local) { return nil }
    }
    return super.hitTest(point)
  }

  override func mouseDown(with event: NSEvent) {
    window?.performDrag(with: event)
  }
}

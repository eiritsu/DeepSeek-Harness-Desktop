import Foundation

enum DesktopError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case let .message(message): message
    }
  }
}

final class LogStore: @unchecked Sendable {
  static let shared = LogStore()

  private let lock = NSLock()
  let fileURL: URL

  private init() {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("DeepSeek Harness Desktop", isDirectory: true)
      .appendingPathComponent("logs", isDirectory: true)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    fileURL = root.appendingPathComponent("desktop.log")
  }

  func append(_ message: String) {
    lock.lock()
    defer { lock.unlock() }
    let timestamp = ISO8601DateFormatter().string(from: Date())
    let data = Data("[\(timestamp)] \(message)\n".utf8)
    if !FileManager.default.fileExists(atPath: fileURL.path) {
      FileManager.default.createFile(atPath: fileURL.path, contents: data)
      return
    }
    guard let handle = try? FileHandle(forWritingTo: fileURL) else { return }
    defer { try? handle.close() }
    do {
      try handle.seekToEnd()
      try handle.write(contentsOf: data)
    } catch {}
  }
}

struct Toolchain: Sendable {
  let node: URL
  let npx: URL

  static func locate() throws -> Toolchain {
    let environment = ProcessInfo.processInfo.environment
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let pathDirectories = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
    let candidates = [
      "\(home)/.local/bin",
      "\(home)/.hermes/node/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
    ] + pathDirectories

    func executable(named name: String) -> URL? {
      for directory in candidates {
        let candidate = URL(fileURLWithPath: directory, isDirectory: true).appendingPathComponent(name)
        if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate }
      }
      return nil
    }

    guard let node = executable(named: "node"), let npx = executable(named: "npx") else {
      throw DesktopError.message("找不到 Node.js / npx。请安装 Node.js 22.19 或 24 以上版本。")
    }
    return Toolchain(node: node, npx: npx)
  }

  func environment(overrides: [String: String] = [:], prepending paths: [String] = []) -> [String: String] {
    var result = ProcessInfo.processInfo.environment
    let directories = paths + [node.deletingLastPathComponent().path, npx.deletingLastPathComponent().path]
    result["PATH"] = (directories + [(result["PATH"] ?? "")]).joined(separator: ":")
    for (key, value) in overrides { result[key] = value }
    return result
  }
}

struct CommandResult: Sendable {
  let status: Int32
  let output: String
}

final class LockedBox<Value>: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Value

  init(_ value: Value) { self.value = value }

  func get() -> Value {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  func set(_ value: Value) {
    lock.lock()
    self.value = value
    lock.unlock()
  }

  func update(_ body: (inout Value) -> Void) {
    lock.lock()
    defer { lock.unlock() }
    body(&value)
  }
}

enum CommandRunner {
  static func run(
    executable: URL,
    arguments: [String],
    directory: URL? = nil,
    environment: [String: String]? = nil,
    progress: (@Sendable (String) -> Void)? = nil
  ) throws -> CommandResult {
    let process = Process()
    let output = Pipe()
    process.executableURL = executable
    process.arguments = arguments
    process.currentDirectoryURL = directory
    process.environment = environment
    process.standardOutput = output
    process.standardError = output
    try process.run()

    var collected = Data()
    while true {
      let chunk = output.fileHandleForReading.availableData
      if chunk.isEmpty { break }
      collected.append(chunk)
      if let line = String(data: chunk, encoding: .utf8) {
        LogStore.shared.append(line.trimmingCharacters(in: .newlines))
        progress?(line)
      }
    }
    process.waitUntilExit()
    return CommandResult(status: process.terminationStatus, output: String(decoding: collected, as: UTF8.self))
  }
}

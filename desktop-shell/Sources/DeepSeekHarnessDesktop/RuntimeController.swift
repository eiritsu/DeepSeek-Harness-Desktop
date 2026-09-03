import Darwin
import Foundation

struct RuntimeStartupFailure: LocalizedError, Sendable {
  let status: Int32
  let stderr: String

  var errorDescription: String? {
    "Harness 在就绪前退出（状态码 \(status)）。详情见桌面日志。"
  }

  var failingPluginPackage: String? {
    let specifier = Self.firstCapture(
      pattern: #"loader entry [^\s]+ \((@?[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)\)"#,
      in: stderr
    ) ?? Self.firstCapture(
      pattern: #"profile bundle [\"'](@?[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)[\"']"#,
      in: stderr
    ) ?? Self.firstCapture(
      pattern: #"node_modules/((?:@[^/\s]+/)?[^/\s]+)"#,
      in: stderr
    )
    guard let specifier else { return nil }
    let segments = specifier.split(separator: "/")
    if specifier.hasPrefix("@"), segments.count >= 2 {
      return "\(segments[0])/\(segments[1])"
    }
    return segments.first.map(String.init)
  }

  private static func firstCapture(pattern: String, in value: String) -> String? {
    guard let expression = try? NSRegularExpression(pattern: pattern),
          let match = expression.firstMatch(
            in: value,
            range: NSRange(value.startIndex..., in: value)
          ),
          let range = Range(match.range(at: 1), in: value)
    else { return nil }
    return String(value[range])
  }
}

final class StartupState: @unchecked Sendable {
  private let lock = NSLock()
  private let ready = DispatchSemaphore(value: 0)
  private let progress: @Sendable (String) -> Void
  private let log: @Sendable (String) -> Void
  private var readyURL: URL?
  private var startupError: Error?
  private var stdoutBuffer = ""
  private var stderrBuffer = ""
  private var signalled = false

  init(
    progress: @escaping @Sendable (String) -> Void,
    log: @escaping @Sendable (String) -> Void = { LogStore.shared.append($0) }
  ) {
    self.progress = progress
    self.log = log
  }

  func consume(_ data: Data, isError: Bool) {
    guard !data.isEmpty else { return }
    let text = String(decoding: data, as: UTF8.self)
    log("runtime\(isError ? " stderr" : ""): \(text.trimmingCharacters(in: .newlines))")
    lock.lock()
    if isError {
      stderrBuffer.append(text)
      if stderrBuffer.utf8.count > 128 * 1024 {
        stderrBuffer = String(stderrBuffer.suffix(128 * 1024))
      }
    } else {
      stdoutBuffer.append(text)
      if readyURL == nil,
         let range = stdoutBuffer.range(
           of: #"dsh web: (http://127\.0\.0\.1:\d+[^\s]*)"#,
           options: .regularExpression
         )
      {
        let line = String(stdoutBuffer[range])
        readyURL = URL(string: String(line.dropFirst("dsh web: ".count)))
      }
    }
    let found = readyURL != nil
    let shouldReportProgress = !isError && !found && !signalled
    lock.unlock()
    if shouldReportProgress { progress(text) }
    if found { signalOnce() }
  }

  func terminated(status: Int32) {
    lock.lock()
    if readyURL == nil {
      startupError = RuntimeStartupFailure(status: status, stderr: stderrBuffer)
    }
    lock.unlock()
    signalOnce()
  }

  func wait(timeout: DispatchTime) -> DispatchTimeoutResult { ready.wait(timeout: timeout) }

  func outcome() -> (URL?, Error?) {
    lock.lock()
    defer { lock.unlock() }
    return (readyURL, startupError)
  }

  private func signalOnce() {
    lock.lock()
    if signalled {
      lock.unlock()
      return
    }
    signalled = true
    lock.unlock()
    ready.signal()
  }
}

final class RuntimeController: @unchecked Sendable {
  private static let readinessSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    return URLSession(configuration: configuration)
  }()

  private let queue = DispatchQueue(label: "ai.deepseek.harness.desktop.runtime", qos: .userInitiated)
  private let lock = NSLock()
  private let supportRoot: URL
  private let runtimePIDURL: URL
  private var process: Process?
  private var stopping = false

  init(supportRoot: URL? = nil) {
    self.supportRoot = supportRoot ?? FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    )[0].appendingPathComponent("DeepSeek Harness Desktop", isDirectory: true)
    self.runtimePIDURL = self.supportRoot.appendingPathComponent("runtime.pid")
  }

  func start(
    sourceRoot: URL,
    dshHome: URL,
    profile: String = "web",
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<URL, Error>) -> Void
  ) {
    queue.async {
      do {
        try self.reapOrphanedRuntime()
        let toolchain = try Toolchain.resolve(supportRoot: self.supportRoot, progress: progress)
        try FileManager.default.createDirectory(at: dshHome, withIntermediateDirectories: true)
        let executable = sourceRoot.appendingPathComponent("apps/cli/lib/bin.js")
        guard FileManager.default.fileExists(atPath: executable.path) else {
          throw DesktopError.message("缺少构建产物 apps/cli/lib/bin.js。请先构建源码，或使用 App 菜单中的“检查并更新源码”。")
        }
        let url = try self.launch(
          toolchain: toolchain,
          executable: executable,
          sourceRoot: sourceRoot,
          dshHome: dshHome,
          profile: profile,
          progress: progress
        )
        completion(.success(url))
      } catch {
        completion(.failure(error))
      }
    }
  }

  private func launch(
    toolchain: Toolchain,
    executable: URL,
    sourceRoot: URL,
    dshHome: URL,
    profile: String,
    progress: @escaping @Sendable (String) -> Void
  ) throws -> URL {
    let child = Process()
    let stdout = Pipe()
    let stderr = Pipe()
    child.executableURL = toolchain.node
    child.arguments = [
      executable.path,
      "--profile", profile,
      "--no-open", "--port", "0",
    ]
    child.currentDirectoryURL = sourceRoot
    child.environment = toolchain.environment(overrides: [
      "DSH_HOME": dshHome.path,
      "DSH_DESKTOP_SHELL": "1",
    ])
    child.standardInput = FileHandle.nullDevice
    child.standardOutput = stdout
    child.standardError = stderr

    let state = StartupState(progress: progress)
    // Keep draining both pipes independently. A readability handler relies on
    // Foundation's run-loop delivery and can leave a child blocked when early
    // startup diagnostics exceed the pipe buffer.
    readOutput(stdout, state: state, isError: false)
    readOutput(stderr, state: state, isError: true)
    child.terminationHandler = { process in
      state.terminated(status: process.terminationStatus)
      self.clearRuntimePID(process.processIdentifier)
    }

    lock.lock()
    process = child
    stopping = false
    lock.unlock()
    try child.run()
    try writeRuntimePID(child.processIdentifier)

    if state.wait(timeout: .now() + 120) == .timedOut {
      stopSynchronously()
      throw DesktopError.message("Harness 启动超过 120 秒。详情见桌面日志。")
    }

    let (resolvedURL, resolvedError) = state.outcome()
    if let resolvedError { throw resolvedError }
    guard let resolvedURL else { throw DesktopError.message("Harness 未返回有效的本地地址。") }
    try waitForWebReady(resolvedURL, progress: progress)
    return resolvedURL
  }

  /// Wait until the Web profile has registered its client-bundle route.
  ///
  /// The CLI announces its listening URL before the WebView should navigate. The
  /// readiness route is unauthenticated and therefore does not consume the
  /// one-time process token reserved for the WebView's first request.
  private func waitForWebReady(
    _ authenticatedURL: URL,
    progress: @escaping @Sendable (String) -> Void
  ) throws {
    guard let readinessURL = Self.readinessURL(for: authenticatedURL) else {
      throw DesktopError.message("Harness 返回的本地地址无效。")
    }
    let deadline = Date().addingTimeInterval(120)
    var announced = false
    while Date() < deadline {
      if Self.fetchStatus(readinessURL) == 204 {
        return
      }
      if !announced {
        progress("正在等待插件模块就绪…\n")
        announced = true
      }
      usleep(200_000)
    }
    throw DesktopError.message("本地 Web 服务已启动，但插件模块未及时就绪。请查看桌面日志后重试。")
  }

  static func readinessURL(for authenticatedURL: URL) -> URL? {
    guard var components = URLComponents(url: authenticatedURL, resolvingAgainstBaseURL: false) else {
      return nil
    }
    components.path = "/plugins/__dsh_ready"
    components.query = nil
    components.fragment = nil
    return components.url
  }

  private static func fetchStatus(_ url: URL) -> Int? {
    fetch(url)?.status
  }

  private static func fetch(_ url: URL) -> (data: Data, status: Int)? {
    let semaphore = DispatchSemaphore(value: 0)
    let result = LockedBox<(data: Data, status: Int)?>(nil)
    var request = URLRequest(url: url)
    request.timeoutInterval = 2
    readinessSession.dataTask(with: request) { data, response, _ in
      if let status = (response as? HTTPURLResponse)?.statusCode {
        result.set((data ?? Data(), status))
      }
      semaphore.signal()
    }.resume()
    guard semaphore.wait(timeout: .now() + 2) == .success else { return nil }
    return result.get()
  }

  private func readOutput(_ pipe: Pipe, state: StartupState, isError: Bool) {
    DispatchQueue.global(qos: .utility).async {
      while true {
        // POSIX read returns after any bytes are available; Foundation's
        // length-based reads can wait for a full buffer while the runtime
        // keeps stdout open after announcing readiness.
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        let count = buffer.withUnsafeMutableBytes { bytes in
          Darwin.read(pipe.fileHandleForReading.fileDescriptor, bytes.baseAddress, bytes.count)
        }
        guard count > 0 else { break }
        state.consume(Data(buffer[..<count]), isError: isError)
      }
    }
  }

  static func reloadURL(for authenticatedURL: URL) -> URL {
    guard var components = URLComponents(url: authenticatedURL, resolvingAgainstBaseURL: false) else {
      return authenticatedURL
    }
    components.query = nil
    components.fragment = nil
    return components.url ?? authenticatedURL
  }

  func stop(completion: @escaping @Sendable () -> Void = {}) {
    queue.async {
      self.stopSynchronously()
      completion()
    }
  }

  private func stopSynchronously() {
    lock.lock()
    guard let child = process, child.isRunning, !stopping else {
      process = nil
      lock.unlock()
      return
    }
    stopping = true
    lock.unlock()

    kill(child.processIdentifier, SIGTERM)
    let deadline = Date().addingTimeInterval(7)
    while child.isRunning && Date() < deadline { usleep(100_000) }
    if child.isRunning { kill(child.processIdentifier, SIGKILL) }
    child.waitUntilExit()
    child.standardOutput.flatMap { $0 as? Pipe }?.fileHandleForReading.readabilityHandler = nil
    child.standardError.flatMap { $0 as? Pipe }?.fileHandleForReading.readabilityHandler = nil

    lock.lock()
    process = nil
    stopping = false
    lock.unlock()
    clearRuntimePID(child.processIdentifier)
  }

  /// Remove a runtime left behind when the desktop process was force-killed.
  /// The PID file is validated against the exact Harness CLI command before a
  /// signal is sent, so PID reuse cannot terminate an unrelated process.
  private func reapOrphanedRuntime() throws {
    guard let value = try? String(contentsOf: runtimePIDURL, encoding: .utf8),
          let pid = pid_t(value.trimmingCharacters(in: .whitespacesAndNewlines)),
          pid > 0,
          pid != getpid()
    else {
      clearRuntimePID(nil)
      return
    }
    guard let command = processCommand(pid: pid),
          command.contains("/apps/cli/lib/bin.js") else {
      clearRuntimePID(pid)
      return
    }
    LogStore.shared.append("runtime: terminating orphaned Harness process \(pid)")
    guard kill(pid, SIGTERM) == 0 || errno == ESRCH else {
      throw DesktopError.message("无法结束上一次遗留的 Harness 运行时（PID \(pid)）。")
    }
    let deadline = Date().addingTimeInterval(5)
    while processExists(pid), Date() < deadline { usleep(100_000) }
    if processExists(pid) { kill(pid, SIGKILL) }
    clearRuntimePID(pid)
  }

  private func processCommand(pid: pid_t) -> String? {
    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-p", String(pid), "-o", "command="]
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return nil }
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { return nil }
    return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
  }

  private func processExists(_ pid: pid_t) -> Bool {
    kill(pid, 0) == 0 || errno == EPERM
  }

  private func writeRuntimePID(_ pid: pid_t) throws {
    try FileManager.default.createDirectory(at: supportRoot, withIntermediateDirectories: true)
    try "\(pid)\n".write(to: runtimePIDURL, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: runtimePIDURL.path)
  }

  private func clearRuntimePID(_ pid: pid_t?) {
    guard let value = try? String(contentsOf: runtimePIDURL, encoding: .utf8),
          let recorded = pid_t(value.trimmingCharacters(in: .whitespacesAndNewlines))
    else {
      try? FileManager.default.removeItem(at: runtimePIDURL)
      return
    }
    if pid == nil || pid == recorded { try? FileManager.default.removeItem(at: runtimePIDURL) }
  }

  static func healthCheck(
    sourceRoot: URL,
    dshHome: URL,
    supportRoot: URL,
    progress: @escaping @Sendable (String) -> Void
  ) throws {
    let runtime = RuntimeController(supportRoot: supportRoot)
    let ready = DispatchSemaphore(value: 0)
    let result = LockedBox<Result<URL, Error>?>(nil)
    runtime.start(sourceRoot: sourceRoot, dshHome: dshHome, progress: progress) {
      result.set($0)
      ready.signal()
    }
    guard ready.wait(timeout: .now() + 130) == .success, let result = result.get() else {
      throw DesktopError.message("更新版本健康检查超时。")
    }
    let url = try result.get()
    let response = DispatchSemaphore(value: 0)
    let healthError = LockedBox<Error?>(nil)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    let session = URLSession(configuration: configuration)
    session.dataTask(with: url) { _, reply, error in
      if let error { healthError.set(error) }
      else if (reply as? HTTPURLResponse)?.statusCode != 200 {
        healthError.set(DesktopError.message("更新版本健康检查未返回 HTTP 200。"))
      }
      response.signal()
    }.resume()
    if response.wait(timeout: .now() + 15) == .timedOut {
      healthError.set(DesktopError.message("更新版本 HTTP 健康检查超时。"))
    }
    session.finishTasksAndInvalidate()
    let stopped = DispatchSemaphore(value: 0)
    runtime.stop { stopped.signal() }
    _ = stopped.wait(timeout: .now() + 10)
    if let healthError = healthError.get() { throw healthError }
  }
}

import Darwin
import Foundation

enum RuntimeInstanceLockError: LocalizedError, Equatable {
  case alreadyRunning(processIdentifier: pid_t?)
  case system(operation: String, code: Int32)

  var errorDescription: String? {
    switch self {
    case .alreadyRunning:
      return "另一个 DeepSeek Harness 实例正在使用当前数据目录。请先切换到或退出已有实例。"
    case let .system(operation, code):
      return "无法保护 DeepSeek Harness 数据目录（\(operation)，错误码 \(code)）。"
    }
  }
}

final class RuntimeInstanceLock {
  private var descriptor: Int32?
  private let path: String

  init(supportRoot: URL) throws {
    try FileManager.default.createDirectory(at: supportRoot, withIntermediateDirectories: true)
    let path = supportRoot.appendingPathComponent("runtime.lock").path
    self.path = path
    var descriptor = Darwin.open(path, O_CREAT | O_EXCL | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    if descriptor < 0, errno == EEXIST, Self.removeStaleOwner(path) {
      descriptor = Darwin.open(path, O_CREAT | O_EXCL | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    }
    guard descriptor >= 0 else {
      if errno == EEXIST {
        throw RuntimeInstanceLockError.alreadyRunning(processIdentifier: Self.readOwner(path))
      }
      throw RuntimeInstanceLockError.system(operation: "open", code: errno)
    }
    self.descriptor = descriptor
    do {
      try Self.writeOwner(descriptor)
    } catch {
      Darwin.close(descriptor)
      _ = Darwin.unlink(path)
      throw error
    }
  }

  deinit {
    release()
  }

  func release() {
    guard let descriptor else { return }
    self.descriptor = nil
    Darwin.close(descriptor)
    _ = Darwin.unlink(path)
  }

  private static func writeOwner(_ descriptor: Int32) throws {
    guard Darwin.ftruncate(descriptor, 0) == 0, Darwin.lseek(descriptor, 0, SEEK_SET) >= 0 else {
      throw RuntimeInstanceLockError.system(operation: "truncate", code: errno)
    }
    let owner = Data("\(getpid())\n".utf8)
    let result = owner.withUnsafeBytes { bytes in
      Darwin.write(descriptor, bytes.baseAddress, bytes.count)
    }
    guard result == owner.count else {
      throw RuntimeInstanceLockError.system(operation: "write", code: errno)
    }
  }

  private static func readOwner(_ path: String) -> pid_t? {
    guard
      let contents = try? String(contentsOfFile: path, encoding: .utf8),
      let processIdentifier = Int32(contents.trimmingCharacters(in: .whitespacesAndNewlines)),
      processIdentifier > 0
    else {
      return nil
    }
    return processIdentifier
  }

  private static func removeStaleOwner(_ path: String) -> Bool {
    var metadata = stat()
    guard Darwin.lstat(path, &metadata) == 0, (metadata.st_mode & S_IFMT) == S_IFREG,
          let owner = readOwner(path)
    else { return false }
    if Darwin.kill(owner, 0) == 0 || errno == EPERM { return false }
    guard errno == ESRCH else { return false }
    return Darwin.unlink(path) == 0
  }
}

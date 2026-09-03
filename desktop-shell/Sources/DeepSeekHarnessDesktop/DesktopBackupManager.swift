import Foundation

/// Creates and restores a versioned, desensitized desktop configuration archive.
final class DesktopBackupManager: @unchecked Sendable {
  private static let archiveVersion = 1
  private let supportRoot: URL
  private let dataRoot: URL

  init(supportRoot: URL) {
    self.supportRoot = supportRoot
    dataRoot = supportRoot.appendingPathComponent("data", isDirectory: true)
  }

  /// Export settings metadata and executable plugin/Skill/Profile artifacts.
  /// Secrets, transcripts, attachments, logs, and machine identity are removed.
  func export(to destination: URL) throws {
    let fileManager = FileManager.default
    let stage = supportRoot.appendingPathComponent(".backup-export-\(UUID().uuidString)", isDirectory: true)
    try fileManager.createDirectory(at: stage, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: stage) }

    let manifest: [String: Any] = [
      "format": "dsh-desktop-configuration",
      "version": Self.archiveVersion,
      "createdAt": ISO8601DateFormatter().string(from: Date()),
      "contents": ["sqlite", "plugins", "skills", "profiles"],
      "redactions": ["credentials", "sessions", "attachments", "logs", "machineIdentity"],
    ]
    let manifestData = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
    try (manifestData + Data("\n".utf8)).write(to: stage.appendingPathComponent("manifest.json"), options: .atomic)

    let database = dataRoot.appendingPathComponent("dsh-desktop.sqlite")
    if fileManager.fileExists(atPath: database.path) {
      let copy = stage.appendingPathComponent("dsh-desktop.sqlite")
      try fileManager.copyItem(at: database, to: copy)
      try scrubDatabase(at: copy)
    }

    for name in ["profiles", "skills"] {
      let source = dataRoot.appendingPathComponent(name, isDirectory: true)
      let target = stage.appendingPathComponent(name, isDirectory: true)
      guard fileManager.fileExists(atPath: source.path) else { continue }
      try copyArtifacts(from: source, to: target)
    }

    let parent = destination.deletingLastPathComponent()
    try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
    if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
    let result = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/ditto"),
      arguments: ["-c", "-k", "--sequesterRsrc", stage.path, destination.path],
    )
    guard result.status == 0 else { throw DesktopError.message("配置备份压缩失败：\(result.output)") }
  }

  /// Import a previously exported archive into the desktop data root.
  func `import`(from archive: URL) throws {
    let fileManager = FileManager.default
    let stage = supportRoot.appendingPathComponent(".backup-import-\(UUID().uuidString)", isDirectory: true)
    try fileManager.createDirectory(at: stage, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: stage) }
    let extraction = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/ditto"),
      arguments: ["-x", "-k", archive.path, stage.path],
    )
    guard extraction.status == 0 else { throw DesktopError.message("配置备份解压失败：\(extraction.output)") }
    let root = try archiveRoot(in: stage)
    let manifestURL = root.appendingPathComponent("manifest.json")
    guard let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any],
          manifest["format"] as? String == "dsh-desktop-configuration",
          manifest["version"] as? Int == Self.archiveVersion
    else { throw DesktopError.message("配置备份版本不受支持或清单无效。") }

    let rollbackRoot = supportRoot.appendingPathComponent(".backup-rollback-\(UUID().uuidString)", isDirectory: true)
    try fileManager.createDirectory(at: rollbackRoot, withIntermediateDirectories: true)
    var moved: [(backup: URL, target: URL)] = []
    defer { try? fileManager.removeItem(at: rollbackRoot) }

    let importedDB = root.appendingPathComponent("dsh-desktop.sqlite")
    do {
      if fileManager.fileExists(atPath: importedDB.path) {
        let target = dataRoot.appendingPathComponent("dsh-desktop.sqlite")
        try stageExisting(target, in: rollbackRoot, moved: &moved)
        try replace(importedDB, at: target)
      }
      for name in ["profiles", "skills"] {
        let imported = root.appendingPathComponent(name, isDirectory: true)
        guard fileManager.fileExists(atPath: imported.path) else { continue }
        let target = dataRoot.appendingPathComponent(name, isDirectory: true)
        try stageExisting(target, in: rollbackRoot, moved: &moved)
        try copyArtifacts(from: imported, to: target)
      }
    } catch {
      for name in ["dsh-desktop.sqlite", "profiles", "skills"] {
        let target = dataRoot.appendingPathComponent(name)
        if fileManager.fileExists(atPath: target.path) { try? fileManager.removeItem(at: target) }
      }
      for entry in moved.reversed() {
        if fileManager.fileExists(atPath: entry.backup.path) {
          try? fileManager.moveItem(at: entry.backup, to: entry.target)
        }
      }
      throw error
    }
  }

  /// Remove all user data while leaving managed source and toolchain artifacts intact.
  func resetData() throws {
    let fileManager = FileManager.default
    try fileManager.createDirectory(at: dataRoot, withIntermediateDirectories: true)
    for item in try fileManager.contentsOfDirectory(at: dataRoot, includingPropertiesForKeys: nil) {
      try fileManager.removeItem(at: item)
    }
    // Keep the legacy migration gate so a reset cannot silently re-import ~/.dsh.
    try Data("reset by desktop configuration action\n".utf8)
      .write(to: dataRoot.appendingPathComponent(".dsh-home-migration-v2"), options: .atomic)
  }

  private func archiveRoot(in stage: URL) throws -> URL {
    let direct = stage.appendingPathComponent("manifest.json")
    if FileManager.default.fileExists(atPath: direct.path) { return stage }
    let entries = try FileManager.default.contentsOfDirectory(at: stage, includingPropertiesForKeys: [.isDirectoryKey])
    guard entries.count == 1, (try entries[0].resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
      throw DesktopError.message("配置备份目录结构无效。")
    }
    return try archiveRoot(in: entries[0])
  }

  private func replace(_ source: URL, at destination: URL) throws {
    let fileManager = FileManager.default
    try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    let temporary = destination.deletingLastPathComponent().appendingPathComponent(".import-\(UUID().uuidString).sqlite")
    try fileManager.copyItem(at: source, to: temporary)
    if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
    try fileManager.moveItem(at: temporary, to: destination)
  }

  private func scrubDatabase(at database: URL) throws {
    let tables = [
      "credentials",
      "sessions",
      "session_events",
      "dsh_session_events",
      "dsh_session_metadata",
      "dsh_session_store_metadata",
      "u_message_feedback_sessions",
      "u_session_projcache_sessions",
      "u_workspace_workspaces",
      "audit_log",
      "data_inventory",
    ]
    let quoted = tables.map { "'\($0)'" }.joined(separator: ",")
    let present = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
      arguments: [database.path, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (\(quoted));"],
    )
    guard present.status == 0 else { throw DesktopError.message("配置备份读取 SQLite 表失败：\(present.output)") }
    let statements = present.output
      .split(whereSeparator: \.isNewline)
      .map { "DELETE FROM \"\($0)\";" }
      + ["DELETE FROM metadata WHERE key IN ('anonymous-user-id', 'payload-import-v1');", "VACUUM;"]
    let scrub = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
      arguments: [database.path, statements.joined(separator: " ")],
    )
    guard scrub.status == 0 else { throw DesktopError.message("配置备份脱敏失败：\(scrub.output)") }
  }

  private func stageExisting(
    _ target: URL,
    in rollbackRoot: URL,
    moved: inout [(backup: URL, target: URL)]
  ) throws {
    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: target.path) else { return }
    let backup = rollbackRoot.appendingPathComponent(target.lastPathComponent)
    try fileManager.moveItem(at: target, to: backup)
    moved.append((backup, target))
  }

  private func copyArtifacts(from source: URL, to destination: URL) throws {
    let fileManager = FileManager.default
    try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
    for item in try fileManager.contentsOfDirectory(at: source, includingPropertiesForKeys: [.isDirectoryKey]) {
      let name = item.lastPathComponent
      if name == "node_modules" || name == ".git" || name.hasPrefix(".") { continue }
      let target = destination.appendingPathComponent(name)
      let isDirectory = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
      if isDirectory { try copyArtifacts(from: item, to: target) }
      else { try fileManager.copyItem(at: item, to: target) }
    }
  }
}

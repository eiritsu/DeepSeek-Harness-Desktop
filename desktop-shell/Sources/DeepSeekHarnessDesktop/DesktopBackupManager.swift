import Foundation

/// Creates and restores a versioned, desensitized desktop configuration archive.
final class DesktopBackupManager: @unchecked Sendable {
  private static let archiveVersion = 1
  private static let maximumSessionSchemaVersion = 2
  private let supportRoot: URL
  private let dataRoot: URL

  init(supportRoot: URL, dataRoot: URL? = nil) {
    self.supportRoot = supportRoot
    self.dataRoot = dataRoot ?? supportRoot.appendingPathComponent("data", isDirectory: true)
  }

  /// Export the closed authoritative Session database without redaction.
  func exportSessions(to destination: URL) throws {
    let source = sessionDatabase
    try validateSessionDatabase(at: source)
    let fileManager = FileManager.default
    try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    let staged = destination.deletingLastPathComponent()
      .appendingPathComponent(".session-export-\(UUID().uuidString).sqlite")
    defer { try? fileManager.removeItem(at: staged) }
    let snapshot = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
      arguments: [source.path, ".backup '\(staged.path.replacingOccurrences(of: "'", with: "''"))'"]
    )
    guard snapshot.status == 0 else {
      throw DesktopError.message("会话备份读取 SQLite 快照失败：\(snapshot.output)")
    }
    try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: staged.path)
    try validateSessionDatabase(at: staged)
    if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
    try fileManager.moveItem(at: staged, to: destination)
    try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
  }

  /// Import a validated Session database while retaining the previous file for rollback.
  func importSessions(from source: URL) throws {
    try validateSessionDatabase(at: source)
    let fileManager = FileManager.default
    let target = sessionDatabase
    let rollback = supportRoot.appendingPathComponent(".session-rollback-\(UUID().uuidString).sqlite")
    let staged = target.deletingLastPathComponent()
      .appendingPathComponent(".session-import-\(UUID().uuidString).sqlite")
    try fileManager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
    defer {
      try? fileManager.removeItem(at: staged)
      try? fileManager.removeItem(at: rollback)
    }
    try fileManager.copyItem(at: source, to: staged)
    try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: staged.path)
    try validateSessionDatabase(at: staged)
    let retained = fileManager.fileExists(atPath: target.path)
    if retained { try fileManager.moveItem(at: target, to: rollback) }
    do {
      try fileManager.moveItem(at: staged, to: target)
      try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
      for suffix in ["-wal", "-shm"] {
        let sidecar = URL(fileURLWithPath: target.path + suffix)
        if fileManager.fileExists(atPath: sidecar.path) { try fileManager.removeItem(at: sidecar) }
      }
    } catch {
      if retained, fileManager.fileExists(atPath: rollback.path) {
        try? fileManager.moveItem(at: rollback, to: target)
      }
      throw error
    }
  }

  /// Delete only the authoritative Session database and its SQLite sidecars.
  func resetSessions() throws {
    let fileManager = FileManager.default
    for suffix in ["", "-wal", "-shm"] {
      let item = URL(fileURLWithPath: sessionDatabase.path + suffix)
      if fileManager.fileExists(atPath: item.path) { try fileManager.removeItem(at: item) }
    }
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

    let settings = dataRoot.appendingPathComponent("settings.yaml")
    if fileManager.fileExists(atPath: settings.path) {
      try fileManager.copyItem(at: settings, to: stage.appendingPathComponent("settings.yaml"))
    }

    let database = dataRoot.appendingPathComponent("desktop/dsh-desktop.sqlite")
    if fileManager.fileExists(atPath: database.path) {
      let copy = stage.appendingPathComponent("dsh-desktop.sqlite")
      let snapshot = try CommandRunner.run(
        executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
        arguments: [database.path, ".backup '\(copy.path.replacingOccurrences(of: "'", with: "''"))'"],
      )
      guard snapshot.status == 0 else { throw DesktopError.message("配置备份读取 SQLite 快照失败：\(snapshot.output)") }
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
    try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
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
      let importedSettings = root.appendingPathComponent("settings.yaml")
      let restoredSettings: Data?
      if fileManager.fileExists(atPath: importedSettings.path) {
        restoredSettings = try Data(contentsOf: importedSettings)
      } else if fileManager.fileExists(atPath: importedDB.path) {
        restoredSettings = try legacySettings(from: importedDB)
      } else {
        restoredSettings = nil
      }
      if let restoredSettings {
        let target = dataRoot.appendingPathComponent("settings.yaml")
        try stageExisting(target, in: rollbackRoot, moved: &moved)
        try fileManager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try restoredSettings.write(to: target, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
      }
      for name in ["profiles", "skills"] {
        let imported = root.appendingPathComponent(name, isDirectory: true)
        guard fileManager.fileExists(atPath: imported.path) else { continue }
        let target = dataRoot.appendingPathComponent(name, isDirectory: true)
        try stageExisting(target, in: rollbackRoot, moved: &moved)
        if let retained = moved.last, retained.target == target {
          try copyArtifacts(from: retained.backup, to: target)
        }
        try copyArtifacts(from: imported, to: target)
      }
      try migrateLegacyWebPlugins(from: root)
    } catch {
      for name in ["settings.yaml", "profiles", "skills"] {
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
    for relative in [
      "desktop/dsh-desktop.sqlite",
      "desktop/dsh-desktop.sqlite-wal",
      "desktop/dsh-desktop.sqlite-shm",
      "sessions",
      "attachments",
      "storages",
      "settings.yaml",
      ".credentials.yaml",
      ".anonymous-user-id",
    ] {
      let item = dataRoot.appendingPathComponent(relative)
      if fileManager.fileExists(atPath: item.path) { try fileManager.removeItem(at: item) }
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

  private var sessionDatabase: URL {
    dataRoot.appendingPathComponent("desktop/dsh-desktop.sqlite")
  }

  private func validateSessionDatabase(at database: URL) throws {
    let query = "PRAGMA user_version; SELECT name FROM sqlite_master WHERE type='table' AND name IN ('dsh_session_metadata','dsh_session_events') ORDER BY name;"
    let immutable = database.absoluteString + "?immutable=1"
    let result = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
      arguments: ["-readonly", immutable, query]
    )
    guard result.status == 0 else {
      throw DesktopError.message("会话备份不是可读取的 SQLite 数据库：\(result.output)")
    }
    let lines = result.output.split(whereSeparator: \.isNewline).map(String.init)
    guard let version = lines.first.flatMap(Int.init), version >= 1,
          version <= Self.maximumSessionSchemaVersion else {
      throw DesktopError.message("会话备份的 SQLite schema 版本不受支持。")
    }
    guard Array(lines.dropFirst()) == ["dsh_session_events", "dsh_session_metadata"] else {
      throw DesktopError.message("会话备份缺少必需的 Session 表。")
    }
  }

  private func legacySettings(from database: URL) throws -> Data? {
    let query = "SELECT json_group_object(namespace, json(payload_json)) FROM settings;"
    let result = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
      arguments: [database.path, query],
    )
    guard result.status == 0 else {
      throw DesktopError.message("配置备份中的模型与工具设置无法读取：\(result.output)")
    }
    let text = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text != "{}" else { return nil }
    let value = try JSONSerialization.jsonObject(with: Data(text.utf8))
    guard var settings = value as? [String: Any] else {
      throw DesktopError.message("配置备份中的设置格式无效。")
    }
    if settings["llm-pi-ai"] == nil, let legacy = settings.removeValue(forKey: "llm-dsh-ai") {
      settings["llm-pi-ai"] = legacy
    }
    return try JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys]) + Data("\n".utf8)
  }

  private func migrateLegacyWebPlugins(from archiveRoot: URL) throws {
    let source = archiveRoot.appendingPathComponent("profiles/web/package.json")
    let destination = dataRoot.appendingPathComponent("profiles/desktop-lite/package.json")
    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: source.path), fileManager.fileExists(atPath: destination.path),
          let legacy = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as? [String: Any],
          var current = try JSONSerialization.jsonObject(with: Data(contentsOf: destination)) as? [String: Any]
    else { return }
    let legacyDependencies = (legacy["dependencies"] as? [String: String]) ?? [:]
    var dependencies = (current["dependencies"] as? [String: String]) ?? [:]
    for (name, version) in legacyDependencies where !name.hasPrefix("@deepseek-ai/") {
      dependencies[name] = version
    }
    current["dependencies"] = dependencies
    var dsh = (current["dsh"] as? [String: Any]) ?? [:]
    var profile = (dsh["profile"] as? [String: Any]) ?? [:]
    var bundles = (profile["bundles"] as? [String]) ?? []
    let legacyDsh = legacy["dsh"] as? [String: Any]
    let legacyProfile = legacyDsh?["profile"] as? [String: Any]
    for name in (legacyProfile?["bundles"] as? [String]) ?? []
      where !name.hasPrefix("@deepseek-ai/") && !bundles.contains(name) {
      // Configuration archives intentionally omit executable dependencies. Keep
      // the requested package version, but do not activate code that is absent
      // from this profile until the user installs or reviews it again.
      let installed = destination.deletingLastPathComponent()
        .appendingPathComponent("node_modules", isDirectory: true)
        .appendingPathComponent(name, isDirectory: true)
      if fileManager.fileExists(atPath: installed.path) { bundles.append(name) }
    }
    profile["bundles"] = bundles
    dsh["profile"] = profile
    current["dsh"] = dsh
    let data = try JSONSerialization.data(withJSONObject: current, options: [.prettyPrinted, .sortedKeys]) + Data("\n".utf8)
    try data.write(to: destination, options: .atomic)
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
      "metadata",
    ]
    let quoted = tables.map { "'\($0)'" }.joined(separator: ",")
    let present = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
      arguments: [database.path, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (\(quoted));"],
    )
    guard present.status == 0 else { throw DesktopError.message("配置备份读取 SQLite 表失败：\(present.output)") }
    let presentTables = present.output
      .split(whereSeparator: \.isNewline)
      .map(String.init)
    var statements = presentTables
      .filter { $0 != "metadata" }
      .map { "DELETE FROM \"\($0)\";" }
    if presentTables.contains("metadata") {
      statements.append("DELETE FROM metadata WHERE key IN ('anonymous-user-id', 'payload-import-v1');")
    }
    statements.append("VACUUM;")
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
      if isDirectory {
        try copyArtifacts(from: item, to: target)
      } else {
        if fileManager.fileExists(atPath: target.path) { try fileManager.removeItem(at: target) }
        try fileManager.copyItem(at: item, to: target)
      }
    }
  }
}
